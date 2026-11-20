// Обхід текстових шарів і читання їх типографіки.
import { Spec, sameSpec } from '../core/spec'
import { Seg } from '../core/stats'
import { ExistingStyle } from '../core/scale'
import { Scope } from '../core/protocol'

export interface ScanSeg extends Seg {
  pageId: string
}

export interface ScanResult {
  segments: ScanSeg[]
  local: ExistingStyle[]
}

export const FIELDS = ['fontName', 'fontSize', 'lineHeight', 'letterSpacing', 'textStyleId'] as const

export function toSpec(fontName: FontName, size: number, lh: LineHeight, ls: LetterSpacing): Spec {
  return {
    family: fontName.family,
    style: fontName.style,
    size,
    lineHeight: lh.unit === 'AUTO' ? { unit: 'AUTO' } : { unit: lh.unit, value: lh.value },
    letterSpacing: { unit: ls.unit, value: ls.value },
  }
}

export function styleSpec(s: TextStyle): Spec {
  return toSpec(s.fontName, s.fontSize, s.lineHeight, s.letterSpacing)
}

/** Кеш стилів за id: локальні й бібліотечні, якими користується файл. */
export class StyleCache {
  private m = new Map<string, ExistingStyle | null>()
  async get(id: string): Promise<ExistingStyle | null> {
    if (!id) return null
    if (this.m.has(id)) return this.m.get(id)!
    let v: ExistingStyle | null = null
    try {
      const s = await figma.getStyleByIdAsync(id)
      if (s && s.type === 'TEXT') v = { id: s.id, name: s.name, spec: styleSpec(s as TextStyle), remote: s.remote }
    } catch (_e) {
      v = null
    }
    this.m.set(id, v)
    return v
  }
}

export interface NodeCtx {
  hidden: boolean
  inInstance: boolean
  inMain: boolean
}

/** Видимість і належність до інстанса/головного компонента – з кешем по батьках. */
export class Ancestry {
  private m = new Map<string, NodeCtx>()
  of(node: BaseNode): NodeCtx {
    const cached = this.m.get(node.id)
    if (cached) return cached
    const parent = node.parent
    let ctx: NodeCtx
    if (!parent || parent.type === 'PAGE' || parent.type === 'DOCUMENT') ctx = { hidden: false, inInstance: false, inMain: false }
    else {
      const p = this.of(parent)
      const pn = parent as SceneNode
      ctx = {
        hidden: p.hidden || ('visible' in pn && pn.visible === false),
        inInstance: p.inInstance || parent.type === 'INSTANCE',
        inMain: p.inMain || ((parent.type === 'COMPONENT' || parent.type === 'COMPONENT_SET') && !p.inInstance),
      }
    }
    if ('visible' in node && (node as SceneNode).visible === false) ctx = { ...ctx, hidden: true }
    this.m.set(node.id, ctx)
    return ctx
  }
}

export function pageOf(node: BaseNode): PageNode | null {
  let n: BaseNode | null = node
  while (n && n.type !== 'PAGE') n = n.parent
  return n as PageNode | null
}

export async function collectTextNodes(scope: Scope, roots: string[]): Promise<TextNode[]> {
  const out: TextNode[] = []
  const add = (n: SceneNode | PageNode) => {
    if (n.type === 'TEXT') out.push(n)
    else if ('findAllWithCriteria' in n) out.push(...(n as ChildrenMixin).findAllWithCriteria({ types: ['TEXT'] }))
  }
  if (scope === 'selection')
    for (const id of roots) {
      const n = await figma.getNodeByIdAsync(id)
      if (n && !n.removed && n.type !== 'DOCUMENT' && n.type !== 'PAGE') add(n as SceneNode)
    }
  else if (scope === 'page') add(figma.currentPage)
  else
    for (const page of figma.root.children) {
      await page.loadAsync()
      add(page)
    }
  const seen = new Set<string>()
  return out.filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)))
}

export const tick = () => new Promise<void>((r) => setTimeout(r, 0))

export async function scan(
  scope: Scope,
  roots: string[],
  isCancelled: () => boolean,
  onProgress: (done: number, total: number) => void
): Promise<ScanResult | null> {
  const nodes = await collectTextNodes(scope, roots)
  const anc = new Ancestry()
  const styles = new StyleCache()
  const segments: ScanSeg[] = []
  for (let i = 0; i < nodes.length; i++) {
    if (i % 150 === 0) {
      onProgress(i, nodes.length)
      await tick()
      if (isCancelled()) return null
    }
    const node = nodes[i]
    const ctx = anc.of(node)
    if (ctx.hidden || node.characters.length === 0) continue
    let parts: Array<StyledTextSegment & { fontName: FontName; fontSize: number; lineHeight: LineHeight; letterSpacing: LetterSpacing; textStyleId: string }>
    try {
      parts = node.getStyledTextSegments(FIELDS.slice()) as typeof parts
    } catch (_e) {
      continue
    }
    const page = pageOf(node)
    for (const p of parts) {
      const spec = toSpec(p.fontName, p.fontSize, p.lineHeight, p.letterSpacing)
      const st = await styles.get(p.textStyleId)
      segments.push({
        nodeId: node.id,
        pageId: page ? page.id : '',
        spec,
        styleId: st ? st.id : '',
        styleRemote: st ? st.remote : false,
        overridden: st ? !sameSpec(spec, st.spec) : false,
        inInstance: ctx.inInstance,
        inMain: ctx.inMain,
        missingFont: node.hasMissingFont,
      })
    }
  }
  onProgress(nodes.length, nodes.length)
  const local = (await figma.getLocalTextStylesAsync()).map((s) => ({ id: s.id, name: s.name, spec: styleSpec(s), remote: false }))
  return { segments, local }
}
