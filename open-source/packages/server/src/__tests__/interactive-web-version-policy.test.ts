// @covers open-source/packages/server/src/services/interactive-web/version-policy.ts
import { describe, expect, it } from 'vitest'
import { decideSharedSave, decideVersionActivation, followSharedCurrent, receiveSharedHead,
  startSharedWrite, viewHistoricalVersion, type WorkHead } from '../services/interactive-web/version-policy.js'

const head: WorkHead = { workId: 'w', creatorId: 'owner', currentVersionId: 'v10', newestVersionId: 'v10',
  versionCount: 10, headRevision: 10, writeEpoch: 0, deleted: false }
const target = { workId: 'w', versionId: 'v4', seq: 4, actorId: 'alice', readable: true, safe: true }
const viewer = { workId: 'w', viewedVersionId: 'v10', followCurrent: true, viewEpoch: 0 }
const start = (h = head, queuedWriteEpoch = 0) => startSharedWrite({ head: h, actorId: 'alice',
  leaseToken: 'lease1', queuedWriteEpoch, viewedVersionId: h.currentVersionId, followCurrent: true })
const save = (h = head, fence = start()) => decideSharedSave({ head: h, fence,
  activeLeaseToken: 'lease1', leaseExpiresAt: 200, now: 100, newVersionId: 'v11', nextSeq: 11, requestKey: 'save1' })
const restore = (h = head) => decideVersionActivation({ head: h, target, actorId: 'owner',
  expectedHeadRevision: h.headRevision, requestKey: 'restore1' })

describe('linear HTML versions', () => {
  it('personal history never moves the shared head, including creator viewing', () => {
    const personal = viewHistoricalVersion(head, target, viewer)
    expect(personal).toEqual({ ...viewer, viewedVersionId: 'v4', followCurrent: false, viewEpoch: 1 })
    expect(head.currentVersionId).toBe('v10')
    expect(receiveSharedHead(save().next, personal)).toBe(personal)
    expect(followSharedCurrent(head, personal)).toMatchObject({ viewedVersionId: 'v10', followCurrent: true, viewEpoch: 2 })
  })
  it('only the creator activates history and preserves all saved versions', () => {
    expect(() => decideVersionActivation({ head, target, actorId: 'alice', expectedHeadRevision: 10, requestKey: 'r' })).toThrow('creator_required')
    expect(restore().next).toEqual({ ...head, currentVersionId: 'v4', headRevision: 11, writeEpoch: 1 })
  })
  it('appends V11 based on restored V4, not newest saved V10', () => {
    const h = restore().next
    const result = save(h, start(h, 1))
    expect(result.next).toMatchObject({ versionCount: 11, currentVersionId: 'v11', writeEpoch: 1 })
    expect(result.event).toMatchObject({ actorId: 'alice', from: 'v4', to: 'v11' })
  })
  it('save then restore leaves V11 in history and V4 current', () => {
    expect(restore(save().next).next).toMatchObject({ currentVersionId: 'v4', newestVersionId: 'v11', versionCount: 11 })
  })
  it('restore then save rejects both running and queued pre-restore work', () => {
    const restored = restore().next
    expect(() => save(restored)).toThrow('request_invalidated')
    expect(() => start(restored, 0)).toThrow('request_invalidated')
  })
  it('normal saves do not invalidate subsequent queued requests', () => {
    const next = save().next
    expect(start(next, 0)).toMatchObject({ basedOnVersionId: 'v11', headRevision: 11, writeEpoch: 0 })
    expect(() => save(next)).toThrow('head_changed')
  })
  it('detects ABA even if the version ID returns to the same value', () => {
    expect(() => save({ ...head, headRevision: 12 })).toThrow('head_changed')
  })
  it('rejects stale leases and history writes', () => {
    expect(() => decideSharedSave({ head, fence: start(), activeLeaseToken: 'lease2', leaseExpiresAt: 200,
      now: 100, newVersionId: 'v11', nextSeq: 11, requestKey: 's' })).toThrow('lease_lost')
    expect(() => decideSharedSave({ head, fence: start(), activeLeaseToken: 'lease1', leaseExpiresAt: 100,
      now: 100, newVersionId: 'v11', nextSeq: 11, requestKey: 's' })).toThrow('lease_lost')
    expect(() => startSharedWrite({ head, actorId: 'alice', queuedWriteEpoch: 0,
      leaseToken: 'l', viewedVersionId: 'v4', followCurrent: false })).toThrow('history_is_read_only')
  })
  it('rejects deleted works, cross-work and unsafe history targets', () => {
    expect(() => restore({ ...head, deleted: true })).toThrow('work_deleted')
    for (const bad of [{ ...target, workId: 'other' }, { ...target, safe: false }, { ...target, readable: false }]) {
      expect(() => viewHistoricalVersion(head, bad, viewer)).toThrow('version_unavailable')
    }
  })
})
