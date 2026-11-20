// Накреслення шрифтів: вага за назвою стилю і підбір відповідника в іншому шрифті.

export interface StyleInfo {
  weight: number
  italic: boolean
}

// Порядок важливий: «Extra Light» перевіряємо раніше за «Light», «Semi Bold» – раніше за «Bold».
const WEIGHTS: Array<[RegExp, number]> = [
  [/hairline|thin/i, 100],
  [/(extra|ultra)[\s-]*light/i, 200],
  [/light/i, 300],
  [/(semi|demi)[\s-]*bold/i, 600],
  [/(extra|ultra)[\s-]*bold/i, 800],
  [/black|heavy/i, 900],
  [/bold/i, 700],
  [/medium/i, 500],
  [/regular|normal|book|roman|plain/i, 400],
]

export function parseStyle(style: string): StyleInfo {
  const italic = /italic|oblique/i.test(style)
  for (const [re, w] of WEIGHTS) if (re.test(style)) return { weight: w, italic }
  return { weight: 400, italic }
}

const NAMES: Record<number, string> = {
  100: 'Thin',
  200: 'ExtraLight',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semibold',
  700: 'Bold',
  800: 'ExtraBold',
  900: 'Black',
}

export function weightName(weight: number): string {
  return NAMES[weight] || String(weight)
}

/**
 * Найближче накреслення цільового шрифту: та сама нахиленість, найближча вага.
 * Якщо однаково близько – для жирних стилів беремо важчий, для легких – легший.
 * null, якщо в цільового шрифту немає жодного накреслення.
 */
export function mapStyle(source: string, targets: string[]): string | null {
  if (!targets.length) return null
  const exact = targets.find((t) => t.toLowerCase() === source.toLowerCase())
  if (exact) return exact
  const s = parseStyle(source)
  const parsed = targets.map((t) => ({ name: t, ...parseStyle(t) }))
  const sameItalic = parsed.filter((p) => p.italic === s.italic)
  const pool = sameItalic.length ? sameItalic : parsed
  let best = pool[0]
  for (const p of pool.slice(1)) {
    const d = Math.abs(p.weight - s.weight)
    const bd = Math.abs(best.weight - s.weight)
    if (d < bd) best = p
    else if (d === bd) {
      if (p.weight !== best.weight) {
        const preferHeavier = s.weight >= 500
        if (preferHeavier ? p.weight > best.weight : p.weight < best.weight) best = p
      } else if (p.name.length < best.name.length) best = p
    }
  }
  return best.name
}
