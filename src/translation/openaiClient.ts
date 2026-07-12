// Thin, model-agnostic OpenAI chat wrapper. The key never leaves the device:
// requests go browser → api.openai.com directly.

export type TxErrorCode = 'no-key' | 'offline' | 'auth' | 'rate-limit' | 'http' | 'bad-response'

export class TxError extends Error {
  constructor(
    public code: TxErrorCode,
    message?: string,
  ) {
    super(message ?? code)
    this.name = 'TxError'
  }
}

export async function chatComplete(opts: {
  apiKey?: string
  model: string
  system: string
  user: string
  maxTokens?: number
}): Promise<string> {
  if (!opts.apiKey) throw new TxError('no-key')

  let res: Response
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
        temperature: 0.2,
        max_tokens: opts.maxTokens ?? 200,
      }),
    })
  } catch {
    throw new TxError(navigator.onLine ? 'http' : 'offline', 'Network request failed')
  }

  if (res.status === 401) throw new TxError('auth', 'OpenAI rejected the API key')
  if (res.status === 429) throw new TxError('rate-limit', 'Rate limited by OpenAI')
  if (!res.ok) throw new TxError('http', `OpenAI error ${res.status}`)

  const data = await res.json().catch(() => {
    throw new TxError('bad-response', 'Could not parse OpenAI response')
  })
  const text: unknown = data?.choices?.[0]?.message?.content
  if (typeof text !== 'string' || !text.trim()) throw new TxError('bad-response', 'Empty completion')
  return text.trim()
}
