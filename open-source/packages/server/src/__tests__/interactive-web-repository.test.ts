// @covers open-source/packages/server/src/services/interactive-web/repository.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => {
  const tx = { interactiveWork: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    interactiveJob: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    interactiveAsset: { findMany: vi.fn(), updateMany: vi.fn() }, interactiveVersion: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
    interactiveHeadEvent: { create: vi.fn(), findUnique: vi.fn() }, interactiveActivity: { upsert: vi.fn() } }
  return { tx, prisma: { ...tx, $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx)) } }
})
vi.mock('../lib/prisma.js', () => ({ prisma: mocks.prisma }))
import { activateContentVersion, claimContentJob, commitContentJob, enqueueContent, publishContentWork, readableWork } from '../services/interactive-web/repository.js'
const work = { id: 'w', creatorId: 'owner', status: 'published', currentVersionId: 'v4', newestVersionId: 'v10',
  versionCount: 10, headRevision: 12, writeEpoch: 2, leaseToken: 'lease', leaseExpiresAt: new Date(Date.now() + 100000) }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.prisma.$transaction.mockImplementation(async (fn) => fn(mocks.tx))
  mocks.tx.interactiveWork.updateMany.mockResolvedValue({ count: 1 })
  mocks.tx.interactiveWork.findUniqueOrThrow.mockResolvedValue({ ...work })
  mocks.tx.interactiveWork.findUnique.mockResolvedValue({ ...work })
  mocks.tx.interactiveJob.findUnique.mockResolvedValue(null)
  mocks.tx.interactiveJob.updateMany.mockResolvedValue({ count: 1 })
  mocks.tx.interactiveAsset.findMany.mockResolvedValue([])
})
describe('durable work transaction boundaries', () => {
  it('private works are unavailable to other actors and anonymous public readers', async () => {
    mocks.tx.interactiveWork.findUnique.mockResolvedValue({ ...work, status: 'unpublished' })
    await expect(readableWork('other', 'w')).rejects.toThrow('work_unavailable')
    await expect(readableWork(null, 'w')).rejects.toThrow('work_unavailable')
    expect((await readableWork('owner', 'w')).id).toBe('w')
  })
  it('binds idempotency to the complete body, not just the request key', async () => {
    mocks.tx.interactiveJob.findUnique.mockResolvedValue({ id: 'prior', inputDigest: 'different', status: 'queued' })
    await expect(enqueueContent({ actorId: 'owner', kind: 'create', instruction: 'new', resourceIds: [], requestKey: 'r' })).rejects.toThrow('idempotency_conflict')
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })
  it('does not enqueue an uploaded asset owned by another user', async () => {
    await expect(enqueueContent({ actorId: 'owner', kind: 'create', instruction: 'new', resourceIds: ['not-mine'], requestKey: 'r' })).rejects.toThrow('asset_unavailable')
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })
  it('claims a queued requirement against the current head, never an old request snapshot', async () => {
    mocks.tx.interactiveJob.findFirst.mockResolvedValue({ id: 'j', workId: 'w', writeEpoch: 2, instruction: 'change' })
    const result = await claimContentJob('w')
    expect(result?.job.baseVersionId).toBe('v4')
    expect(mocks.tx.interactiveJob.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: 'j', status: 'queued', writeEpoch: 2 }, data: expect.objectContaining({ baseVersionId: 'v4', baseRevision: 12 }),
    }))
  })
  it('immediate saves cannot jump an older queued requirement or take an active lease', async () => {
    mocks.tx.interactiveJob.findFirst.mockResolvedValue({ id: 'older-ai-job', workId: 'w', writeEpoch: 2 })
    expect(await claimContentJob('w', 'new-save')).toBeNull()
    expect(mocks.tx.interactiveJob.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'older-ai-job' }) }))
    expect(mocks.tx.interactiveWork.update).toHaveBeenCalledWith({ where: { id: 'w' }, data: { leaseToken: null, leaseExpiresAt: null } })
    mocks.tx.interactiveWork.updateMany.mockResolvedValue({ count: 0 })
    expect(await claimContentJob('w', 'new-save')).toBeNull()
    expect(mocks.tx.interactiveJob.findFirst).toHaveBeenCalledOnce()
  })
  it('cannot resurrect a queued request cancelled during claiming', async () => {
    mocks.tx.interactiveJob.findFirst.mockResolvedValue({ id: 'j', workId: 'w', writeEpoch: 2 })
    mocks.tx.interactiveJob.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 0 })
    expect(await claimContentJob('w')).toBeNull()
    expect(mocks.tx.interactiveWork.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: { leaseToken: null, leaseExpiresAt: null } }))
  })
  it('commit uses head, epoch, lease and expiry CAS before inserting an immutable version', async () => {
    const job = { id: 'j', actorId: 'alice', workId: 'w', status: 'running', writeEpoch: 2, leaseToken: 'lease' }
    mocks.tx.interactiveJob.findUniqueOrThrow.mockResolvedValue(job)
    mocks.tx.interactiveWork.updateMany.mockResolvedValue({ count: 0 })
    await expect(commitContentJob({ work, job } as never, { title: 'x', summary: 's', changeSummary: 'c', objectKey: 'immutable', digest: 'sha', resourceIds: [] })).rejects.toThrow('commit_fence_changed')
    expect(mocks.tx.interactiveWork.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ headRevision: 12, writeEpoch: 2, leaseToken: 'lease', leaseExpiresAt: { gt: expect.any(Date) } }) }))
    expect(mocks.tx.interactiveVersion.create).not.toHaveBeenCalled()
  })
  it('marks all historical resources public, including assets inherited from another work', async () => {
    mocks.tx.interactiveVersion.findMany.mockResolvedValue([{ id: 'v1', resourceIds: ['foreign-image', 'own-image'] }, { id: 'v2', resourceIds: ['foreign-image'] }])
    await publishContentWork('owner', 'w', 12)
    expect(mocks.tx.interactiveAsset.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['foreign-image', 'own-image'] }, publishedAt: null }, data: { publishedAt: expect.any(Date) } })
  })
  it('only the creator activates history and invalidates old epochs in the same transaction', async () => {
    mocks.tx.interactiveHeadEvent.findUnique.mockResolvedValue(null)
    mocks.tx.interactiveVersion.findFirst.mockResolvedValue({ id: 'v3', seq: 3, actorId: 'alice', title: 'old', summary: 'old summary' })
    await expect(activateContentVersion('alice', 'w', 'v3', 12, 'r')).rejects.toThrow('creator_required')
    await activateContentVersion('owner', 'w', 'v3', 12, 'r')
    expect(mocks.tx.interactiveWork.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ currentVersionId: 'v3', writeEpoch: 3, headRevision: 13 }) }))
    expect(mocks.tx.interactiveJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workId: 'w', status: { in: ['queued', 'running'] }, writeEpoch: { lt: 3 } } }))
    expect(mocks.tx.interactiveVersion.create).not.toHaveBeenCalled()
  })
})
