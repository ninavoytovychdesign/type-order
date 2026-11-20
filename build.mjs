// Збирає код плагіна і вбудовує скрипт панелі в один dist/ui.html.
import { build } from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

mkdirSync('dist', { recursive: true })

await build({ entryPoints: ['src/main.ts'], bundle: true, format: 'iife', target: 'es2017', outfile: 'dist/code.js' })

const ui = await build({ entryPoints: ['src/ui/ui.ts'], bundle: true, format: 'iife', target: 'es2019', write: false, minify: true })
const js = ui.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
const html = readFileSync('src/ui/template.html', 'utf8').replace('/*UI_SCRIPT*/', () => js)
writeFileSync('dist/ui.html', html)
console.log('built dist/code.js, dist/ui.html')
