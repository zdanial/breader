import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { db, type Book, type Sentence, type Settings } from '../db/schema'
import { TxError, type TxErrorCode } from '../translation/openaiClient'
import { ensureWindowTranslated, sentenceKey } from '../translation/sentenceTranslator'

/**
 * Live translation of the current sentence + look-ahead prefetch.
 * `active` gates the network work to landscape mode; the cache read is
 * always live so rotating shows an already-translated sentence instantly.
 */
export function useSentenceTranslation(
  book: Book | undefined,
  sentence: Sentence | undefined,
  settings: Settings,
  active: boolean,
) {
  const [key, setKey] = useState<string | null>(null)
  const [error, setError] = useState<TxErrorCode | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setKey(null)
    if (book && sentence) {
      sentenceKey(sentence.text, book.targetLang, settings.model).then(
        (k) => alive && setKey(k),
      )
    }
    return () => {
      alive = false
    }
  }, [book, sentence, settings.model])

  const row = useLiveQuery(() => (key ? db.translations.get(key) : undefined), [key])

  useEffect(() => {
    if (!active || !book || !sentence) return
    setError(null)
    // ensureWindowTranslated skips anything cached or in flight, so calling on
    // every position change is cheap and keeps the look-ahead window warm.
    ensureWindowTranslated(book, sentence.index, {
      model: settings.model,
      apiKey: settings.openaiKey,
    }).catch((e: unknown) => setError(e instanceof TxError ? e.code : 'http'))
  }, [active, book, sentence, settings.model, settings.openaiKey, attempt])

  return {
    translation: row?.result,
    error,
    retry: () => setAttempt((a) => a + 1),
  }
}
