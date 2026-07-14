// Text-to-speech via OpenAI (gpt-4o-mini-tts), with permanent on-device audio
// caching so a given clip is only generated once. Playback goes through a single
// shared Audio element so a new clip stops the previous one.
import { db } from '../db/schema'
import { cacheKey } from '../translation/cache'
import { TxError } from '../translation/openaiClient'

export const TTS_MODEL = 'gpt-4o-mini-tts'

let current: HTMLAudioElement | null = null
let currentUrl: string | null = null

function playBlob(blob: Blob) {
  if (current) {
    current.pause()
    current = null
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl)
    currentUrl = null
  }
  const url = URL.createObjectURL(blob)
  currentUrl = url
  const audio = new Audio(url)
  current = audio
  audio.play().catch(() => {
    /* iOS may block outside a gesture; the caller is a gesture handler so this is rare */
  })
}

/** Fetch (or reuse cached) TTS audio for `text` and play it. */
export async function speak(
  text: string,
  opts: { voice: string; apiKey?: string },
): Promise<void> {
  const clean = text.trim()
  if (!clean) return
  const key = await cacheKey(['tts', TTS_MODEL, opts.voice, clean])

  const cached = await db.audio.get(key)
  if (cached) {
    playBlob(cached.blob)
    return
  }

  if (!opts.apiKey) throw new TxError('no-key')
  let res: Response
  try {
    res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${opts.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: TTS_MODEL, input: clean, voice: opts.voice, response_format: 'mp3' }),
    })
  } catch {
    throw new TxError(navigator.onLine ? 'http' : 'offline', 'Audio request failed')
  }
  if (res.status === 401) throw new TxError('auth', 'OpenAI rejected the API key')
  if (res.status === 429) throw new TxError('rate-limit', 'Rate limited')
  if (!res.ok) throw new TxError('http', `TTS error ${res.status}`)

  const blob = await res.blob()
  await db.audio.put({ key, blob, createdAt: Date.now() })
  playBlob(blob)
}

/** Stop any current playback. */
export function stopSpeaking() {
  if (current) current.pause()
}
