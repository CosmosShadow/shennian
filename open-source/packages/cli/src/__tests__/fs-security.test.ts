// @covers src/fs/security.ts

import { describe, expect, it } from 'vitest'

import { isPathSafe, normalizePath } from '../fs/security.js'

describe('fs security roots navigation', () => {
  it('keeps virtual roots path opaque during normalization', () => {
    expect(normalizePath('__roots__')).toBe('__roots__')
    expect(isPathSafe('__roots__')).toBe(true)
  })
})
