// Назви стилів за роллю: Heading/H1, Body/M, Caption/S…
import { Spec, r2 } from './spec'
import { parseStyle, weightName } from './fonts'

export type Convention = 'role' | 'code'

type Category = 'Display' | 'Heading' | 'Body' | 'Caption'

export function categoryOf(size: number): Category {
  if (size >= 40) return 'Display'
  if (size >= 20) return 'Heading'
  if (size >= 14) return 'Body'
  return 'Caption'
}

const T_SHIRT: Record<number, string[]> = {
  1: ['M'],
  2: ['L', 'M'],
  3: ['L', 'M', 'S'],
  4: ['XL', 'L', 'M', 'S'],
  5: ['XL', 'L', 'M', 'S', 'XS'],
  6: ['XXL', 'XL', 'L', 'M', 'S', 'XS'],
}

function labelsFor(cat: Category, sizesDesc: number[]): Map<number, string> {
  const m = new Map<number, string>()
  if (cat === 'Heading') {
    sizesDesc.forEach((s, i) => m.set(s, 'H' + (i + 1)))
    return m
  }
  const labels = T_SHIRT[sizesDesc.length]
  sizesDesc.forEach((s, i) => m.set(s, labels ? labels[i] : String(r2(s))))
  return m
}

function format(cat: Category, label: string, suffix: string, conv: Convention): string {
  if (conv === 'role') return `${cat}/${label}${suffix ? ' ' + suffix : ''}`
  const slug = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return ['text', slug(cat), slug(label), suffix ? slug(suffix) : ''].filter(Boolean).join('-')
}

/**
 * Назви для набору нових стилів у тому самому порядку, що й specs.
 * taken – назви, які вже зайняті у файлі: до них додається номер.
 */
export function nameProposals(specs: Spec[], conv: Convention, taken: Iterable<string> = []): string[] {
  const cats = specs.map((s) => categoryOf(s.size))
  const labelBy = new Map<Category, Map<number, string>>()
  for (const cat of ['Display', 'Heading', 'Body', 'Caption'] as Category[]) {
    const sizes = Array.from(new Set(specs.filter((_, i) => cats[i] === cat).map((s) => r2(s.size)))).sort((a, b) => b - a)
    labelBy.set(cat, labelsFor(cat, sizes))
  }
  const labels = specs.map((s, i) => labelBy.get(cats[i])!.get(r2(s.size))!)

  // однакова категорія й розмір → розрізняємо вагою, потім шрифтом
  const groups = new Map<string, number[]>()
  labels.forEach((l, i) => {
    const k = cats[i] + '/' + l
    const g = groups.get(k)
    if (g) g.push(i)
    else groups.set(k, [i])
  })
  const suffix: string[] = specs.map(() => '')
  for (const idx of groups.values()) {
    if (idx.length < 2) continue
    for (const i of idx) {
      const p = parseStyle(specs[i].style)
      const plain = p.weight === 400 && !p.italic
      suffix[i] = plain ? '' : weightName(p.weight) + (p.italic ? ' Italic' : '')
    }
    const seen = new Map<string, number[]>()
    for (const i of idx) {
      const g = seen.get(suffix[i])
      if (g) g.push(i)
      else seen.set(suffix[i], [i])
    }
    for (const same of seen.values()) {
      if (same.length < 2) continue
      for (const i of same) suffix[i] = (suffix[i] ? suffix[i] + ' ' : '') + specs[i].family
    }
  }

  const used = new Set(Array.from(taken, (x) => x.toLowerCase()))
  return specs.map((_, i) => {
    const base = format(cats[i], labels[i], suffix[i], conv)
    let name = base
    let k = 2
    while (used.has(name.toLowerCase())) name = conv === 'role' ? `${base} ${k++}` : `${base}-${k++}`
    used.add(name.toLowerCase())
    return name
  })
}
