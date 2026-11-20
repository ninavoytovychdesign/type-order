// Пропозиція набору стилів з того, що є в макетах.
import { Spec, sameSpec, specKey, sizeTolerance, lhPx } from './spec'
import { Combo } from './stats'
import { parseStyle } from './fonts'

export interface ExistingStyle {
  id: string
  name: string
  spec: Spec
  remote: boolean
}

export interface Proposal {
  id: string
  spec: Spec
  layers: number
  /** Ключі комбінацій тексту без стилю, які отримають цей стиль. */
  members: string[]
  /** Розміри, з яких склеєно пропозицію (для підказки «15, 16 → 16»). */
  fromSizes: number[]
  /** Якщо задано – текст привʼяжеться до наявного стилю, новий не створюється. */
  existing?: { id: string; name: string }
}

export interface ScaleOptions {
  /** Склеювати майже однакові розміри й інтервали в один стиль. */
  merge: boolean
}

function pickMostUsed<T>(items: Array<{ value: T; layers: number }>, keyOf: (v: T) => string): T {
  const m = new Map<string, { value: T; layers: number }>()
  for (const it of items) {
    const k = keyOf(it.value)
    const e = m.get(k)
    if (e) e.layers += it.layers
    else m.set(k, { value: it.value, layers: it.layers })
  }
  let best: { value: T; layers: number } | null = null
  for (const e of m.values()) if (!best || e.layers > best.layers) best = e
  return best!.value
}

/** Розбити розміри на групи: найуживаніший розмір стає центром і забирає сусідів у межах допуску. */
export function clusterSizes(sizes: Array<{ size: number; layers: number }>): Array<{ center: number; members: number[] }> {
  const order = sizes.slice().sort((a, b) => b.layers - a.layers || a.size - b.size)
  const assigned = new Set<number>()
  const clusters: Array<{ center: number; members: number[] }> = []
  for (const { size } of order) {
    if (assigned.has(size)) continue
    const tol = sizeTolerance(size)
    const members = sizes.filter((s) => !assigned.has(s.size) && Math.abs(s.size - size) <= tol + 1e-9).map((s) => s.size)
    members.forEach((m) => assigned.add(m))
    clusters.push({ center: size, members: members.sort((a, b) => a - b) })
  }
  return clusters
}

function closestExisting(spec: Spec, existing: ExistingStyle[]): ExistingStyle | null {
  let best: ExistingStyle | null = null
  let bestD = Infinity
  for (const e of existing) {
    if (e.spec.family !== spec.family || e.spec.style !== spec.style) continue
    const d = Math.abs(e.spec.size - spec.size)
    if (d > sizeTolerance(spec.size) + 1e-9) continue
    // інтервал теж має бути близьким, інакше це інший за призначенням стиль
    const a = lhPx(e.spec.lineHeight, e.spec.size)
    const b = lhPx(spec.lineHeight, spec.size)
    const lhD = a === null || b === null ? (a === b ? 0 : 2) : Math.abs(a - b)
    if (lhD > 4) continue
    const score = d * 10 + lhD
    if (score < bestD) {
      bestD = score
      best = e
    }
  }
  return best
}

export function buildProposals(combos: Combo[], existing: ExistingStyle[], opts: ScaleOptions): Proposal[] {
  const out: Proposal[] = []
  const byExisting = new Map<string, Proposal>()
  const attach = (e: ExistingStyle, c: Combo) => {
    let p = byExisting.get(e.id)
    if (!p) {
      p = { id: 'e:' + e.id, spec: e.spec, layers: 0, members: [], fromSizes: [], existing: { id: e.id, name: e.name } }
      byExisting.set(e.id, p)
      out.push(p)
    }
    p.layers += c.layers
    p.members.push(c.key)
    if (!p.fromSizes.includes(c.spec.size)) p.fromSizes.push(c.spec.size)
  }

  // 1. Точний збіг з наявним стилем.
  const rest: Combo[] = []
  for (const c of combos) {
    const e = existing.find((x) => sameSpec(x.spec, c.spec))
    if (e) attach(e, c)
    else rest.push(c)
  }

  // 2. Групи за шрифтом і накресленням.
  const groups = new Map<string, Combo[]>()
  for (const c of rest) {
    const k = c.spec.family + '|' + c.spec.style
    const g = groups.get(k)
    if (g) g.push(c)
    else groups.set(k, [c])
  }

  let n = 0
  for (const g of groups.values()) {
    if (!opts.merge) {
      for (const c of g) out.push({ id: 'p' + n++, spec: c.spec, layers: c.layers, members: [c.key], fromSizes: [c.spec.size] })
      continue
    }
    const sizeLayers = new Map<number, number>()
    for (const c of g) sizeLayers.set(c.spec.size, (sizeLayers.get(c.spec.size) || 0) + c.layers)
    const clusters = clusterSizes(Array.from(sizeLayers, ([size, layers]) => ({ size, layers })))
    for (const cl of clusters) {
      const members = g.filter((c) => cl.members.includes(c.spec.size))
      const atCenter = members.filter((c) => c.spec.size === cl.center)
      const base = atCenter.length ? atCenter : members
      const lineHeight = pickMostUsed(base.map((c) => ({ value: c.spec.lineHeight, layers: c.layers })), (v) => JSON.stringify(v))
      const letterSpacing = pickMostUsed(base.map((c) => ({ value: c.spec.letterSpacing, layers: c.layers })), (v) => JSON.stringify(v))
      const spec: Spec = { family: g[0].spec.family, style: g[0].spec.style, size: cl.center, lineHeight, letterSpacing }
      // 3. Близький наявний стиль важливіший за новий.
      const near = closestExisting(spec, existing)
      // Допуск не накопичується: кожен розмір може зсунутися щонайбільше на свій допуск від стилю,
      // до якого його привʼязують (інакше 13 → центр 12 → наявний стиль 11 = мінус 2 px).
      const fits = (c: Combo) => !!near && Math.abs(c.spec.size - near.spec.size) <= sizeTolerance(c.spec.size) + 1e-9
      const toNear = members.filter(fits)
      for (const c of toNear) attach(near!, c)
      const left = members.filter((c) => !fits(c))
      if (!left.length) continue
      const leftSizes = cl.members.filter((sz) => left.some((c) => c.spec.size === sz))
      const center = leftSizes.includes(cl.center) ? cl.center : pickMostUsed(left.map((c) => ({ value: c.spec.size, layers: c.layers })), String)
      const own = left.filter((c) => c.spec.size === center)
      const ownBase = own.length ? own : left
      const leftSpec: Spec = toNear.length
        ? {
            ...spec,
            size: center,
            lineHeight: pickMostUsed(ownBase.map((c) => ({ value: c.spec.lineHeight, layers: c.layers })), (v) => JSON.stringify(v)),
            letterSpacing: pickMostUsed(ownBase.map((c) => ({ value: c.spec.letterSpacing, layers: c.layers })), (v) => JSON.stringify(v)),
          }
        : spec
      out.push({ id: 'p' + n++, spec: leftSpec, layers: left.reduce((s, c) => s + c.layers, 0), members: left.map((c) => c.key), fromSizes: leftSizes })
    }
  }

  return out.sort((a, b) => b.spec.size - a.spec.size || parseStyle(b.spec.style).weight - parseStyle(a.spec.style).weight || b.layers - a.layers)
}

/** Ключ пропозиції стабільний між перерахунками, щоб правки назв у панелі не губились. */
export function proposalKey(p: Proposal): string {
  return p.existing ? 'e:' + p.existing.id : specKey(p.spec)
}
