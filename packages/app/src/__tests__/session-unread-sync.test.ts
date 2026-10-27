// @covers src/lib/session-unread-sync.ts

import { describe, expect, it, vi } from 'vitest'
import type { NianSession } from '@shennian/wire'

vi.mock('../lib/push-badge', () => ({ scheduleNativeBadgeSync: vi.fn() }))
vi.mock('../lib/session-unread-count-cache', () => ({ refreshSessionUnreadCounts: vi.fn() }))

import { syncSessionUnreadProjection } from '../lib/session-unread-sync'

describe('session unread native badge reconciliation', () => {
  it('updates the native badge only after the in-app unread projection is ready', async () => {
    const order: string[] = []
    const refresh = vi.fn(async () => {
      order.push('projection')
    })
    const scheduleBadge = vi.fn(() => {
      order.push('native-badge')
    })

    await syncSessionUnreadProjection([] as NianSession[], { refresh, scheduleBadge })

    expect(order).toEqual(['projection', 'native-badge'])
    expect(scheduleBadge).toHaveBeenCalledOnce()
  })

  it('does not overwrite the native badge when projection refresh fails', async () => {
    const scheduleBadge = vi.fn()

    await expect(
      syncSessionUnreadProjection([] as NianSession[], {
        refresh: vi.fn().mockRejectedValue(new Error('database unavailable')),
        scheduleBadge,
      }),
    ).rejects.toThrow('database unavailable')
    expect(scheduleBadge).not.toHaveBeenCalled()
  })
})
