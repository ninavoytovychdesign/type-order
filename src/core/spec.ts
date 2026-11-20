// Опис типографіки одного фрагмента тексту, без залежності від Figma.

export type LineHeightV = { unit: 'AUTO' } | { unit: 'PIXELS' | 'PERCENT'; value: number }
export type LetterSpacingV = { unit: 'PIXELS' | 'PERCENT'; value: number }

export interface Spec {
  family: string
  style: string
  size: number
  lineHeight: LineHeightV
  letterSpacing: LetterSpacingV
}

export const r2 = (x: number): number => Math.round(x * 100) / 100

export function lhKey(lh: LineHeightV): string {
  if (lh.unit === 'AUTO') return 'auto'
  return lh.unit === 'PIXELS' ? `${r2(lh.value)}px` : `${r2(lh.value)}%`
}

export function lsKey(ls: LetterSpacingV): string {
  if (r2(ls.value) === 0) return '0'
  return ls.unit === 'PIXELS' ? `${r2(ls.value)}px` : `${r2(ls.value)}%`
}

export function specKey(s: Spec): string {
  return [s.family, s.style, r2(s.size), lhKey(s.lineHeight), lsKey(s.letterSpacing)].join('|')
}

/** Міжрядковий інтервал у пікселях; null для «auto». */
export function lhPx(lh: LineHeightV, size: number): number | null {
  if (lh.unit === 'AUTO') return null
  return lh.unit === 'PIXELS' ? lh.value : (lh.value * size) / 100
}

export function lsPx(ls: LetterSpacingV, size: number): number {
  return ls.unit === 'PIXELS' ? ls.value : (ls.value * size) / 100
}

/** Однакові з точки зору читача: 140% при 20 px дорівнює 28 px. */
export function sameSpec(a: Spec, b: Spec): boolean {
  if (a.family !== b.family || a.style !== b.style) return false
  if (Math.abs(a.size - b.size) > 0.01) return false
  const la = lhPx(a.lineHeight, a.size)
  const lb = lhPx(b.lineHeight, b.size)
  if ((la === null) !== (lb === null)) return false
  if (la !== null && lb !== null && Math.abs(la - lb) > 0.05) return false
  return Math.abs(lsPx(a.letterSpacing, a.size) - lsPx(b.letterSpacing, b.size)) <= 0.02
}

export function formatLh(lh: LineHeightV): string {
  if (lh.unit === 'AUTO') return 'auto'
  return lh.unit === 'PIXELS' ? String(r2(lh.value)) : `${r2(lh.value)}%`
}

export function formatLs(ls: LetterSpacingV): string {
  if (r2(ls.value) === 0) return '0'
  return ls.unit === 'PIXELS' ? `${r2(ls.value)}px` : `${r2(ls.value)}%`
}

/** «Inter Semi Bold · 16/24 · 0» */
export function formatSpec(s: Spec): string {
  return `${s.family} ${s.style} · ${r2(s.size)}/${formatLh(s.lineHeight)} · ${formatLs(s.letterSpacing)}`
}

/** Допуск, у межах якого розміри вважаються «майже однаковими». */
export function sizeTolerance(size: number): number {
  if (size < 20) return 1
  if (size < 32) return 2
  return 4
}
