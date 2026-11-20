// Імітація потрібної частини Figma API: перевіряє, що аналіз і зміни працюють разом.
import { describe, it, expect, beforeEach } from 'vitest'
import { scan } from '../src/figma/scan'
import { applyFonts, applyStyles, resetOverrides } from '../src/figma/apply'

type Run = { start: number; end: number; fontName: FontName; fontSize: number; lineHeight: LineHeight; letterSpacing: LetterSpacing; textStyleId: string }

interface FakeStyle {
  id: string
  type: 'TEXT'
  name: string
  remote: boolean
  fontName: FontName
  fontSize: number
  lineHeight: LineHeight
  letterSpacing: LetterSpacing
}

let styles: Map<string, FakeStyle>
let nodes: Map<string, any>
let loaded: Set<string>
let available: Record<string, string[]>
let sid = 0

const px = (v: number): LineHeight => ({ unit: 'PIXELS', value: v })
const ls0: LetterSpacing = { unit: 'PIXELS', value: 0 }

function frame(id: string, type = 'FRAME', parent: any = null): any {
  const f: any = { id, type, parent, visible: true, removed: false, children: [] as any[] }
  f.findAllWithCriteria = () => {
    const out: any[] = []
    const walk = (n: any) => n.children && n.children.forEach((c: any) => (c.type === 'TEXT' ? out.push(c) : walk(c)))
    walk(f)
    return out
  }
  if (parent) parent.children.push(f)
  nodes.set(id, f)
  return f
}

function text(id: string, parent: any, runs: Array<Omit<Run, 'start' | 'end'> & { len: number }>, missing = false): any {
  let pos = 0
  const r: Run[] = runs.map((x) => {
    const run = { start: pos, end: pos + x.len, fontName: x.fontName, fontSize: x.fontSize, lineHeight: x.lineHeight, letterSpacing: x.letterSpacing, textStyleId: x.textStyleId }
    pos += x.len
    return run
  })
  const node: any = {
    id,
    type: 'TEXT',
    parent,
    visible: true,
    removed: false,
    hasMissingFont: missing,
    characters: 'x'.repeat(pos),
    width: 100,
    height: 20,
    textAutoResize: 'HEIGHT',
    runs: r,
    getStyledTextSegments() {
      // злиття сусідніх однакових фрагментів, як робить Figma
      const out: Run[] = []
      for (const x of node.runs) {
        const prev = out[out.length - 1]
        if (prev && JSON.stringify({ ...prev, start: 0, end: 0 }) === JSON.stringify({ ...x, start: 0, end: 0 })) prev.end = x.end
        else out.push({ ...x })
      }
      return out.map((x) => ({ ...x, characters: node.characters.slice(x.start, x.end) }))
    },
    getRangeAllFontNames(s: number, e: number) {
      const seen = new Map<string, FontName>()
      for (const x of node.runs) if (x.end > s && x.start < e) seen.set(x.fontName.family + '|' + x.fontName.style, x.fontName)
      return Array.from(seen.values())
    },
    setRangeFontName(s: number, e: number, f: FontName) {
      if (!loaded.has(f.family + '|' + f.style)) throw new Error('font not loaded ' + f.family)
      // як у Figma: шрифти, що вже стоять у діапазоні, теж мають бути завантажені
      for (const x of node.runs)
        if (x.end > s && x.start < e && !loaded.has(x.fontName.family + '|' + x.fontName.style))
          throw new Error('Cannot write to node with unloaded font ' + x.fontName.family)
      for (const x of node.runs) if (x.start >= s && x.end <= e) x.fontName = f
      node.width += 5 // інший шрифт – інша ширина
      node.height += 16
    },
    async setRangeTextStyleIdAsync(s: number, e: number, id: string) {
      for (const x of node.runs)
        if (x.start >= s && x.end <= e) {
          x.textStyleId = id
          const st = styles.get(id)
          if (st) Object.assign(x, { fontName: st.fontName, fontSize: st.fontSize, lineHeight: st.lineHeight, letterSpacing: st.letterSpacing })
        }
    },
  }
  parent.children.push(node)
  nodes.set(id, node)
  return node
}

function style(name: string, fontName: FontName, size: number, lh: number, remote = false): FakeStyle {
  const s = { id: 'S:' + sid++, type: 'TEXT', name, remote, fontSize: size, lineHeight: px(lh), letterSpacing: ls0 } as FakeStyle
  let fn = fontName
  // як у Figma: зміна стилю оновлює текст, привʼязаний до нього
  Object.defineProperty(s, 'fontName', {
    enumerable: true,
    get: () => fn,
    set: (v: FontName) => {
      fn = v
      for (const n of nodes.values()) if (n.runs) for (const r of n.runs) if (r.textStyleId === s.id) r.fontName = v
    },
  })
  styles.set(s.id, s)
  return s
}

const ctl = { isCancelled: () => false, progress: () => {} }
const run = (fontName: FontName, fontSize: number, lh: number, textStyleId = '', len = 5) => ({ fontName, fontSize, lineHeight: px(lh), letterSpacing: ls0, textStyleId, len })
const I = (style: string) => ({ family: 'Inter', style })
const M = (style: string) => ({ family: 'Manrope', style })

let page: any

beforeEach(() => {
  styles = new Map()
  nodes = new Map()
  loaded = new Set()
  available = { Inter: ['Regular', 'Medium', 'Semi Bold', 'Bold'], Manrope: ['Regular', 'SemiBold', 'Bold'] }
  page = frame('page', 'PAGE')
  ;(globalThis as any).setTimeout = (f: () => void) => f()
  ;(globalThis as any).figma = {
    currentPage: page,
    root: { children: [page] },
    getNodeByIdAsync: async (id: string) => nodes.get(id) || null,
    getStyleByIdAsync: async (id: string) => styles.get(id) || null,
    getLocalTextStylesAsync: async () => Array.from(styles.values()).filter((s) => !s.remote),
    loadFontAsync: async (f: FontName) => {
      if (!(available[f.family] || []).includes(f.style)) throw new Error('unavailable')
      loaded.add(f.family + '|' + f.style)
    },
    createTextStyle: () => {
      const s = style('', I('Regular'), 12, 16)
      return new Proxy(s, {
        set(t: any, k: string, v: any) {
          if (k === 'fontName' && !loaded.has(v.family + '|' + v.style)) throw new Error('font not loaded')
          t[k] = v
          return true
        },
      })
    },
    commitUndo: () => {},
  }
})

describe('аналіз файлу', () => {
  it('пропускає приховані шари, бачить інстанси, головні компоненти й перебиті стилі', async () => {
    const body = style('Body/M', I('Regular'), 16, 24)
    const screen = frame('screen', 'FRAME', page)
    text('t1', screen, [run(I('Regular'), 16, 24, body.id)])
    text('t2', screen, [run(I('Regular'), 18, 24, body.id)]) // розмір перебитий
    text('t3', screen, [run(M('Bold'), 24, 32), run(M('Bold'), 24, 32)])
    const hidden = frame('hidden', 'FRAME', screen)
    hidden.visible = false
    text('t4', hidden, [run(I('Regular'), 10, 12)])
    const comp = frame('comp', 'COMPONENT', page)
    text('t5', comp, [run(I('Bold'), 14, 20)])
    const inst = frame('inst', 'INSTANCE', screen)
    text('t6', inst, [run(I('Bold'), 14, 20)])

    const r = (await scan('page', [], ctl.isCancelled, ctl.progress))!
    const by = (id: string) => r.segments.filter((s) => s.nodeId === id)
    expect(r.segments.some((s) => s.nodeId === 't4')).toBe(false)
    expect(by('t1')[0].overridden).toBe(false)
    expect(by('t2')[0].overridden).toBe(true)
    expect(by('t3')).toHaveLength(1) // однакові фрагменти злиті
    expect(by('t5')[0].inMain).toBe(true)
    expect(by('t6')[0].inInstance).toBe(true)
    expect(by('t6')[0].inMain).toBe(false)
    expect(r.local.map((s) => s.name)).toEqual(['Body/M'])
  })

  it('«Виділення» бере збережені шари, а не поточне виділення', async () => {
    const a = frame('a', 'FRAME', page)
    const b = frame('b', 'FRAME', page)
    text('ta', a, [run(I('Regular'), 16, 24)])
    text('tb', b, [run(I('Regular'), 16, 24)])
    const r = (await scan('selection', ['a'], ctl.isCancelled, ctl.progress))!
    expect(r.segments.map((s) => s.nodeId)).toEqual(['ta'])
  })
})

describe('заміна шрифту', () => {
  it('оновлює локальний стиль, міняє текст без стилю, пропускає головні компоненти і бібліотечні стилі', async () => {
    const local = style('Heading', M('Bold'), 24, 32)
    const lib = style('Lib/Body', M('Regular'), 16, 24, true)
    const screen = frame('screen', 'FRAME', page)
    text('styled', screen, [run(M('Bold'), 24, 32, local.id)])
    text('raw', screen, [run(M('SemiBold'), 16, 22), run(I('Regular'), 16, 22)])
    text('lib', screen, [run(M('Regular'), 16, 24, lib.id)])
    const comp = frame('comp', 'COMPONENT', page)
    text('inmain', comp, [run(M('Bold'), 14, 20)])
    text('missing', screen, [run(M('Bold'), 14, 20)], true)

    const r = (await scan('page', [], ctl.isCancelled, ctl.progress))!
    const res = (await applyFonts(r.segments, 'Inter', { 'Manrope|Bold': 'Bold', 'Manrope|SemiBold': 'Semi Bold', 'Manrope|Regular': 'Regular' }, available.Inter, false, ctl))!

    expect(local.fontName).toEqual(I('Bold'))
    expect(res.stylesUpdated).toBe(1)
    expect(nodes.get('styled').runs[0].fontName).toEqual(I('Bold'))
    expect(nodes.get('raw').runs[0].fontName).toEqual(I('Semi Bold'))
    expect(nodes.get('raw').runs[1].fontName).toEqual(I('Regular'))
    expect(nodes.get('lib').runs[0].fontName).toEqual(M('Regular'))
    expect(nodes.get('inmain').runs[0].fontName).toEqual(M('Bold'))
    expect(res.skippedMain).toBe(1)
    expect(res.skippedRemote).toBe(1)
    expect(res.skippedMissing).toBe(1)
    expect(res.reflow).toContain('raw')
  })

  it('шар зі шрифтом, який не завантажується, пропускається, а решта змінюється (помилка «unloaded font»)', async () => {
    available.Poppins = ['Medium'] // SemiBold «є» в шарі, але не завантажується
    const screen = frame('screen', 'FRAME', page)
    text('bad', screen, [run({ family: 'Poppins', style: 'SemiBold' }, 16, 22)])
    text('good', screen, [run({ family: 'Poppins', style: 'Medium' }, 16, 22)])
    text('mixed', screen, [run({ family: 'Poppins', style: 'Medium' }, 16, 22), run({ family: 'Poppins', style: 'SemiBold' }, 16, 22)])
    const r = (await scan('page', [], ctl.isCancelled, ctl.progress))!
    const res = (await applyFonts(r.segments, 'Inter', { 'Poppins|SemiBold': 'Semi Bold', 'Poppins|Medium': 'Medium' }, available.Inter, false, ctl))!
    expect(nodes.get('good').runs[0].fontName).toEqual(I('Medium'))
    expect(nodes.get('bad').runs[0].fontName).toEqual({ family: 'Poppins', style: 'SemiBold' })
    expect(nodes.get('mixed').runs[0].fontName).toEqual({ family: 'Poppins', style: 'Medium' })
    expect(res.layersChanged).toBe(1)
    expect(res.skippedMissing).toBe(2)
  })

  it('з галочкою головні компоненти теж змінюються', async () => {
    const comp = frame('comp', 'COMPONENT', page)
    text('inmain', comp, [run(M('Bold'), 14, 20)])
    const r = (await scan('page', [], ctl.isCancelled, ctl.progress))!
    await applyFonts(r.segments, 'Inter', { 'Manrope|Bold': 'Bold' }, available.Inter, true, ctl)
    expect(nodes.get('inmain').runs[0].fontName).toEqual(I('Bold'))
  })
})

describe('стилі', () => {
  it('створює стилі й привʼязує текст за ключами комбінацій', async () => {
    const screen = frame('screen', 'FRAME', page)
    text('a', screen, [run(I('Regular'), 16, 24)])
    text('b', screen, [run(I('Regular'), 15, 22), run(I('Bold'), 15, 22)])
    const r = (await scan('page', [], ctl.isCancelled, ctl.progress))!
    const res = await applyStyles(
      r.segments,
      [
        {
          name: 'Body/M',
          spec: { family: 'Inter', style: 'Regular', size: 16, lineHeight: { unit: 'PIXELS', value: 24 }, letterSpacing: { unit: 'PIXELS', value: 0 } },
          members: ['Inter|Regular|16|24px|0', 'Inter|Regular|15|22px|0'],
        },
      ],
      true,
      false,
      ctl
    )
    expect(res.created).toBe(1)
    expect(res.linked).toBe(2)
    const created = styles.get(res.createdIds[0])!
    expect(created.name).toBe('Body/M')
    expect(created.fontSize).toBe(16)
    expect(nodes.get('b').runs[0].textStyleId).toBe(created.id)
    expect(nodes.get('b').runs[0].fontSize).toBe(16) // текст отримав значення стилю
    expect(nodes.get('b').runs[1].textStyleId).toBe('') // жирне слово не входило в стиль
  })

  it('шрифт недоступний – стиль не створюється, решта працює', async () => {
    const screen = frame('screen', 'FRAME', page)
    text('a', screen, [run(I('Regular'), 16, 24)])
    const r = (await scan('page', [], ctl.isCancelled, ctl.progress))!
    const res = await applyStyles(
      r.segments,
      [{ name: 'X', spec: { family: 'Nope', style: 'Regular', size: 16, lineHeight: { unit: 'AUTO' }, letterSpacing: { unit: 'PIXELS', value: 0 } }, members: [] }],
      true,
      false,
      ctl
    )
    expect(res.created).toBe(0)
    expect(res.failedFonts).toEqual(['X'])
  })

  it('скидання ручних правок повертає значення стилю', async () => {
    const body = style('Body/M', I('Regular'), 16, 24)
    const screen = frame('screen', 'FRAME', page)
    text('t', screen, [run(I('Regular'), 18, 24, body.id)])
    const r = (await scan('page', [], ctl.isCancelled, ctl.progress))!
    const res = await resetOverrides(r.segments, false, ctl)
    expect(res.reset).toBe(1)
    expect(nodes.get('t').runs[0].fontSize).toBe(16)
  })
})
