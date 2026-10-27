// @covers packages/app/src/components/chat/FileDrawerRow.tsx

import { describe, expect, it } from 'vitest'
import { shouldShowFileRowActions } from '../components/chat/fileRowActionVisibility'

describe('desktop file-row action discoverability', () => {
  it('reveals the same action group for keyboard focus as pointer hover', () => {
    expect(shouldShowFileRowActions({ hovered: true, focusWithin: false, web: true })).toBe(true)
    expect(shouldShowFileRowActions({ hovered: false, focusWithin: true, web: true })).toBe(true)
    expect(shouldShowFileRowActions({ hovered: false, focusWithin: false, web: true })).toBe(false)
  })

  it('keeps actions visible on native touch surfaces', () => {
    expect(shouldShowFileRowActions({ hovered: false, focusWithin: false, web: false })).toBe(true)
  })
})
