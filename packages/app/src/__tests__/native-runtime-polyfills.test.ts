// @covers packages/app/src/polyfills/nativeRuntime.ts

import { describe, expect, it } from 'vitest'
import '../polyfills/nativeRuntime'

describe('native runtime polyfills', () => {
  it('provides array helpers used by OTA bundles on older iOS Hermes shells', () => {
    expect([1, [2, [3]]].flat(2)).toEqual([1, 2, 3])
    expect([1, 2].flatMap((value) => [value, value * 10])).toEqual([1, 10, 2, 20])
    expect(['a', 'b'].at(-1)).toBe('b')
  })

  it('provides string and object helpers without changing modern behavior', () => {
    expect('a.b.a'.replaceAll('a', 'x')).toBe('x.b.x')
    expect(Object.hasOwn({ ok: true }, 'ok')).toBe(true)
    expect(Object.hasOwn({}, 'missing')).toBe(false)
  })
})
