// Панель плагіна. Вся логіка пропозицій і назв – спільна з кодом плагіна (src/core).
import { Lang, translate } from '../core/i18n'
import { AnalysisVM, Notice, Scope, ToMain, ToUI, ProposalIn, ReportProposal, SelectFilter } from '../core/protocol'
import { buildProposals, proposalKey, Proposal } from '../core/scale'
import { nameProposals, Convention } from '../core/naming'
import { mapStyle, parseStyle } from '../core/fonts'
import { formatSpec, r2 } from '../core/spec'
import { IssueKind } from '../core/stats'

type Tab = 'overview' | 'fonts' | 'styles'
type Row = Proposal & { key: string; name: string }

const send = (m: ToMain) => parent.postMessage({ pluginMessage: m }, '*')

const S = {
  lang: 'en' as Lang,
  scope: 'page' as Scope,
  scopeTouched: false,
  selCount: 0,
  busy: false,
  busyCode: '',
  progress: null as null | { done: number; total: number },
  vm: null as AnalysisVM | null,
  tab: 'overview' as Tab,
  notices: [] as Notice[],
  includeMain: false,
  // шрифти
  target: '',
  other: false,
  targetStyles: null as string[] | null,
  mapping: {} as Record<string, string>,
  families: null as string[] | null,
  // стилі
  conv: 'role' as Convention,
  merge: true,
  link: true,
  names: new Map<string, string>(),
  off: new Set<string>(),
  error: '',
}

const t = (k: string, p?: Record<string, string | number>) => translate(S.lang, k, p)
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const attr = (s: string | number) => esc(String(s))

// ---------- дані ----------

function rows(): Row[] {
  const vm = S.vm
  if (!vm) return []
  const ps = buildProposals(vm.combos, vm.existing, { merge: S.merge })
  const fresh = ps.filter((p) => !p.existing)
  const auto = nameProposals(
    fresh.map((p) => p.spec),
    S.conv,
    vm.existing.map((e) => e.name)
  )
  return ps.map((p) => {
    const key = proposalKey(p)
    const name = p.existing ? p.existing.name : S.names.get(key) ?? auto[fresh.indexOf(p)]
    return { ...p, key, name }
  })
}

function sourceFonts() {
  const vm = S.vm
  if (!vm || !S.target) return []
  return vm.fonts.filter((f) => f.family !== S.target)
}

function setTarget(family: string) {
  S.target = family
  S.targetStyles = null
  S.mapping = {}
  if (family) send({ type: 'family-styles', family })
}

// ---------- шматки розмітки ----------

function seg(act: string, items: Array<[string, string]>, current: string, disabled = false) {
  return `<div class="seg">${items
    .map(([v, label]) => `<button data-act="${act}" data-v="${attr(v)}" class="${v === current ? 'on' : ''}" ${disabled ? 'disabled' : ''}>${esc(label)}</button>`)
    .join('')}</div>`
}

function check(act: string, on: boolean, label: string, hint = '') {
  return `<label class="check"><input type="checkbox" data-act="${act}" ${on ? 'checked' : ''}/><span>${esc(label)}${hint ? `<span class="muted block">${esc(hint)}</span>` : ''}</span></label>`
}

function mainCheck() {
  const vm = S.vm
  if (!vm || !vm.mainLayers) return ''
  return check('main', S.includeMain, t('main.include') + ` (${t('n.layers', { n: vm.mainLayers })})`, t('main.hint'))
}

function chip(filter: SelectFilter, label: string, count: number, cls = '') {
  return `<button class="chip ${cls}" data-act="sel" data-f="${attr(JSON.stringify(filter))}">${esc(label)}<span class="n">${count}</span></button>`
}

function header() {
  const scopes: Array<[string, string]> = [
    ['selection', t('scope.selection') + (S.selCount ? ` (${S.selCount})` : '')],
    ['page', t('scope.page')],
    ['all', t('scope.all')],
  ]
  return `<div class="sec">
    <div class="row-h"><div><div class="brand">Type Order</div><div class="muted">${esc(t('app.tagline'))}</div></div>
      ${seg('lang', [['en', 'EN'], ['uk', 'UA']], S.lang)}</div>
    <div class="mt8">${seg('scope', scopes, S.scope, S.busy)}</div>
    <button class="primary wide mt8" data-act="analyze" ${S.busy || (S.scope === 'selection' && !S.selCount) ? 'disabled' : ''}>${esc(t(S.vm ? 'btn.reanalyze' : 'btn.analyze'))}</button>
  </div>`
}

function tabs() {
  const items: Tab[] = ['overview', 'fonts', 'styles']
  return `<div class="tabs">${items
    .map((x) => `<button data-act="tab" data-v="${x}" class="${S.tab === x ? 'on' : ''}" ${!S.vm ? 'disabled' : ''}>${esc(t('tab.' + x))}</button>`)
    .join('')}</div>`
}

function empty() {
  return `<div class="sec empty"><p class="strong">${esc(t('empty.title'))}</p><p class="muted">${esc(t('empty.body'))}</p>${
    S.scope === 'selection' && !S.selCount ? `<p class="warn-text">${esc(t('empty.noSelection'))}</p>` : ''
  }</div>`
}

function overview(vm: AnalysisVM) {
  const st = vm.stats
  const c = st.coverage
  const total = c.styled + c.overridden + c.raw || 1
  const pct = (x: number) => Math.round((x / total) * 100)
  const cards: Array<[string, number, string]> = [
    ['sum.layers', st.textLayers, ''],
    ['sum.fonts', st.families.length, ''],
    ['sum.sizes', st.sizes.length, ''],
    ['sum.combos', st.combos, t('sum.combosHint')],
  ]
  const issues: Array<[IssueKind, number, string]> = [
    ['raw', c.raw, ''],
    ['overridden', c.overridden, `<button class="small" data-act="reset">${esc(t('btn.resetOverrides'))}</button>`],
    ['mixed', st.mixedStyles, ''],
    ['missing', st.missingFont, ''],
    ['remote', st.remoteStyled, ''],
  ]
  const shown = issues.filter(([, n]) => n > 0)

  return `
  <div class="sec">
    <div class="cards">${cards.map(([k, n, hint]) => `<div class="card" ${hint ? `title="${attr(hint)}"` : ''}><div class="num">${n}</div><div class="muted">${esc(t(k))}</div></div>`).join('')}</div>
    <h2 class="mt12">${esc(t('cov.title'))} · ${pct(c.styled)}%</h2>
    <div class="bar"><div class="b-ok" style="width:${pct(c.styled)}%"></div><div class="b-warn" style="width:${pct(c.overridden)}%"></div><div class="b-bad" style="width:${pct(c.raw)}%"></div></div>
    <div class="legend muted"><span><i class="dot d-ok"></i>${esc(t('cov.styled'))} ${c.styled}</span><span><i class="dot d-warn"></i>${esc(t('cov.overridden'))} ${c.overridden}</span><span><i class="dot d-bad"></i>${esc(t('cov.raw'))} ${c.raw}</span></div>
    ${st.families.length > 1 ? `<div class="banner mt8">${esc(t('ov.manyFonts', { n: st.families.length }))} <button class="link" data-act="tab" data-v="fonts">${esc(t('tab.fonts'))} →</button></div>` : ''}
  </div>
  <div class="sec">
    <h2>${esc(t('ov.issues'))}</h2>
    ${
      shown.length
        ? shown
            .map(
              ([k, n, extra]) => `<div class="issue"><i class="dot ${k === 'remote' ? 'd-info' : k === 'raw' || k === 'missing' ? 'd-bad' : 'd-warn'}"></i>
          <div class="grow"><button class="link strong" data-act="sel" data-f="${attr(JSON.stringify({ kind: 'issue', value: k }))}">${esc(t('issue.' + k))} – ${esc(t('n.layers', { n }))}</button>
          <div class="muted">${esc(t('issue.' + k + '.hint'))}</div>${extra ? `<div class="mt4">${extra}</div>` : ''}</div></div>`
            )
            .join('')
        : `<p class="muted">${esc(t('ov.noIssues'))}</p>`
    }
    ${c.overridden ? `<div class="mt4">${mainCheck()}</div>` : ''}
  </div>
  <div class="sec">
    <h2>${esc(t('ov.fonts'))}</h2>
    ${st.families
      .map(
        (f) => `<div class="fam"><button class="link strong" data-act="sel" data-f="${attr(JSON.stringify({ kind: 'family', value: f.family }))}">${esc(f.family)}</button>
        <span class="muted">${esc(t('n.layers', { n: f.layers }))}</span>
        <div class="chips">${f.styles.map((s) => `<span class="tag">${esc(s.key)} · ${s.layers}</span>`).join('')}</div></div>`
      )
      .join('')}
    <h2 class="mt12">${esc(t('ov.sizes'))}</h2>
    <div class="chips">${st.sizes
      .map((s) => chip({ kind: 'size', value: s.size }, String(r2(s.size)), s.layers, st.nearSizes.some(([a, b]) => a === s.size || b === s.size) ? 'near' : ''))
      .join('')}</div>
    ${st.nearSizes.length ? `<p class="muted mt4">${esc(t('ov.near', { pairs: st.nearSizes.slice(0, 8).map(([a, b]) => `${r2(a)}/${r2(b)}`).join(', ') + (st.nearSizes.length > 8 ? ` +${st.nearSizes.length - 8}` : '') }))}</p>` : ''}
    <h2 class="mt12">${esc(t('ov.weights'))}</h2>
    <div class="chips">${st.weights.map((w) => chip({ kind: 'style', value: w.key }, w.key, w.layers)).join('')}</div>
    <h2 class="mt12">${esc(t('ov.lineHeights'))}</h2>
    <div class="chips">${st.lineHeights.map((l) => `<span class="tag">${esc(l.key)} · ${l.layers}</span>`).join('')}</div>
    <p class="muted mt8">${esc(t('ov.clickHint'))}</p>
  </div>
  <div class="sec"><button class="wide" data-act="report" ${S.busy ? 'disabled' : ''}>${esc(t('btn.report'))}</button></div>`
}

// Попередження, якщо в цільовому шрифті немає такого самого накреслення і текст стане легшим, важчим чи втратить курсив.
function noMatch(from: string, to: string) {
  const a = parseStyle(from)
  const b = parseStyle(to)
  if (a.weight === b.weight && a.italic === b.italic) return ''
  return `<div class="warn-text small">${esc(t('fonts.noMatch', { family: S.target, style: from, to }))}</div>`
}

function fontsTab(vm: AnalysisVM) {
  const fams = vm.stats.families
  if (fams.length <= 1) return `<div class="sec"><p>${esc(t('fonts.single', { family: fams[0] ? fams[0].family : '–' }))}</p></div>`
  const sources = sourceFonts()
  const srcFamilies = Array.from(new Set(sources.map((f) => f.family)))
  const localStyles = srcFamilies.reduce((s, f) => s + (vm.localStylesByFamily[f] || 0), 0)
  // лише шари, які плагін справді може змінити: без бібліотечних стилів і без невстановлених шрифтів
  const layers = sources.reduce((s, f) => s + Math.max(0, f.layers - f.remoteLayers - (f.missingLayers || 0)), 0)
  const styles = S.targetStyles

  const options = fams.map((f) => `<option value="${attr(f.family)}" ${!S.other && f.family === S.target ? 'selected' : ''}>${esc(f.family)} – ${esc(t('n.layers', { n: f.layers }))}</option>`).join('')
  let body = ''
  if (!S.target) body = `<p class="muted">${esc(t('fonts.nothing'))}</p>`
  else if (styles == null) body = `<p class="muted">${esc(t('fonts.loading'))}</p>`
  else if (!styles.length) body = `<p class="warn-text">${esc(t('fonts.unavailable', { family: S.target }))}</p>`
  else
    body = `<h2 class="mt12">${esc(t('fonts.mapTitle'))}</h2>
      ${sources
        .map((f) => {
          const k = f.family + '|' + f.style
          const cur = S.mapping[k] || mapStyle(f.style, styles) || styles[0]
          return `<div class="map"><div class="grow"><div class="strong">${esc(f.family)} ${esc(f.style)}</div>
            <div class="muted">${esc(t('n.layers', { n: f.layers }))}${f.remoteLayers ? ', ' + esc(t('fonts.remoteNote', { n: f.remoteLayers })) : ''}</div>
            ${f.missingLayers ? `<div class="warn-text small">${esc(t('fonts.missingNote', { n: f.missingLayers }))}</div>` : ''}
            ${noMatch(f.style, cur)}</div>
            <span class="arrow">→</span>
            <select data-act="map" data-k="${attr(k)}">${styles
              .slice()
              .sort((a, b) => parseStyle(a).weight - parseStyle(b).weight || Number(parseStyle(a).italic) - Number(parseStyle(b).italic))
              .map((s) => `<option ${s === cur ? 'selected' : ''}>${esc(s)}</option>`)
              .join('')}</select></div>`
        })
        .join('')}
      ${localStyles ? `<div class="banner mt8">${esc(t('fonts.localStyles', { n: localStyles, family: S.target }))}</div>` : ''}
      <p class="muted mt8">${esc(t('fonts.widthNote'))}</p>`
  if (S.target && styles && styles.length)
    bar = layers
      ? `${mainCheck()}
      <button class="primary wide mt8" data-act="apply-fonts" ${S.busy || !sources.length ? 'disabled' : ''}>${esc(t('fonts.apply', { n: layers }))}</button>`
      : `<p class="muted mt8">${esc(t('fonts.nothingToChange'))}</p>`

  return `<div class="sec">
    <h2>${esc(t('fonts.keep'))}</h2>
    <select class="wide" data-act="target"><option value="" ${!S.target ? 'selected' : ''}>–</option>${options}<option value="__other" ${S.other ? 'selected' : ''}>${esc(t('fonts.other'))}</option></select>
    ${
      S.other
        ? `<input class="wide mt4" list="fams" data-act="other" placeholder="${attr(t('fonts.otherPlaceholder'))}" value="${attr(S.target)}"/><datalist id="fams">${(S.families || [])
            .map((f) => `<option value="${attr(f)}"></option>`)
            .join('')}</datalist>`
        : ''
    }
    ${body}
  </div>`
}

function stylesTab(vm: AnalysisVM) {
  const all = rows()
  const fresh = all.filter((r) => !r.existing)
  const linked = all.filter((r) => r.existing)
  const on = fresh.filter((r) => !S.off.has(r.key))
  const head = `
    ${new Set(vm.combos.map((c) => c.spec.family)).size > 1 ? `<div class="banner warn">${esc(t('styles.manyFonts'))}</div>` : ''}
    ${vm.existing.length ? `<p class="muted mt8">${esc(t('styles.existing', { n: vm.existing.length }))}</p>` : ''}`
  if (!all.length) return `<div class="sec">${head}<p class="mt8">${esc(t('styles.allLinked'))}</p></div>`

  const sample = (r: Row) => {
    const w = parseStyle(r.spec.style)
    const px = Math.max(11, Math.min(26, r.spec.size))
    return `<span class="sample" style="font-family:'${attr(r.spec.family)}',system-ui;font-weight:${w.weight};font-style:${w.italic ? 'italic' : 'normal'};font-size:${px}px">${esc(t('styles.sample'))}</span>`
  }
  const meta = (r: Row) =>
    `${esc(formatSpec(r.spec))} · ${esc(t('n.layers', { n: r.layers }))}${r.fromSizes.length > 1 ? ' · ' + esc(t('styles.fromSizes', { sizes: r.fromSizes.map(r2).join(', ') })) : ''}`

  bar = `${check('link', S.link, t('styles.link'))}
    ${mainCheck()}
    ${S.error ? `<p class="warn-text">${esc(S.error)}</p>` : ''}
    <button class="primary wide mt8" data-act="apply-styles" ${S.busy || (!on.length && !(S.link && linked.length)) ? 'disabled' : ''}>${esc(
      on.length ? t('styles.apply', { n: on.length }) : t('styles.applyLinkOnly')
    )}</button>`

  return `<div class="sec">
    ${head}
    <div class="row-h mt8"><span>${esc(t('styles.naming'))}</span>${seg('conv', [['role', t('styles.naming.role')], ['code', t('styles.naming.code')]], S.conv)}</div>
    ${check('merge', S.merge, t('styles.merge'), t('styles.merge.hint'))}
  </div>
  ${
    fresh.length
      ? `<div class="sec"><h2>${esc(t('styles.newTitle', { n: fresh.length }))}</h2>
    ${fresh
      .map(
        (r) => `<div class="prop ${S.off.has(r.key) ? 'off' : ''}">
        <input type="checkbox" data-act="toggle-p" data-k="${attr(r.key)}" ${S.off.has(r.key) ? '' : 'checked'}/>
        ${sample(r)}
        <div class="grow"><input class="name" data-act="name" data-k="${attr(r.key)}" value="${attr(r.name)}"/>
        <div class="muted">${meta(r)}</div></div></div>`
      )
      .join('')}</div>`
      : ''
  }
  ${
    linked.length
      ? `<div class="sec"><h2>${esc(t('styles.existingTitle'))}</h2>${linked
          .map((r) => `<div class="prop">${sample(r)}<div class="grow"><div class="strong">${esc(r.name)}</div><div class="muted">${meta(r)}</div></div></div>`)
          .join('')}</div>`
      : ''
  }`
}

function footer() {
  const p = S.progress
  const pct = p && p.total ? Math.round((p.done / p.total) * 100) : 0
  return `<div id="footer">
    ${S.busy ? `<div class="progress"><div style="width:${pct}%"></div></div><div class="row-h"><span>${esc(t(S.busyCode))}${p && p.total ? ` ${p.done}/${p.total}` : ''}</span><button class="small" data-act="cancel">${esc(t('btn.cancel'))}</button></div>` : ''}
    ${S.notices
      .map(
        (n, i) => `<div class="note"><i class="dot ${n.level === 'ok' ? 'd-ok' : n.level === 'warn' ? 'd-warn' : 'd-bad'}"></i><span class="grow">${esc(t(n.code, n.params))}</span>${
          n.nodes && n.nodes.length ? `<button class="link" data-act="sel-note" data-i="${i}">${esc(t('btn.select'))}</button>` : ''
        }</div>`
      )
      .join('')}
  </div>`
}

// ---------- рендер ----------

// Дії вкладки (галочки + головна кнопка) живуть у панелі над футером, щоб їх не треба було шукати внизу довгого списку.
let bar = ''

const app = document.getElementById('app')!

function render() {
  const scrollEl = document.getElementById('main')
  const scroll = scrollEl ? scrollEl.scrollTop : 0
  const vm = S.vm
  let content = ''
  bar = ''
  if (!vm) content = empty()
  else if (S.tab === 'overview') content = overview(vm)
  else if (S.tab === 'fonts') content = fontsTab(vm)
  else content = stylesTab(vm)
  app.innerHTML = `${header()}${tabs()}<div id="main">${content}</div>${bar ? `<div id="bar">${bar}</div>` : ''}${footer()}`
  document.documentElement.lang = S.lang
  document.getElementById('main')!.scrollTop = scroll
}

// ---------- дії ----------

function applyFonts() {
  const vm = S.vm
  if (!vm || !S.targetStyles) return
  const mapping: Record<string, string> = {}
  for (const f of sourceFonts()) {
    const k = f.family + '|' + f.style
    mapping[k] = S.mapping[k] || mapStyle(f.style, S.targetStyles) || S.targetStyles[0]
  }
  S.notices = []
  send({ type: 'apply-fonts', target: S.target, mapping, includeMain: S.includeMain })
}

function applyStyles() {
  const all = rows()
  const chosen = all.filter((r) => (r.existing ? S.link : !S.off.has(r.key)))
  if (chosen.some((r) => !r.existing && !r.name.trim())) {
    S.error = t('styles.nameEmpty')
    render()
    return
  }
  S.error = ''
  const proposals: ProposalIn[] = chosen.map((r) => ({ name: r.name.trim(), spec: r.spec, members: r.members, existingId: r.existing ? r.existing.id : undefined }))
  S.notices = []
  send({ type: 'apply-styles', proposals, link: S.link, includeMain: S.includeMain })
}

function report() {
  const proposals: ReportProposal[] = rows()
    .filter((r) => r.existing || !S.off.has(r.key))
    .map((r) => ({ name: r.name, spec: r.spec, layers: r.layers, existing: !!r.existing }))
  S.notices = []
  send({ type: 'report', proposals })
}

app.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null
  if (!el || (el as HTMLButtonElement).disabled) return
  const act = el.dataset.act
  const v = el.dataset.v || ''
  switch (act) {
    case 'lang':
      S.lang = v as Lang
      send({ type: 'set-lang', lang: S.lang })
      render()
      break
    case 'scope':
      S.scope = v as Scope
      S.scopeTouched = true
      render()
      break
    case 'analyze':
      S.notices = []
      send({ type: 'analyze', scope: S.scope })
      break
    case 'tab':
      S.tab = v as Tab
      render()
      break
    case 'sel':
      send({ type: 'select', filter: JSON.parse(el.dataset.f || '{}') })
      break
    case 'sel-note': {
      const n = S.notices[Number(el.dataset.i)]
      if (n && n.nodes) send({ type: 'select', filter: { kind: 'nodes', value: n.nodes } })
      break
    }
    case 'cancel':
      send({ type: 'cancel' })
      break
    case 'reset':
      S.notices = []
      send({ type: 'reset-overrides', includeMain: S.includeMain })
      break
    case 'report':
      report()
      break
    case 'conv':
      S.conv = v as Convention
      S.names.clear()
      render()
      break
    case 'apply-fonts':
      applyFonts()
      break
    case 'apply-styles':
      applyStyles()
      break
  }
})

app.addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement | HTMLSelectElement
  const act = el.dataset.act
  const k = el.dataset.k || ''
  switch (act) {
    case 'main':
      S.includeMain = (el as HTMLInputElement).checked
      render()
      break
    case 'merge':
      S.merge = (el as HTMLInputElement).checked
      render()
      break
    case 'link':
      S.link = (el as HTMLInputElement).checked
      render()
      break
    case 'toggle-p':
      if ((el as HTMLInputElement).checked) S.off.delete(k)
      else S.off.add(k)
      render()
      break
    case 'map':
      S.mapping[k] = el.value
      break
    case 'target':
      if (el.value === '__other') {
        S.other = true
        S.target = ''
        S.targetStyles = null
        if (!S.families) send({ type: 'list-families' })
      } else {
        S.other = false
        setTarget(el.value)
      }
      render()
      break
    case 'other':
      setTarget(el.value.trim())
      render()
      break
  }
})

app.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement
  if (el.dataset.act === 'name') S.names.set(el.dataset.k || '', el.value)
})

window.onmessage = (ev: MessageEvent) => {
  const m = ev.data && (ev.data.pluginMessage as ToUI)
  if (!m) return
  switch (m.type) {
    case 'lang':
      S.lang = m.lang
      break
    case 'selection':
      S.selCount = m.count
      if (!S.scopeTouched && !S.vm) S.scope = m.count ? 'selection' : 'page'
      break
    case 'busy':
      S.busy = m.busy
      S.busyCode = m.code || ''
      if (!m.busy) S.progress = null
      break
    case 'progress':
      S.progress = { done: m.done, total: m.total }
      break
    case 'analysis': {
      S.vm = m.vm
      S.error = ''
      const fams = m.vm ? m.vm.stats.families.map((f: { family: string }) => f.family) : []
      if (m.vm && (!S.target || (!fams.includes(S.target) && !S.other))) setTarget(fams[0] || '')
      break
    }
    case 'notice':
      S.notices.push(m.notice)
      break
    case 'families':
      S.families = m.families
      break
    case 'family-styles':
      if (m.family === S.target) S.targetStyles = m.styles
      break
  }
  render()
}

render()
send({ type: 'init' })
