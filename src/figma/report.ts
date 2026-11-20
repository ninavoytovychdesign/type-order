// Звіт фреймом на канвасі: автолейаут, без ручних координат усередині.
import { Lang, translate } from '../core/i18n'
import { Stats } from '../core/stats'
import { Scope, ReportProposal } from '../core/protocol'
import { formatSpec, r2 } from '../core/spec'
import { Fonts } from './apply'

const INK = { r: 0.08, g: 0.09, b: 0.1 }
const MUTED = { r: 0.42, g: 0.45, b: 0.49 }
const LINE = { r: 0.9, g: 0.91, b: 0.92 }

function vstack(name: string, gap: number): FrameNode {
  const f = figma.createFrame()
  f.name = name
  f.layoutMode = 'VERTICAL'
  f.itemSpacing = gap
  f.fills = []
  f.primaryAxisSizingMode = 'AUTO'
  f.counterAxisSizingMode = 'AUTO'
  return f
}

export async function buildReport(lang: Lang, scope: Scope, stats: Stats, proposals: ReportProposal[]): Promise<FrameNode> {
  const t = (k: string, p?: Record<string, string | number>) => translate(lang, k, p)
  const fonts = new Fonts()
  const R: FontName = { family: 'Inter', style: 'Regular' }
  const S: FontName = { family: 'Inter', style: 'Semi Bold' }
  const B: FontName = { family: 'Inter', style: 'Bold' }
  await Promise.all([R, S, B].map((f) => fonts.load(f)))

  const root = vstack(t('report.title'), 28)
  root.paddingTop = root.paddingBottom = root.paddingLeft = root.paddingRight = 40
  root.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]
  root.cornerRadius = 16
  root.counterAxisSizingMode = 'FIXED'
  root.resize(640, 100)

  const text = (parent: FrameNode, chars: string, font: FontName, size: number, color = INK, lh?: number) => {
    const n = figma.createText()
    n.fontName = font
    n.fontSize = size
    if (lh) n.lineHeight = { unit: 'PIXELS', value: lh }
    n.characters = chars
    n.fills = [{ type: 'SOLID', color }]
    parent.appendChild(n)
    n.layoutSizingHorizontal = 'FILL'
    n.textAutoResize = 'HEIGHT'
    return n
  }
  const section = (title: string) => {
    const s = vstack(title, 10)
    root.appendChild(s)
    s.layoutSizingHorizontal = 'FILL'
    s.strokes = [{ type: 'SOLID', color: LINE }]
    s.strokeTopWeight = 1
    s.strokeBottomWeight = s.strokeLeftWeight = s.strokeRightWeight = 0
    s.paddingTop = 20
    text(s, title, S, 16, INK, 24)
    return s
  }

  const head = vstack('Header', 6)
  root.appendChild(head)
  head.layoutSizingHorizontal = 'FILL'
  text(head, t('report.title'), B, 28, INK, 36)
  const date = new Date().toISOString().slice(0, 10)
  text(head, t('report.meta', { scope: t('scope.' + scope), date }), R, 13, MUTED, 20)

  const sum = section(t('report.summary'))
  text(
    sum,
    [
      `${t('sum.layers')}: ${stats.textLayers}`,
      `${t('sum.fonts')}: ${stats.families.length}`,
      `${t('sum.sizes')}: ${stats.sizes.length}`,
      `${t('sum.combos')}: ${stats.combos}`,
    ].join('   ·   '),
    R,
    14,
    INK,
    22
  )
  text(sum, t('report.coverage', stats.coverage), R, 14, MUTED, 22)

  const fs = section(t('report.fonts'))
  for (const f of stats.families)
    text(fs, `${f.family} – ${t('n.layers', { n: f.layers })}: ${f.styles.map((s) => `${s.key} (${s.layers})`).join(', ')}`, R, 14, INK, 22)

  const sz = section(t('report.sizes'))
  text(sz, stats.sizes.map((s) => `${r2(s.size)} (${s.layers})`).join('  ·  '), R, 14, INK, 22)
  if (stats.nearSizes.length) text(sz, t('ov.near', { pairs: stats.nearSizes.map(([a, b]) => `${a}/${b}`).join(', ') }), R, 13, MUTED, 20)

  const issues: Array<[string, number]> = [
    ['issue.raw', stats.coverage.raw],
    ['issue.overridden', stats.coverage.overridden],
    ['issue.mixed', stats.mixedStyles],
    ['issue.missing', stats.missingFont],
  ]
  const is = section(t('report.issues'))
  const present = issues.filter(([, n]) => n > 0)
  if (!present.length) text(is, t('ov.noIssues'), R, 14, MUTED, 22)
  for (const [k, n] of present) text(is, `${t(k)} – ${t('n.layers', { n })}`, R, 14, INK, 22)

  if (proposals.length) {
    const ps = section(t('report.proposals'))
    for (const p of proposals) {
      const row = vstack(p.name, 4)
      ps.appendChild(row)
      row.layoutSizingHorizontal = 'FILL'
      row.paddingBottom = 8
      text(row, `${p.name}${p.existing ? ` (${t('report.existing')})` : ''} – ${formatSpec(p.spec)} – ${t('n.layers', { n: p.layers })}`, R, 12, MUTED, 18)
      const f = { family: p.spec.family, style: p.spec.style }
      if (await fonts.load(f)) {
        const sample = text(row, t('report.sample'), f, p.spec.size, INK)
        const lh = p.spec.lineHeight
        sample.lineHeight = lh.unit === 'AUTO' ? { unit: 'AUTO' } : { unit: lh.unit, value: lh.value }
        sample.letterSpacing = { unit: p.spec.letterSpacing.unit, value: p.spec.letterSpacing.value }
      }
    }
  }

  // праворуч від усього, що є на сторінці
  const kids = figma.currentPage.children.filter((n) => n.id !== root.id)
  if (kids.length) {
    const right = Math.max(...kids.map((n) => n.x + n.width))
    const top = Math.min(...kids.map((n) => n.y))
    root.x = right + 200
    root.y = top
  }
  figma.currentPage.selection = [root]
  figma.viewport.scrollAndZoomIntoView([root])
  return root
}
