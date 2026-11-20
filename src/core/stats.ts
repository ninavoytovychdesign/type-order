// Звіт по типографіці: що є у файлі і де невідповідності.
import { Spec, specKey, sizeTolerance, r2, lhKey } from './spec'
import { parseStyle, weightName } from './fonts'

/** «Semibold», «SemiBold» і «Semi Bold» з різних шрифтів – одне накреслення. */
export function weightLabel(style: string): string {
  const p = parseStyle(style)
  return weightName(p.weight) + (p.italic ? ' Italic' : '')
}

/** Фрагмент тексту з однаковою типографікою всередині одного шару. */
export interface Seg {
  nodeId: string
  spec: Spec
  /** '' – текст без стилю */
  styleId: string
  styleRemote: boolean
  /** Стиль привʼязаний, але значення перебиті вручну. */
  overridden: boolean
  inInstance: boolean
  inMain: boolean
  missingFont: boolean
}

export interface Count {
  key: string
  layers: number
}

export interface FamilyStat {
  family: string
  layers: number
  styles: Count[]
}

export interface Stats {
  textLayers: number
  families: FamilyStat[]
  sizes: Array<{ size: number; layers: number }>
  /** Сусідні розміри в межах допуску: кандидати на обʼєднання. */
  nearSizes: Array<[number, number]>
  weights: Count[]
  lineHeights: Count[]
  combos: number
  coverage: { styled: number; raw: number; overridden: number }
  missingFont: number
  mixedStyles: number
  remoteStyled: number
}

/** Унікальна типографіка тексту без стилю: з неї будуються пропозиції стилів. */
export interface Combo {
  key: string
  spec: Spec
  layers: number
}

/** Ключ → множина шарів (рахуємо шари, а не фрагменти). */
function countBy(items: Seg[], keyOf: (x: Seg) => string): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>()
  for (const it of items) {
    const k = keyOf(it)
    let s = m.get(k)
    if (!s) m.set(k, (s = new Set()))
    s.add(it.nodeId)
  }
  return m
}

const toCounts = (m: Map<string, Set<string>>): Count[] =>
  Array.from(m, ([key, s]) => ({ key, layers: s.size })).sort((a, b) => b.layers - a.layers || a.key.localeCompare(b.key))

export function computeStats(segs: Seg[]): Stats {
  const byNode = new Map<string, Seg[]>()
  for (const s of segs) {
    const arr = byNode.get(s.nodeId)
    if (arr) arr.push(s)
    else byNode.set(s.nodeId, [s])
  }

  const famMap = countBy(segs, (s) => s.spec.family)
  const families: FamilyStat[] = toCounts(famMap).map((c) => ({
    family: c.key,
    layers: c.layers,
    styles: toCounts(countBy(segs.filter((s) => s.spec.family === c.key), (s) => s.spec.style)),
  }))

  const sizeMap = countBy(segs, (s) => String(r2(s.spec.size)))
  const sizes = Array.from(sizeMap, ([k, set]) => ({ size: Number(k), layers: set.size })).sort((a, b) => a.size - b.size)
  const nearSizes: Array<[number, number]> = []
  for (let i = 1; i < sizes.length; i++) {
    const a = sizes[i - 1].size
    const b = sizes[i].size
    if (b - a <= sizeTolerance(a) + 1e-9) nearSizes.push([a, b])
  }

  let styled = 0
  let raw = 0
  let overridden = 0
  let missingFont = 0
  let mixedStyles = 0
  let remoteStyled = 0
  for (const list of byNode.values()) {
    const hasRaw = list.some((s) => !s.styleId)
    const hasOver = list.some((s) => !!s.styleId && s.overridden)
    if (hasRaw) raw++
    else if (hasOver) overridden++
    else styled++
    if (list.some((s) => s.missingFont)) missingFont++
    if (new Set(list.map((s) => s.styleId)).size > 1) mixedStyles++
    if (list.some((s) => s.styleRemote)) remoteStyled++
  }

  return {
    textLayers: byNode.size,
    families,
    sizes,
    nearSizes,
    weights: toCounts(countBy(segs, (s) => weightLabel(s.spec.style))),
    lineHeights: toCounts(countBy(segs, (s) => lhKey(s.spec.lineHeight))),
    combos: new Set(segs.map((s) => specKey(s.spec))).size,
    coverage: { styled, raw, overridden },
    missingFont,
    mixedStyles,
    remoteStyled,
  }
}

/** Комбінації тексту без стилю (фрагменти з відсутнім шрифтом пропускаються: їх не можна змінити). */
export function rawCombos(segs: Seg[]): Combo[] {
  const m = new Map<string, { spec: Spec; nodes: Set<string> }>()
  for (const s of segs) {
    if (s.styleId || s.missingFont) continue
    const k = specKey(s.spec)
    let e = m.get(k)
    if (!e) m.set(k, (e = { spec: s.spec, nodes: new Set() }))
    e.nodes.add(s.nodeId)
  }
  return Array.from(m, ([key, e]) => ({ key, spec: e.spec, layers: e.nodes.size })).sort((a, b) => b.layers - a.layers)
}

export type IssueKind = 'raw' | 'overridden' | 'missing' | 'mixed' | 'remote'

/** Шари, які потрапляють у певну категорію звіту (для виділення на канвасі). */
export function nodesFor(segs: Seg[], filter: { kind: 'family'; value: string } | { kind: 'size'; value: number } | { kind: 'style'; value: string } | { kind: 'combos'; value: string[] } | { kind: 'issue'; value: IssueKind }): string[] {
  const out = new Set<string>()
  if (filter.kind === 'issue' && filter.value === 'mixed') {
    const by = new Map<string, Set<string>>()
    for (const s of segs) {
      let set = by.get(s.nodeId)
      if (!set) by.set(s.nodeId, (set = new Set()))
      set.add(s.styleId)
    }
    for (const [id, set] of by) if (set.size > 1) out.add(id)
    return Array.from(out)
  }
  const keys = filter.kind === 'combos' ? new Set(filter.value) : null
  for (const s of segs) {
    let hit = false
    switch (filter.kind) {
      case 'family':
        hit = s.spec.family === filter.value
        break
      case 'size':
        hit = Math.abs(s.spec.size - filter.value) < 0.01
        break
      case 'style':
        hit = weightLabel(s.spec.style) === filter.value
        break
      case 'combos':
        hit = !s.styleId && keys!.has(specKey(s.spec))
        break
      case 'issue':
        hit =
          filter.value === 'raw' ? !s.styleId : filter.value === 'overridden' ? !!s.styleId && s.overridden : filter.value === 'missing' ? s.missingFont : s.styleRemote
        break
    }
    if (hit) out.add(s.nodeId)
  }
  return Array.from(out)
}
