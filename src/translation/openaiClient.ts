// Thin, model-agnostic OpenAI chat wrapper. The key never leaves the device:
// requests go browser → api.openai.com directly.

export type TxErrorCode =
  | 'no-key'
  | 'offline'
  | 'auth'
  | 'quota' // OpenAI also sends HTTP 429 for insufficient_quota — not a real rate limit
  | 'rate-limit'
  | 'http'
  | 'bad-response'

export class TxError extends Error {
  constructor(
    public code: TxErrorCode,
    message?: string,
  ) {
    super(message ?? code)
    this.name = 'TxError'
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** True 429s are retried with backoff (honoring Retry-After); quota errors are not. */
const RATE_LIMIT_RETRIES = 2
const BACKOFF_BASE_MS = 1500
const BACKOFF_CAP_MS = 8000

async function requestOnce(opts: {
  apiKey: string
  model: string
  system: string
  user: string
  maxTokens?: number
}): Promise<string> {
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
  if (res.status === 429) {
    // Distinguish "out of credits" (insufficient_quota) from a genuine rate limit.
    const body = await res.json().catch(() => null)
    const code: unknown = body?.error?.code ?? body?.error?.type
    if (code === 'insufficient_quota') {
      throw new TxError('quota', 'The OpenAI account for this key is out of credits')
    }
    const retryAfter = Number(res.headers.get('retry-after')) || 0
    const err = new TxError('rate-limit', 'Rate limited by OpenAI')
    ;(err as TxError & { retryAfterMs?: number }).retryAfterMs = retryAfter * 1000
    throw err
  }
  if (!res.ok) throw new TxError('http', `OpenAI error ${res.status}`)

  const data = await res.json().catch(() => {
    throw new TxError('bad-response', 'Could not parse OpenAI response')
  })
  const text: unknown = data?.choices?.[0]?.message?.content
  if (typeof text !== 'string' || !text.trim()) throw new TxError('bad-response', 'Empty completion')
  return text.trim()
}

export async function chatComplete(opts: {
  apiKey?: string
  model: string
  system: string
  user: string
  maxTokens?: number
}): Promise<string> {
  if (!opts.apiKey) throw new TxError('no-key')
  const { apiKey } = opts

  for (let attempt = 0; ; attempt++) {
    try {
      return await requestOnce({ ...opts, apiKey })
    } catch (e) {
      const retriable =
        e instanceof TxError && e.code === 'rate-limit' && attempt < RATE_LIMIT_RETRIES
      if (!retriable) throw e
      const hinted = (e as TxError & { retryAfterMs?: number }).retryAfterMs ?? 0
      const backoff = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt)
      await sleep(Math.max(hinted, backoff))
    }
  }
}
