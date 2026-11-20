# Type Order

A Figma plugin that audits the typography in a file and helps you put it in order: one report of every font, size, weight and line height, a way to merge several fonts into one, and text styles generated from the text that is already there.

Written for the moment when you copy two or three flows into a clean file, or inherit a messy one, and need to know what the typography actually is before you can fix it.

Interface in English and Ukrainian. Works offline – `networkAccess` is `none`.

[Документація українською](README.uk.md)

## Overview

- Counts: text layers, fonts, sizes, unique typography combinations, and the share of text that is linked to a style.
- Fonts with their weights, plus sizes, weights and line heights. Clicking a font or a chip selects those layers on the canvas.
- Near-identical sizes (15 and 16, say) are highlighted as candidates for merging.
- Problems, each explained and selectable: text with no style, a style overridden by hand (with a *Reset to style* button), several styles inside one layer, a font not installed on this machine, library styles.
- **Report on canvas** – an auto-layout frame placed to the right of the designs, with the summary, fonts, sizes, problems and the proposed styles with text samples.

## Fonts

Pick the font to keep – one already in the file, or any installed font. For every weight of the other fonts the plugin proposes the closest match by weight, keeping the slant (Manrope SemiBold → Inter Semi Bold); every pair can be changed by hand.

Local text styles using that font are updated along with it, so text following a style changes without the style being overridden. After the swap the plugin lists the layers whose line breaks changed, and the fixed-size layers where the text may no longer fit.

## Styles

Text with no style is grouped by font, weight and size. Near-identical sizes are merged – the most used size becomes the centre, the line height comes from the most used variant – and merging can be turned off.

Names are proposed either by role (`Heading/H1`, `Body/M`, `Caption/S`) or in code style (`text-body-m`). Every name is editable and any style can be unchecked. If the file already has styles, text that matches one, exactly or closely, is linked to the existing style instead of a new one.

The plugin creates the styles and, optionally, links the text to them in the same step. A bold word inside a sentence is left alone when its combination didn't make it into a style.

## What it will not touch

- Text inside main components, unless you tick the box – those changes reach every instance.
- Library styles: shown, never edited.
- Layers with a missing font: Figma doesn't allow changing them.
- Hidden layers are not analysed.

Nothing changes until you press an action button, and every action is one undo step (Cmd/Ctrl+Z).

## Limits

- Merging sizes can make some text smaller, 14 → 13 for example. The panel says *from sizes 13, 14*, so it's visible before you apply it.
- Style names are a heuristic based on size and weight. Worth reviewing before creating them.
- After a font swap the plugin detects changed line breaks only in text with auto height or auto width. In fixed text blocks it warns instead.
- Size variables and accessibility checks (contrast, minimum size) are not in this version.

## Running it locally

```bash
npm install
npm run build     # dist/code.js and dist/ui.html
npm run check     # types + tests + build
```

Then in Figma: **Plugins → Development → Import plugin from manifest…** and pick `manifest.json`.

## Tests

32 tests with Vitest, covering the core (weights, grouping, naming, report), the completeness and plural forms of the EN/UA dictionary, and the file operations against a mock of the Figma API – analysis, font replacement, creating and linking styles, resetting overrides.

```bash
npm test
```

## Code layout

```
src/
  core/          logic with no Figma dependency, covered by tests
    spec.ts      typography description, comparison, formatting
    fonts.ts     weight of a style, matching across families
    stats.ts     report, problems, layer selections
    scale.ts     grouping into style proposals, matching existing styles
    naming.ts    style names
    i18n.ts      EN/UA dictionary, plural forms
    protocol.ts  messages between the panel and the plugin
  figma/
    scan.ts      walking text layers, visibility, instances and components
    apply.ts     font replacement, styles, resetting overrides
    report.ts    the report frame on canvas
  ui/            the panel: template.html + ui.ts, built into dist/ui.html
  main.ts
tests/
assets/          Community icon and cover
```
