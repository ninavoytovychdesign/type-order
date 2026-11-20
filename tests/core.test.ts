import { describe, it, expect } from 'vitest'
import { parseStyle, mapStyle } from '../src/core/fonts'
import { Spec, sameSpec, specKey, formatSpec } from '../src/core/spec'
import { computeStats, rawCombos, nodesFor, Seg } from '../src/core/stats'
import { buildProposals, clusterSizes, ExistingStyle } from '../src/core/scale'
import { nameProposals, categoryOf } from '../src/core/naming'

const spec = (family: string, style: string, size: number, lh: number | 'auto' = 'auto', ls = 0): Spec => ({
  family,
  style,
  size,
  lineHeight: lh === 'auto' ? { unit: 'AUTO' } : { unit: 'PIXELS', value: lh },
  letterSpacing: { unit: 'PIXELS', value: ls },
})

let nid = 0
const seg = (s: Spec, o: Partial<Seg> = {}): Seg => ({
  nodeId: 'n' + nid++,
  spec: s,
  styleId: '',
  styleRemote: false,
  overridden: false,
  inInstance: false,
  inMain: false,
  missingFont: false,
  ...o,
})

describe('накреслення', () => {
  it('вага з назви стилю, з урахуванням Semi/Extra', () => {
    expect(parseStyle('Regular').weight).toBe(400)
    expect(parseStyle('Semi Bold').weight).toBe(600)
    expect(parseStyle('SemiBold').weight).toBe(600)
    expect(parseStyle('ExtraBold').weight).toBe(800)
    expect(parseStyle('Extra Light').weight).toBe(200)
    expect(parseStyle('Bold Italic')).toEqual({ weight: 700, italic: true })
    expect(parseStyle('Medium').weight).toBe(500)
  })

  it('Manrope → Inter: точний збіг, найближча вага, нахил зберігається', () => {
    const inter = ['Thin', 'Light', 'Regular', 'Medium', 'Semi Bold', 'Bold', 'Extra Bold', 'Black', 'Italic', 'Bold Italic']
    expect(mapStyle('Bold', inter)).toBe('Bold')
    expect(mapStyle('SemiBold', inter)).toBe('Semi Bold')
    expect(mapStyle('ExtraBold', inter)).toBe('Extra Bold')
    expect(mapStyle('Medium Italic', inter)).toBe('Italic')
    expect(mapStyle('ExtraLight', ['Light', 'Regular', 'Bold'])).toBe('Light')
  })

  it('при однаковій відстані жирний іде в важчий, легкий – у легший', () => {
    expect(mapStyle('Semi Bold', ['Medium', 'Bold'])).toBe('Bold')
    expect(mapStyle('Light', ['Extra Light', 'Regular'])).toBe('Extra Light')
  })

  it('порожній список – null', () => {
    expect(mapStyle('Bold', [])).toBeNull()
  })
})

describe('опис типографіки', () => {
  it('140% при 20 px дорівнює 28 px', () => {
    const a = spec('Inter', 'Regular', 20, 28)
    const b: Spec = { ...a, lineHeight: { unit: 'PERCENT', value: 140 } }
    expect(sameSpec(a, b)).toBe(true)
    expect(sameSpec(a, spec('Inter', 'Regular', 20, 24))).toBe(false)
    expect(sameSpec(a, spec('Inter', 'Regular', 20))).toBe(false)
  })

  it('формат для панелі', () => {
    expect(formatSpec(spec('Inter', 'Semi Bold', 16, 24))).toBe('Inter Semi Bold · 16/24 · 0')
  })
})

describe('звіт', () => {
  const segs: Seg[] = [
    seg(spec('Inter', 'Regular', 16, 24), { nodeId: 'a' }),
    seg(spec('Inter', 'Bold', 16, 24), { nodeId: 'a' }), // жирне слово в тому самому шарі
    seg(spec('Inter', 'Regular', 15, 22), { nodeId: 'b' }),
    seg(spec('Manrope', 'Bold', 24, 32), { nodeId: 'c', styleId: 'S:1' }),
    seg(spec('Manrope', 'Bold', 26, 32), { nodeId: 'd', styleId: 'S:1', overridden: true }),
    seg(spec('Helvetica', 'Regular', 12), { nodeId: 'e', missingFont: true }),
  ]
  const st = computeStats(segs)

  it('рахує шари, а не фрагменти', () => {
    expect(st.textLayers).toBe(5)
    expect(st.families.map((f) => [f.family, f.layers])).toEqual([
      ['Inter', 2],
      ['Manrope', 2],
      ['Helvetica', 1],
    ])
  })

  it('покриття стилями і невідповідності', () => {
    expect(st.coverage).toEqual({ styled: 1, raw: 3, overridden: 1 })
    expect(st.missingFont).toBe(1)
    expect(st.mixedStyles).toBe(0)
  })

  it('майже однакові розміри', () => {
    expect(st.nearSizes).toContainEqual([15, 16])
    expect(st.nearSizes).toContainEqual([24, 26])
    expect(st.nearSizes).not.toContainEqual([12, 15])
  })

  it('комбінації тексту без стилю пропускають шари з відсутнім шрифтом', () => {
    const c = rawCombos(segs)
    expect(c.map((x) => x.spec.family)).not.toContain('Helvetica')
    expect(c).toHaveLength(3)
  })

  it('виділення за категорією', () => {
    expect(nodesFor(segs, { kind: 'family', value: 'Manrope' }).sort()).toEqual(['c', 'd'])
    expect(nodesFor(segs, { kind: 'issue', value: 'overridden' })).toEqual(['d'])
    expect(nodesFor(segs, { kind: 'size', value: 16 })).toEqual(['a'])
    const mixed = [seg(spec('Inter', 'Regular', 16), { nodeId: 'x' }), seg(spec('Inter', 'Bold', 16), { nodeId: 'x', styleId: 'S:2' })]
    expect(nodesFor(mixed, { kind: 'issue', value: 'mixed' })).toEqual(['x'])
  })
})

describe('пропозиції стилів', () => {
  it('центр групи – найуживаніший розмір', () => {
    const cl = clusterSizes([
      { size: 15, layers: 3 },
      { size: 16, layers: 20 },
      { size: 14, layers: 2 },
      { size: 24, layers: 5 },
    ])
    expect(cl).toContainEqual({ center: 16, members: [15, 16] })
    expect(cl.find((c) => c.members.includes(14))!.center).toBe(14)
    expect(cl).toContainEqual({ center: 24, members: [24] })
  })

  it('склеює 15 і 16, бере інтервал найуживанішого варіанта', () => {
    const segs = [
      ...Array.from({ length: 5 }, () => seg(spec('Inter', 'Regular', 16, 24))),
      seg(spec('Inter', 'Regular', 16, 22)),
      seg(spec('Inter', 'Regular', 15, 22)),
      seg(spec('Inter', 'Bold', 16, 24)),
    ]
    const ps = buildProposals(rawCombos(segs), [], { merge: true })
    const regular = ps.find((p) => p.spec.style === 'Regular')!
    expect(regular.spec.size).toBe(16)
    expect(regular.spec.lineHeight).toEqual({ unit: 'PIXELS', value: 24 })
    expect(regular.layers).toBe(7)
    expect(regular.fromSizes.sort()).toEqual([15, 16])
    expect(ps.filter((p) => p.spec.style === 'Bold')).toHaveLength(1) // вага не склеюється
  })

  it('без склеювання – кожна комбінація окремо', () => {
    const segs = [seg(spec('Inter', 'Regular', 16, 24)), seg(spec('Inter', 'Regular', 15, 22))]
    expect(buildProposals(rawCombos(segs), [], { merge: false })).toHaveLength(2)
  })

  it('наявний стиль: точний і близький збіг привʼязуються до нього, новий не створюється', () => {
    const body: ExistingStyle = { id: 'S:body', name: 'Body/M', spec: spec('Inter', 'Regular', 16, 24), remote: false }
    const segs = [seg(spec('Inter', 'Regular', 16, 24)), seg(spec('Inter', 'Regular', 15, 24)), seg(spec('Inter', 'Regular', 32, 40))]
    const ps = buildProposals(rawCombos(segs), [body], { merge: true })
    const linked = ps.filter((p) => p.existing)
    expect(linked).toHaveLength(1)
    expect(linked[0].existing!.id).toBe('S:body')
    expect(linked[0].layers).toBe(2)
    expect(ps.filter((p) => !p.existing).map((p) => p.spec.size)).toEqual([32])
  })

  it('допуск не накопичується: 13 не привʼязується до наявного стилю 11 через центр 12', () => {
    const cap: ExistingStyle = { id: 'S:cap', name: 'Caption/S', spec: spec('SF Pro', 'Medium', 11, 14), remote: false }
    const segs = [
      ...Array.from({ length: 5 }, () => seg(spec('SF Pro', 'Medium', 12, 14))),
      seg(spec('SF Pro', 'Medium', 13, 14)),
      seg(spec('SF Pro', 'Medium', 11, 14)),
    ]
    const ps = buildProposals(rawCombos(segs), [cap], { merge: true })
    const linked = ps.find((p) => p.existing)!
    expect(linked.fromSizes.sort((a, b) => a - b)).toEqual([11, 12])
    const fresh = ps.filter((p) => !p.existing)
    expect(fresh).toHaveLength(1)
    expect(fresh[0].spec.size).toBe(13)
  })

  it('ключі членів збігаються з ключами фрагментів', () => {
    const s = spec('Inter', 'Regular', 15, 22)
    const ps = buildProposals(rawCombos([seg(s)]), [], { merge: true })
    expect(ps[0].members).toEqual([specKey(s)])
  })
})

describe('назви', () => {
  it('категорії за розміром', () => {
    expect(categoryOf(48)).toBe('Display')
    expect(categoryOf(24)).toBe('Heading')
    expect(categoryOf(16)).toBe('Body')
    expect(categoryOf(12)).toBe('Caption')
  })

  it('за роллю: заголовки нумеруються, текст – розміри одягу, вага розрізняє однакові розміри', () => {
    const specs = [
      spec('Inter', 'Bold', 32),
      spec('Inter', 'Semi Bold', 24),
      spec('Inter', 'Regular', 18),
      spec('Inter', 'Regular', 16),
      spec('Inter', 'Semi Bold', 16),
      spec('Inter', 'Regular', 14),
      spec('Inter', 'Medium', 12),
    ]
    expect(nameProposals(specs, 'role')).toEqual(['Heading/H1', 'Heading/H2', 'Body/L', 'Body/M', 'Body/M Semibold', 'Body/S', 'Caption/M'])
  })

  it('як у коді', () => {
    expect(nameProposals([spec('Inter', 'Regular', 16), spec('Inter', 'Bold', 16)], 'code')).toEqual(['text-body-m', 'text-body-m-bold'])
  })

  it('зайняті назви отримують номер, різні шрифти одного розміру розрізняються', () => {
    expect(nameProposals([spec('Inter', 'Regular', 16)], 'role', ['body/m'])).toEqual(['Body/M 2'])
    expect(nameProposals([spec('Inter', 'Bold', 16), spec('Manrope', 'Bold', 16)], 'role')).toEqual(['Body/M Bold Inter', 'Body/M Bold Manrope'])
  })
})

import { weightLabel } from '../src/core/stats'
describe('накреслення в огляді', () => {
  it('зводить різні написання однієї ваги', () => {
    expect(new Set(['Semibold', 'SemiBold', 'Semi Bold'].map(weightLabel))).toEqual(new Set(['Semibold']))
    expect(weightLabel('Bold Italic')).toBe('Bold Italic')
    expect(weightLabel('Book')).toBe('Regular')
  })
})
