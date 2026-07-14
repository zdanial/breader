import { useCallback, useState } from 'react'
import { useSettings } from '../db/settings'
import { speak } from './speak'

/** Convenience hook: speak with the user's voice + key, tracking a busy state. */
export function useSpeak() {
  const settings = useSettings()
  const [busy, setBusy] = useState(false)
  const say = useCallback(
    (text: string) => {
      setBusy(true)
      speak(text, { voice: settings.ttsVoice ?? 'alloy', apiKey: settings.openaiKey })
        .catch(() => {})
        .finally(() => setBusy(false))
    },
    [settings.ttsVoice, settings.openaiKey],
  )
  return { say, busy, hasKey: !!settings.openaiKey }
}
