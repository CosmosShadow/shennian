// @covers src/features/rooms/roomApprovalCounts.ts
// @arch docs/features/network-rooms/ui.md#入群审批提醒
import { describe, expect, it } from 'vitest'
import { createRoomApprovalCounts } from '../features/rooms/roomApprovalCounts'

describe('pending room approval notifications', () => {
  it('keeps reminders until all requests are handled, independently per account and room', async () => {
    const store = createRoomApprovalCounts()
    await store.refresh('owner', 'room', async () => [{}, {}])
    expect(store.get('owner', 'room')).toBe(2)
    expect(store.get('member', 'room')).toBe(0)
    expect(store.get('owner', 'other')).toBe(0)
    store.set('owner', 'room', 1)
    expect(store.get('owner', 'room')).toBe(1)
    store.set('owner', 'room', 0)
    expect(store.get('owner', 'room')).toBe(0)
  })
  it('does not clear reminders on a temporary request failure', async () => {
    const store = createRoomApprovalCounts()
    store.set('a', 'r', 2)
    await store.refresh('a', 'r', async () => {
      throw new Error('offline')
    })
    expect(store.get('a', 'r')).toBe(2)
  })
  it('ignores an old fetch that finishes after a successful approval', async () => {
    const store = createRoomApprovalCounts()
    let resolve!: (items: unknown[]) => void
    const pending = store.refresh(
      'a',
      'r',
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    store.set('a', 'r', 0)
    resolve([{}])
    await pending
    expect(store.get('a', 'r')).toBe(0)
  })
  it('keeps the most recent refresh when realtime requests overlap', async () => {
    const store = createRoomApprovalCounts()
    let resolve!: (items: unknown[]) => void
    const pending = store.refresh(
      'a',
      'r',
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    await store.refresh('a', 'r', async () => [{}, {}])
    resolve([])
    await pending
    expect(store.get('a', 'r')).toBe(2)
  })
})
