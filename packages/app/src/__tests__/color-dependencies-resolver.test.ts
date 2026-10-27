// @covers scripts/color-dependencies-resolver.cjs
// @covers metro.config.js
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { resolveColorDependencies } = require('../../scripts/color-dependencies-resolver.cjs')

describe('Metro color CJS dependency resolution', () => {
  it('resolves the parser from color itself and parses the native card background', () => {
    const originModulePath = require.resolve('color')
    const localRequire = createRequire(originModulePath)
    const result = resolveColorDependencies({ originModulePath }, 'color-string')
    expect(result).toEqual({ type: 'sourceFile', filePath: localRequire.resolve('color-string') })
    const parser = require(result.filePath)
    expect(parser.get('#123456')).toEqual({ model: 'rgb', value: [18, 52, 86, 1] })
    expect(parser.get('transparent')).toEqual({ model: 'rgb', value: [0, 0, 0, 0] })
  })
  it('preserves color conversion dependencies without changing React resolution', () => {
    const originModulePath = require.resolve('color')
    const result = resolveColorDependencies({ originModulePath }, 'color-convert')
    expect(require(result.filePath).rgb.hex([18, 52, 86])).toBe('123456')
    expect(resolveColorDependencies({ originModulePath }, 'react')).toBeNull()
  })
  it('does not intercept imports made by unrelated packages or app code', () => {
    expect(resolveColorDependencies({ originModulePath: '/app/main.tsx' }, 'color-string')).toBeNull()
    expect(resolveColorDependencies({ originModulePath: '/node_modules/colorful/index.js' }, 'color-string')).toBeNull()
  })
})
