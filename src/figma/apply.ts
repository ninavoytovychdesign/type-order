// Зміни у файлі: заміна шрифтів, створення й привʼязка стилів, скидання ручних правок.
import { specKey, sameSpec } from '../core/spec'
import { mapStyle } from '../core/fonts'
import { ProposalIn } from '../core/protocol'
import { ScanSeg, StyleCache, FIELDS, toSpec, tick } from './scan'

type Part = StyledTextSegment & { fontName: FontName; fontSize: number; lineHeight: LineHeight; letterSpacing: LetterSpacing; textStyleId: string }

export interface Ctl {
  isCancelled: () => boolean
  progress: (done: number, total: number) => void
}

const fontKey = (f: FontName) => f.family + '|' + f.style

/** Завантаження шрифтів з кешем; false – шрифт недоступний. */
export class Fonts {
  private m = new Map<string, Promise<boolean>>()
  load(f: FontName): Promise<boolean> {
    const k = fontKey(f)
    let p = this.m.get(k)
    if (!p) {
      // друга спроба: перше завантаження шрифту іноді падає випадково
      p = figma.loadFontAsync(f).then(
        () => true,
        () => figma.loadFontAsync(f).then(() => true, () => false)
      )
      this.m.set(k, p)
    }
    return p
  }

  /**
   * Figma дозволяє змінювати текст, лише коли завантажені всі шрифти, що вже є в шарі.
   * false – хоч один не завантажився: шар краще пропустити, ніж зупинити всю дію помилкою.
   */
  async loadNode(node: TextNode): Promise<boolean> {
    if (!node.characters.length) return true
    const all = node.getRangeAllFontNames(0, node.characters.length)
    const ok = await Promise.all(all.map((f) => this.load(f)))
    return ok.every(Boolean)
  }
}

async function textNode(id: string): Promise<TextNode | null> {
  const n = await figma.getNodeByIdAsync(id)
  return n && n.type === 'TEXT' && !n.removed ? n : null
}

/** Шари, у яких змінилось перенесення рядків (або ширина для «hug»-тексту). */
function reflowed(before: { w: number; h: number; mode: string }, node: TextNode): boolean {
  if (before.mode === 'HEIGHT') return Math.abs(node.height - before.h) > 0.5
  if (before.mode === 'WIDTH_AND_HEIGHT') return Math.abs(node.width - before.w) > 1 || Math.abs(node.height - before.h) > 0.5
  return false
}

function groupByNode(segs: ScanSeg[]): string[] {
  // головні компоненти першими: їхні зміни самі дійдуть до інстансів
  const main = new Set<string>()
  const rest = new Set<string>()
  for (const s of segs) (s.inMain ? main : rest).add(s.nodeId)
  return [...main, ...Array.from(rest).filter((id) => !main.has(id))]
}

export interface FontsResult {
  stylesUpdated: number
  layersChanged: number
  skippedMain: number
  skippedRemote: number
  skippedMissing: number
  unavailable: string[]
  reflow: string[]
  fixedBox: string[]
}

export async function applyFonts(
  segs: ScanSeg[],
  target: string,
  mapping: Record<string, string>,
  targetStyles: string[],
  includeMain: boolean,
  ctl: Ctl
): Promise<FontsResult | null> {
  const fonts = new Fonts()
  const res: FontsResult = { stylesUpdated: 0, layersChanged: 0, skippedMain: 0, skippedRemote: 0, skippedMissing: 0, unavailable: [], reflow: [], fixedBox: [] }
  const families = new Set(Object.keys(mapping).map((k) => k.split('|')[0]))
  const dest = (f: FontName): FontName | null => {
    if (f.family === target || !families.has(f.family)) return null
    const style = mapping[fontKey(f)] || mapStyle(f.style, targetStyles)
    return style ? { family: target, style } : null
  }
  const ready = async (f: FontName) => {
    const ok = await fonts.load(f)
    if (!ok && !res.unavailable.includes(fontKey(f))) res.unavailable.push(fontKey(f))
    return ok
  }

  // 1. Локальні стилі: міняємо сам стиль, а текст оновиться за ним.
  for (const s of await figma.getLocalTextStylesAsync()) {
    const d = dest(s.fontName)
    if (!d || !(await ready(d))) continue
    s.fontName = d
    res.stylesUpdated++
  }

  // 2. Текст без стилю або з ручною зміною шрифту.
  const relevant = segs.filter((s) => families.has(s.spec.family) && s.spec.family !== target)
  const skipped = { main: new Set<string>(), remote: new Set<string>(), missing: new Set<string>() }
  const todo = relevant.filter((s) => {
    if (s.missingFont) return skipped.missing.add(s.nodeId), false
    if (s.inMain && !includeMain) return skipped.main.add(s.nodeId), false
    return true
  })
  const ids = groupByNode(todo)
  const styles = new StyleCache()
  for (let i = 0; i < ids.length; i++) {
    if (i % 40 === 0) {
      ctl.progress(i, ids.length)
      await tick()
      if (ctl.isCancelled()) break
    }
    const node = await textNode(ids[i])
    if (!node) continue
    if (node.hasMissingFont || !(await fonts.loadNode(node))) {
      skipped.missing.add(node.id)
      continue
    }
    const before = { w: node.width, h: node.height, mode: node.textAutoResize }
    let changed = false
    const parts = node.getStyledTextSegments(FIELDS.slice()) as Part[]
    try {
      for (const p of parts) {
        const d = dest(p.fontName)
        if (!d) continue
        const st = await styles.get(p.textStyleId)
        // бібліотечний стиль, у якому шрифт не перебитий вручну, – змінюється лише в бібліотеці
        if (st && st.remote && st.spec.family === p.fontName.family) {
          skipped.remote.add(node.id)
          continue
        }
        if (!(await ready(d))) continue
        node.setRangeFontName(p.start, p.end, d)
        changed = true
      }
    } catch {
      // один проблемний шар не зупиняє заміну в інших
      skipped.missing.add(node.id)
    }
    if (!changed) continue
    res.layersChanged++
    if (reflowed(before, node)) res.reflow.push(node.id)
    else if (before.mode === 'NONE' || before.mode === 'TRUNCATE') res.fixedBox.push(node.id)
  }
  ctl.progress(ids.length, ids.length)
  res.skippedMain = skipped.main.size
  res.skippedRemote = skipped.remote.size
  res.skippedMissing = skipped.missing.size
  figma.commitUndo()
  return res
}

export interface StylesResult {
  created: number
  createdIds: string[]
  failedFonts: string[]
  linked: number
  skippedMain: number
  skippedMissing: number
}

export async function applyStyles(segs: ScanSeg[], proposals: ProposalIn[], link: boolean, includeMain: boolean, ctl: Ctl): Promise<StylesResult> {
  const fonts = new Fonts()
  const res: StylesResult = { created: 0, createdIds: [], failedFonts: [], linked: 0, skippedMain: 0, skippedMissing: 0 }
  const byKey = new Map<string, string>()
  const styleFont = new Map<string, FontName>()

  for (const p of proposals) {
    let id = p.existingId
    if (!id) {
      const f = { family: p.spec.family, style: p.spec.style }
      if (!(await fonts.load(f))) {
        res.failedFonts.push(p.name)
        continue
      }
      const s = figma.createTextStyle()
      s.name = p.name
      s.fontName = f
      s.fontSize = p.spec.size
      s.lineHeight = p.spec.lineHeight.unit === 'AUTO' ? { unit: 'AUTO' } : { unit: p.spec.lineHeight.unit, value: p.spec.lineHeight.value }
      s.letterSpacing = { unit: p.spec.letterSpacing.unit, value: p.spec.letterSpacing.value }
      id = s.id
      res.created++
      res.createdIds.push(id)
    }
    styleFont.set(id, { family: p.spec.family, style: p.spec.style })
    for (const m of p.members) byKey.set(m, id)
  }

  if (link) {
    const raw = segs.filter((s) => !s.styleId && byKey.has(specKey(s.spec)))
    const main = new Set<string>()
    const missing = new Set<string>()
    const todo = raw.filter((s) => {
      if (s.missingFont) return missing.add(s.nodeId), false
      if (s.inMain && !includeMain) return main.add(s.nodeId), false
      return true
    })
    const ids = groupByNode(todo)
    for (let i = 0; i < ids.length; i++) {
      if (i % 40 === 0) {
        ctl.progress(i, ids.length)
        await tick()
        if (ctl.isCancelled()) break
      }
      const node = await textNode(ids[i])
      if (!node) continue
      if (node.hasMissingFont || !(await fonts.loadNode(node))) {
        missing.add(node.id)
        continue
      }
      let done = false
      try {
        // читаємо заново: між аналізом і застосуванням текст міг змінитись
        for (const p of node.getStyledTextSegments(FIELDS.slice()) as Part[]) {
          if (p.textStyleId) continue
          const id = byKey.get(specKey(toSpec(p.fontName, p.fontSize, p.lineHeight, p.letterSpacing)))
          if (!id) continue
          const f = styleFont.get(id)
          if (f && !(await fonts.load(f))) continue
          await node.setRangeTextStyleIdAsync(p.start, p.end, id)
          done = true
        }
      } catch {
        missing.add(node.id)
      }
      if (done) res.linked++
    }
    ctl.progress(ids.length, ids.length)
    res.skippedMain = main.size
    res.skippedMissing = missing.size
  }
  figma.commitUndo()
  return res
}

/** Повернути тексту значення його стилю: відʼєднати й привʼязати знову. */
export async function resetOverrides(segs: ScanSeg[], includeMain: boolean, ctl: Ctl): Promise<{ reset: number; skippedMain: number }> {
  const fonts = new Fonts()
  const styles = new StyleCache()
  const over = segs.filter((s) => s.styleId && s.overridden && !s.missingFont)
  const skippedMain = new Set(over.filter((s) => s.inMain && !includeMain).map((s) => s.nodeId))
  const ids = groupByNode(over.filter((s) => includeMain || !s.inMain))
  let reset = 0
  for (let i = 0; i < ids.length; i++) {
    if (i % 40 === 0) {
      ctl.progress(i, ids.length)
      await tick()
      if (ctl.isCancelled()) break
    }
    const node = await textNode(ids[i])
    if (!node || node.hasMissingFont || !(await fonts.loadNode(node))) continue
    let done = false
    try {
      for (const p of node.getStyledTextSegments(FIELDS.slice()) as Part[]) {
        const st = await styles.get(p.textStyleId)
        if (!st || sameSpec(st.spec, toSpec(p.fontName, p.fontSize, p.lineHeight, p.letterSpacing))) continue
        const f = { family: st.spec.family, style: st.spec.style }
        if (!(await fonts.load(f))) continue
        await node.setRangeTextStyleIdAsync(p.start, p.end, '')
        await node.setRangeTextStyleIdAsync(p.start, p.end, st.id)
        done = true
      }
    } catch {
      // пропускаємо шар і йдемо далі
    }
    if (done) reset++
  }
  ctl.progress(ids.length, ids.length)
  figma.commitUndo()
  return { reset, skippedMain: skippedMain.size }
}
