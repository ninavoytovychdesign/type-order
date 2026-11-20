// Type Order: аналіз і впорядкування типографіки.
import { Lang, LANGS } from './core/i18n'
import { computeStats, rawCombos, nodesFor } from './core/stats'
import { AnalysisVM, FontUse, Notice, Scope, ToMain, ToUI } from './core/protocol'
import { scan, ScanResult, pageOf } from './figma/scan'
import { applyFonts, applyStyles, resetOverrides } from './figma/apply'
import { buildReport } from './figma/report'

figma.showUI(__html__, { width: 380, height: 640, themeColors: true })

const post = (m: ToUI) => figma.ui.postMessage(m)
const notice = (n: Notice) => post({ type: 'notice', notice: n })

let lang: Lang = 'en'
let last: { scope: Scope; roots: string[]; result: ScanResult } | null = null
let cancelled = false
let busy = false
let families: string[] | null = null
let available: Map<string, string[]> | null = null

async function fontsAvailable(): Promise<Map<string, string[]>> {
  if (available) return available
  const list = await figma.listAvailableFontsAsync()
  const m = new Map<string, string[]>()
  for (const f of list) {
    const arr = m.get(f.fontName.family)
    if (arr) arr.push(f.fontName.style)
    else m.set(f.fontName.family, [f.fontName.style])
  }
  available = m
  return m
}

function viewModel(scope: Scope, r: ScanResult): AnalysisVM {
  const segs = r.segments
  const stats = computeStats(segs)
  const fonts = new Map<string, FontUse & { nodes: Set<string>; remote: Set<string>; missing: Set<string> }>()
  for (const s of segs) {
    const k = s.spec.family + '|' + s.spec.style
    let f = fonts.get(k)
    if (!f) fonts.set(k, (f = { family: s.spec.family, style: s.spec.style, layers: 0, remoteLayers: 0, missingLayers: 0, nodes: new Set(), remote: new Set(), missing: new Set() }))
    f.nodes.add(s.nodeId)
    if (s.styleRemote) f.remote.add(s.nodeId)
    if (s.missingFont) f.missing.add(s.nodeId)
  }
  const localStylesByFamily: Record<string, number> = {}
  for (const st of r.local) localStylesByFamily[st.spec.family] = (localStylesByFamily[st.spec.family] || 0) + 1
  return {
    scope,
    stats,
    combos: rawCombos(segs),
    existing: r.local,
    fonts: Array.from(fonts.values())
      .map((f) => ({ family: f.family, style: f.style, layers: f.nodes.size, remoteLayers: f.remote.size, missingLayers: f.missing.size }))
      .sort((a, b) => b.layers - a.layers),
    localStylesByFamily,
    mainLayers: new Set(segs.filter((s) => s.inMain).map((s) => s.nodeId)).size,
  }
}

const ctl = {
  isCancelled: () => cancelled,
  progress: (done: number, total: number) => post({ type: 'progress', done, total }),
}

/** roots – що було виділено під час аналізу: повторний аналіз після змін бере ті самі шари. */
async function analyze(scope: Scope, roots?: string[], quiet = false) {
  const ids = roots || figma.currentPage.selection.map((n) => n.id)
  if (scope === 'selection' && ids.length === 0) {
    notice({ code: 'note.nothingSelected', level: 'warn' })
    return
  }
  const r = await scan(scope, ids, ctl.isCancelled, ctl.progress)
  if (!r) {
    notice({ code: 'note.cancelled', level: 'warn' })
    return
  }
  last = { scope, roots: ids, result: r }
  post({ type: 'analysis', vm: viewModel(scope, r) })
  if (quiet) return
  const layers = new Set(r.segments.map((s) => s.nodeId)).size
  notice(layers ? { code: 'note.analyzed', params: { n: layers }, level: 'ok' } : { code: 'note.noText', level: 'warn' })
}

async function select(ids: string[]) {
  const nodes: SceneNode[] = []
  for (const id of ids) {
    const n = await figma.getNodeByIdAsync(id)
    if (n && !n.removed && n.type !== 'PAGE' && n.type !== 'DOCUMENT') nodes.push(n as SceneNode)
  }
  if (!nodes.length) {
    notice({ code: 'note.stale', level: 'warn' })
    return
  }
  const byPage = new Map<PageNode, SceneNode[]>()
  for (const n of nodes) {
    const p = pageOf(n)
    if (!p) continue
    const arr = byPage.get(p)
    if (arr) arr.push(n)
    else byPage.set(p, [n])
  }
  let best: [PageNode, SceneNode[]] | null = null
  for (const e of byPage) if (!best || e[1].length > best[1].length) best = e
  if (!best) return
  if (figma.currentPage !== best[0]) await figma.setCurrentPageAsync(best[0])
  figma.currentPage.selection = best[1]
  figma.viewport.scrollAndZoomIntoView(best[1])
  notice({ code: 'note.selected', params: { n: best[1].length }, level: 'ok' })
  if (byPage.size > 1) notice({ code: 'note.selectedOther', level: 'warn' })
}

async function run(code: string, fn: () => Promise<void>) {
  if (busy) return
  busy = true
  cancelled = false
  post({ type: 'busy', busy: true, code })
  try {
    await fn()
  } catch (e) {
    notice({ code: 'note.error', params: { message: e instanceof Error ? e.message : String(e) }, level: 'error' })
  } finally {
    busy = false
    post({ type: 'busy', busy: false })
  }
}

function warnCount(code: string, n: number, nodes?: string[]) {
  if (n > 0) notice({ code, params: { n }, level: 'warn', nodes })
}

figma.ui.onmessage = async (msg: ToMain) => {
  switch (msg.type) {
    case 'init': {
      const saved = await figma.clientStorage.getAsync('lang')
      if (LANGS.includes(saved)) lang = saved
      post({ type: 'lang', lang })
      post({ type: 'selection', count: figma.currentPage.selection.length })
      break
    }
    case 'set-lang':
      lang = msg.lang
      await figma.clientStorage.setAsync('lang', lang)
      break
    case 'analyze':
      await run('busy.analyzing', () => analyze(msg.scope))
      break
    case 'cancel':
      cancelled = true
      break
    case 'select':
      if (msg.filter.kind === 'nodes') await select(msg.filter.value)
      else if (last) await select(nodesFor(last.result.segments, msg.filter))
      break
    case 'list-families': {
      if (!families) families = Array.from((await fontsAvailable()).keys()).sort((a, b) => a.localeCompare(b))
      post({ type: 'families', families })
      break
    }
    case 'family-styles': {
      const m = await fontsAvailable()
      post({ type: 'family-styles', family: msg.family, styles: m.get(msg.family) || [] })
      break
    }
    case 'apply-fonts':
      await run('busy.applying', async () => {
        if (!last) return
        const styles = (await fontsAvailable()).get(msg.target) || []
        const r = await applyFonts(last.result.segments, msg.target, msg.mapping, styles, msg.includeMain, ctl)
        if (!r) return
        notice({ code: 'note.fontsDone', params: { layers: r.layersChanged, styles: r.stylesUpdated }, level: 'ok' })
        warnCount('note.fontsReflow', r.reflow.length, r.reflow)
        warnCount('note.fontsFixed', r.fixedBox.length, r.fixedBox)
        warnCount('note.skippedMain', r.skippedMain)
        warnCount('note.skippedRemote', r.skippedRemote)
        warnCount('note.skippedMissing', r.skippedMissing)
        if (r.unavailable.length) notice({ code: 'note.fontsUnavailable', params: { fonts: r.unavailable.map((f) => f.replace('|', ' ')).join(', ') }, level: 'warn' })
        if (cancelled) notice({ code: 'note.cancelled', level: 'warn' })
        await analyze(last.scope, last.roots, true)
      })
      break
    case 'apply-styles':
      await run('busy.applying', async () => {
        if (!last) return
        const r = await applyStyles(last.result.segments, msg.proposals, msg.link, msg.includeMain, ctl)
        notice({ code: 'note.stylesDone', params: { created: r.created, linked: r.linked }, level: 'ok' })
        if (r.failedFonts.length) notice({ code: 'note.stylesFailed', params: { names: r.failedFonts.join(', ') }, level: 'warn' })
        warnCount('note.skippedMain', r.skippedMain)
        warnCount('note.skippedMissing', r.skippedMissing)
        if (cancelled) notice({ code: 'note.cancelled', level: 'warn' })
        await analyze(last.scope, last.roots, true)
      })
      break
    case 'reset-overrides':
      await run('busy.applying', async () => {
        if (!last) return
        const r = await resetOverrides(last.result.segments, msg.includeMain, ctl)
        notice({ code: 'note.resetDone', params: { n: r.reset }, level: 'ok' })
        warnCount('note.skippedMain', r.skippedMain)
        await analyze(last.scope, last.roots, true)
      })
      break
    case 'report':
      await run('busy.reporting', async () => {
        if (!last) return
        await buildReport(lang, last.scope, computeStats(last.result.segments), msg.proposals)
        notice({ code: 'note.reportDone', level: 'ok' })
      })
      break
    case 'resize':
      figma.ui.resize(380, Math.max(360, Math.min(900, Math.round(msg.height))))
      break
  }
}

const selCount = () => post({ type: 'selection', count: figma.currentPage.selection.length })
figma.on('selectionchange', selCount)
figma.on('currentpagechange', selCount)


