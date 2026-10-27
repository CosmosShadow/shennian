// @covers packages/app/src/features/personal-workspace/diaryLink.ts
import { describe, expect, it, vi } from 'vitest'
import { diaryLinkDate } from '../features/personal-workspace/diaryLink'
import { openMessageLink } from '../components/chat/simpleMessageLinks'
describe('dated diary links', () => {
  it('opens only an exact valid diary date through the authenticated conversation handler', () => {
    const open = vi.fn()
    expect(diaryLinkDate('shennian://diary/2026-10-23')).toBe('2026-10-23')
    expect(openMessageLink('shennian://diary/2026-10-23', open)).toBe(false)
    expect(open).toHaveBeenCalledExactlyOnceWith('shennian://diary/2026-10-23')
  })
  it.each(['2026-02-30', '../../.env', '2026-10-23?path=secret', '2026-10-23/other', '2026-13-01'])('rejects %s', value => {
    const open = vi.fn(), href = `shennian://diary/${value}`
    expect(diaryLinkDate(href)).toBeNull()
    expect(openMessageLink(href, open)).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })
})
