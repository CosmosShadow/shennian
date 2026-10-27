// @covers packages/app/src/features/steward/inspirationSections.ts
// @covers packages/app/src/features/steward/useInspirationSectionNavigation.ts
// @covers packages/app/src/features/steward/components/StewardInspirationSheet.tsx
// @covers packages/app/src/components/BottomSheet.tsx
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  inspirationSectionCards,
  inspirationSectionAtScroll,
  inspirationSectionTarget,
  inspirationSections,
} from '../features/steward/inspirationSections'
import {
  stewardInspirationIds,
  stewardInspirationCards,
} from '../features/steward/stewardInspiration'
import { zhInspiration } from '../../../../open-source/packages/shared/src/i18n/zh-inspiration'
import { enInspiration } from '../../../../open-source/packages/shared/src/i18n/en-inspiration'

const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf8')
describe('continuous inspiration document with anchor tags', () => {
  it('groups all forty cards exactly once, without a filtered view or duplicate all section', () => {
    const ids = inspirationSections.flatMap((section) => [...section.cards])
    expect(inspirationSections.map((section) => section.id)).toEqual([
      'getting_started',
      'work',
      'apps',
      'learning',
    ])
    expect(ids).toHaveLength(40)
    expect(new Set(ids).size).toBe(40)
    expect([...ids].sort()).toEqual([...stewardInspirationIds].sort())
  })
  for (const [language, messages] of [
    ['zh', zhInspiration],
    ['en', enInspiration],
  ] as const) {
    it(`has ${language} section labels and preserves every existing send prompt`, () => {
      const t = (key: string) => messages[key as keyof typeof messages]
      const sections = inspirationSectionCards(t)
      const flat = stewardInspirationCards(t)
      for (const section of sections) {
        expect(section.title.length).toBeGreaterThan(0)
        expect(section.cards.length).toBeGreaterThan(0)
        for (const card of section.cards)
          expect(card).toEqual(flat.find((item) => item.id === card.id))
      }
    })
  }
  it('positions the heading below the measured sticky tags instead of a fixed row-height guess', () => {
    expect(inspirationSectionTarget(300, 60)).toBe(240)
    expect(inspirationSectionTarget(70, 90)).toBe(0)
    expect(inspirationSectionTarget(900, 110)).toBe(790)
  })
  it('updates the active tag on natural vertical scrolling and scrolling back up', () => {
    const anchors = [60, 700, 1600, 2400]
    expect(inspirationSectionAtScroll(anchors, 0, 60, 3300, 700)).toBe(0)
    expect(inspirationSectionAtScroll(anchors, 640, 60, 3300, 700)).toBe(1)
    expect(inspirationSectionAtScroll(anchors, 1540, 60, 3300, 700)).toBe(2)
    expect(inspirationSectionAtScroll(anchors, 2340, 60, 3300, 700)).toBe(3)
    expect(inspirationSectionAtScroll(anchors, 700, 60, 3300, 700)).toBe(1)
    expect(inspirationSectionAtScroll(anchors, -15, 60, 3300, 700)).toBe(0)
  })
  it('selects the final group at the bottom even when its heading cannot reach the top', () => {
    expect(inspirationSectionAtScroll([60, 800, 1500, 2100], 1600, 60, 2300, 700)).toBe(3)
    expect(inspirationSectionAtScroll([], 0, 60, 0, 0)).toBe(0)
    expect(inspirationSectionAtScroll([Infinity, Infinity], 0, 60, 0, 0)).toBe(0)
  })
  it('keeps one vertical document, sticky horizontal tags and an accessible selection', () => {
    const sheet = read('../features/steward/components/StewardInspirationSheet.tsx')
    const navigation = read('../features/steward/useInspirationSectionNavigation.ts')
    const bottomSheet = read('../components/BottomSheet.tsx')
    expect(sheet).toContain('sections.map((section, index)')
    expect(sheet).toContain('section.cards.map')
    expect(sheet).not.toContain('.filter(')
    expect(sheet).toMatch(/horizontal\s+showsHorizontalScrollIndicator=\{false\}/)
    expect(sheet).toContain('accessibilityRole="tab"')
    expect(sheet).toContain('selected: navigation.active === index')
    expect(navigation).toContain('stickyHeaderIndices: [0]')
    expect(navigation).toContain('scrollTo({ y: target, animated: true })')
    expect(navigation).toMatch(/onScrollBeginDrag:[\s\S]*?pendingTarget.current = null/)
    expect(bottomSheet.match(/ref=\{bodyScrollRef\}/g)).toHaveLength(2)
    expect(bottomSheet.match(/\.\.\.bodyScrollProps/g)).toHaveLength(2)
  })
})
