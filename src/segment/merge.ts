// Shared post-processing that repairs Intl.Segmenter's over-eager splits — the
// root trigger behind the landscape target/base misalignment. Fragments a human
// (and the translation model) would treat as part of one sentence get merged
// back, so a translation batch's item count matches the model's.

const isSymbolOnly = (s: string) => !/[\p{L}\p{N}]/u.test(s)

// A bare enumerator split off from its heading: "1.", "IV." → belongs to NEXT.
const isEnumerator = (s: string) => /^([0-9]{1,3}|[ivxlcdm]{1,6})\.$/i.test(s)

// A short lowercase-initial fragment: German speech tags like "fragte sie."
// left over from »…« dialogue → belongs to the PREVIOUS sentence. (Target
// languages capitalise sentence starts, so this is safe; RTL has no case.)
const isLowerContinuation = (s: string) => /^[a-zà-öø-ÿß]/u.test(s) && s.length <= 24

/**
 * Merge over-split fragments. Symbol-only pieces and lowercase speech-tag
 * continuations fold into the previous sentence; bare enumerators fold into the
 * next. Never emits a segment with no letters or numbers on its own.
 */
export function mergeFragments(raw: string[]): string[] {
  const segs = raw.map((s) => s.trim()).filter(Boolean)
  const out: string[] = []
  let prefix = '' // held text to prepend to the next real sentence (merge-forward)

  const pushForward = (s: string) => {
    prefix = prefix ? `${prefix} ${s}` : s
  }
  const appendPrev = (s: string) => {
    out[out.length - 1] = `${out[out.length - 1]} ${s}`.replace(/\s+/g, ' ').trim()
  }

  for (const seg of segs) {
    const backward = isSymbolOnly(seg) || isLowerContinuation(seg)
    if (isEnumerator(seg) || (backward && out.length === 0)) {
      pushForward(seg)
    } else if (backward) {
      appendPrev(seg)
    } else {
      out.push((prefix ? `${prefix} ${seg}` : seg).replace(/\s+/g, ' ').trim())
      prefix = ''
    }
  }
  if (prefix) {
    if (out.length) appendPrev(prefix)
    else out.push(prefix)
  }
  return out.filter((s) => s.length > 0)
}
