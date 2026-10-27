// @covers ../components/headEllipsis.ts
// @covers ../components/HeadEllipsisText.tsx

import { describe, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { HeadEllipsisText } from '../components/HeadEllipsisText'
import { normalizeDisplayText, resolveHeadEllipsisText } from '../components/headEllipsis'

describe('head-ellipsis text', () => {
  const label = '[ModelStudio Standard] qwen3.7-max'

  it.each(['ios', 'android'])('uses the native head ellipsis on %s without touching the text', (platform) => {
    expect(resolveHeadEllipsisText(label, platform)).toEqual({ text: label, ellipsizeMode: 'head' })
  })

  it('flips direction on web and pins both ends to LTR so the visible tail reads unchanged', () => {
    const spec = resolveHeadEllipsisText(label, 'web')

    expect(spec.ellipsizeMode).toBeUndefined()
    expect(spec.style).toEqual({ direction: 'rtl', textAlign: 'left' })
    expect(spec.text.startsWith('‎')).toBe(true)
    expect(spec.text.endsWith('‎')).toBe(true)
    expect(spec.text.replaceAll('‎', '')).toBe(label)
  })
})

// Exercise the actual component with a host Text stand-in, not an iOS device smoke.
vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  Text: ({ children }: { children: ReactNode }) => createElement('span', null, children),
}))

describe('composer labels from runtime data', () => {
  it.each([
    [{ id: 'model-1', name: 'Model One' }, 'Model One'],
    [{ id: 'model-1' }, 'model-1'],
    [{ id: 'model-1', name: '' }, 'model-1'],
    [{ id: 'model-1', name: { bad: true } }, 'model-1'],
    [{ id: {}, name: {} }, ''],
    [null, ''],
    [undefined, ''],
    [[], ''],
    [42, '42'],
    [false, 'false'],
  ])('normalizes %j without rendering an object', (value, expected) => {
    expect(normalizeDisplayText(value)).toBe(expected)
    for (const platform of ['ios', 'android', 'web']) {
      expect(resolveHeadEllipsisText(value, platform).text.replaceAll('‎', '')).toBe(expected)
    }
    expect(renderToStaticMarkup(createElement(HeadEllipsisText, { children: value })))
      .toBe(`<span>${expected}</span>`)
  })

  it('reproduces the reported React error without normalization', () => {
    const savedSelection = { id: 'model-1', name: 'Model One' }
    expect(() => renderToStaticMarkup(createElement('span', null, savedSelection as unknown as ReactNode)))
      .toThrow('Objects are not valid as a React child')
    expect(renderToStaticMarkup(createElement(HeadEllipsisText, { children: savedSelection })))
      .toBe('<span>Model One</span>')
  })
})
