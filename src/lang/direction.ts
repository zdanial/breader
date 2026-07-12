// The single place script direction is decided (DESIGN.md: RTL-aware from day one).
const RTL_LANGS = new Set(['he', 'ar', 'fa', 'ur', 'yi'])

export function directionFor(lang: string): 'ltr' | 'rtl' {
  const primary = lang.toLowerCase().split('-')[0]
  return RTL_LANGS.has(primary) ? 'rtl' : 'ltr'
}
