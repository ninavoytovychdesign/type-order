import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DICTS, translate, pluralIndex } from '../src/core/i18n'

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : []
  })
}

describe('двомовність', () => {
  it('в обох мовах однаковий набір ключів', () => {
    expect(Object.keys(DICTS.uk).sort()).toEqual(Object.keys(DICTS.en).sort())
  })

  it('форми множини мають правильну кількість варіантів і однакові параметри', () => {
    for (const k of Object.keys(DICTS.en)) {
      const en = DICTS.en[k]
      const uk = DICTS.uk[k]
      expect(Array.isArray(en), k).toBe(Array.isArray(uk))
      if (Array.isArray(en)) {
        expect(en.length, k).toBe(2)
        expect((uk as string[]).length, k).toBe(3)
      }
      const params = (e: string | string[]) => new Set([...[e].flat().join(' ').matchAll(/\{(\w+)\}/g)].map((m) => m[1]))
      expect([...params(uk)].sort(), k).toEqual([...params(en)].sort())
    }
  })

  it('усі ключі, що використовує код, є у словнику', () => {
    const src = files('src')
      .filter((f) => !f.endsWith('i18n.ts'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n')
    const keys = new Set<string>()
    for (const m of src.matchAll(/\bt\('([\w.]+)'/g)) keys.add(m[1])
    for (const m of src.matchAll(/code: '([\w.]+)'/g)) keys.add(m[1])
    for (const m of src.matchAll(/warnCount\('([\w.]+)'/g)) keys.add(m[1])
    for (const m of src.matchAll(/run\('([\w.]+)'/g)) keys.add(m[1])
    // ключі, що складаються динамічно
    for (const p of ['scope.selection', 'scope.page', 'scope.all', 'tab.overview', 'tab.fonts', 'tab.styles'])
      keys.add(p)
    for (const k of ['raw', 'overridden', 'mixed', 'missing', 'remote']) {
      keys.add('issue.' + k)
      keys.add('issue.' + k + '.hint')
    }
    const missing = [...keys].filter((k) => !k.endsWith('.') && !(k in DICTS.en))
    expect(missing).toEqual([])
  })

  it('українська множина', () => {
    expect([1, 2, 5, 11, 21, 22, 25, 112].map((n) => pluralIndex('uk', n))).toEqual([0, 1, 2, 2, 0, 1, 2, 2])
    expect(translate('uk', 'n.layers', { n: 1 })).toBe('1 шар')
    expect(translate('uk', 'n.layers', { n: 3 })).toBe('3 шари')
    expect(translate('uk', 'n.layers', { n: 12 })).toBe('12 шарів')
    expect(translate('en', 'n.layers', { n: 1 })).toBe('1 layer')
    expect(translate('en', 'n.layers', { n: 4 })).toBe('4 layers')
  })

  it('підстановка параметрів', () => {
    expect(translate('uk', 'fonts.unavailable', { family: 'Manrope' })).toBe('«Manrope» немає на цьому компʼютері.')
  })
})
