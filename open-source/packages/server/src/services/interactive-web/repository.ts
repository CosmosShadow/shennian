// @arch open-source/docs/server-runtime.md
// @test src/__tests__/interactive-web-repository.test.ts
import { createHash, randomUUID } from 'node:crypto'
import { prisma } from '../../lib/prisma.js'
import type { Prisma, InteractiveWork, InteractiveVersion } from '../../generated/prisma/client.js'
import { decideSharedSave, decideVersionActivation, type WorkHead } from './version-policy.js'

export class ContentError extends Error {
  constructor(readonly code: string, readonly statusCode = 400) { super(code); this.name = 'ContentError' }
}
export const id = () => randomUUID()
export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
export function asHead(work: InteractiveWork): WorkHead {
  return { workId: work.id, creatorId: work.creatorId, currentVersionId: work.currentVersionId ?? '',
    newestVersionId: work.newestVersionId ?? '', versionCount: work.versionCount,
    headRevision: work.headRevision, writeEpoch: work.writeEpoch, deleted: work.status === 'deleted' }
}
export async function readableWork(actorId: string | null, workId: string, tx = prisma) {
  const work = await tx.interactiveWork.findUnique({ where: { id: workId } })
  if (!work || work.status === 'deleted' || (work.status !== 'published' && work.creatorId !== actorId)) {
    throw new ContentError('work_unavailable', 404)
  }
  return work
}
export async function readableVersion(actorId: string | null, workId: string, versionId?: string) {
  const work = await readableWork(actorId, workId)
  const version = await prisma.interactiveVersion.findFirst({ where: { workId, id: versionId ?? work.currentVersionId ?? '' } })
  if (!version) throw new ContentError('version_unavailable', 404)
  return { work, version }
}
export function versionMetadata(version: InteractiveVersion) {
  return { versionId: version.id, seq: version.seq, actorId: version.actorId,
    basedOnVersionId: version.basedOnVersionId, changeSummary: version.changeSummary,
    createdAt: version.createdAt.toISOString(), digest: version.digest }
}
export async function touchActivity(userId: string, workId: string, kind: 'view' | 'interact', tx: Prisma.TransactionClient = prisma) {
  await tx.interactiveActivity.upsert({ where: { userId_workId_kind: { userId, workId, kind } },
    create: { id: id(), userId, workId, kind }, update: { updatedAt: new Date() } })
}
export type EnqueueInput = { actorId: string; kind: 'create' | 'modify' | 'save'; workId?: string; snapshotHtml?: string; snapshotBaseVersionId?: string; observation?: string;
  instruction: string; resourceIds: string[]; referenceId?: string; requestKey: string }

/** Body digest prevents a replay key from silently pointing at a different instruction or target. */
export async function enqueueContent(input: EnqueueInput) {
  const inputDigest = digest(JSON.stringify([input.kind, input.workId ?? null, input.instruction,
    input.resourceIds, input.referenceId ?? null, input.snapshotHtml ?? null, input.snapshotBaseVersionId ?? null, input.observation ?? null]))
  const prior = await prisma.interactiveJob.findUnique({ where: { actorId_requestKey: { actorId: input.actorId, requestKey: input.requestKey } } })
  if (prior) {
    if (prior.inputDigest !== inputDigest) throw new ContentError('idempotency_conflict', 409)
    return { requestId: prior.id, workId: prior.workId, status: prior.status }
  }
  if (input.kind !== 'create' && !input.workId) throw new ContentError('work_required')
  if (input.kind === 'save' && (!input.snapshotHtml || input.snapshotHtml.length > 120000 || !input.snapshotBaseVersionId)) throw new ContentError('invalid_snapshot')
  if (input.resourceIds.length > 8) throw new ContentError('too_many_assets')
  const assets = await prisma.interactiveAsset.findMany({ where: { id: { in: input.resourceIds }, ownerId: input.actorId } })
  if (assets.length !== new Set(input.resourceIds).size) throw new ContentError('asset_unavailable', 403)
  if (input.referenceId) {
    const version = await prisma.interactiveVersion.findUnique({ where: { id: input.referenceId } })
    if (!version) throw new ContentError('reference_unavailable', 404)
    await readableWork(input.actorId, version.workId)
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const work = input.kind === 'create'
        ? await tx.interactiveWork.create({ data: { id: id(), creatorId: input.actorId, summary: '' } })
        : await tx.interactiveWork.findUnique({ where: { id: input.workId! } })
      if (!work || work.status === 'deleted' || (work.status !== 'published' && work.creatorId !== input.actorId)) {
        throw new ContentError('work_unavailable', 404)
      }
      if (input.kind === 'save' && input.snapshotBaseVersionId !== work.currentVersionId) throw new ContentError('snapshot_base_changed', 409)
      const job = await tx.interactiveJob.create({ data: { id: id(), actorId: input.actorId, workId: work.id,
        kind: input.kind, requestKey: input.requestKey, inputDigest, instruction: input.instruction,
        resourceIds: [...new Set(input.resourceIds)], observation: input.observation, snapshotHtml: input.snapshotHtml, snapshotBaseVersionId: input.snapshotBaseVersionId, referenceId: input.referenceId, writeEpoch: work.writeEpoch } })
      return { requestId: job.id, workId: work.id, status: job.status }
    })
  } catch (error) {
    // Unique-key collision rolls back a concurrently-created placeholder work too.
    if ((error as { code?: string }).code !== 'P2002') throw error
    const job = await prisma.interactiveJob.findUniqueOrThrow({ where: { actorId_requestKey: { actorId: input.actorId, requestKey: input.requestKey } } })
    if (job.inputDigest !== inputDigest) throw new ContentError('idempotency_conflict', 409)
    return { requestId: job.id, workId: job.workId, status: job.status }
  }
}

export const LEASE_MS = 5 * 60_000
/** Different work rows run concurrently. Never hold the SQL transaction across a model call. */
export async function claimContentJob(workId: string, expectedJobId?: string) {
  const token = id(), now = new Date()
  return prisma.$transaction(async (tx) => {
    const changed = await tx.interactiveWork.updateMany({ where: { id: workId, status: { not: 'deleted' },
      OR: [{ leaseToken: null }, { leaseExpiresAt: { lt: now } }] },
    data: { leaseToken: token, leaseExpiresAt: new Date(now.getTime() + LEASE_MS) } })
    if (!changed.count) return null
    const work = await tx.interactiveWork.findUniqueOrThrow({ where: { id: workId } })
    // A process crash may have incurred provider cost. Do NOT automatically replay it.
    await tx.interactiveJob.updateMany({ where: { workId, status: 'running' },
      data: { status: 'failed', errorCode: 'worker_lease_expired', instruction: '', snapshotHtml: null, observation: null, finishedAt: now } })
    await tx.interactiveJob.updateMany({ where: { workId, status: 'queued', writeEpoch: { not: work.writeEpoch } },
      data: { status: 'invalidated', instruction: '', snapshotHtml: null, observation: null, finishedAt: now } })
    const job = await tx.interactiveJob.findFirst({ where: { workId, status: 'queued', writeEpoch: work.writeEpoch }, orderBy: { order: 'asc' } })
    if (!job || (expectedJobId && job.id !== expectedJobId)) {
      await tx.interactiveWork.update({ where: { id: workId }, data: { leaseToken: null, leaseExpiresAt: null } })
      return null
    }
    const claimed = await tx.interactiveJob.updateMany({ where: { id: job.id, status: 'queued', writeEpoch: work.writeEpoch }, data: { status: 'running', leaseToken: token,
      baseVersionId: work.currentVersionId, baseRevision: work.headRevision } })
    if (!claimed.count) {
      await tx.interactiveWork.updateMany({ where: { id: workId, leaseToken: token }, data: { leaseToken: null, leaseExpiresAt: null } })
      return null
    }
    return { job: { ...job, leaseToken: token, baseVersionId: work.currentVersionId, baseRevision: work.headRevision }, work }
  })
}
export type ClaimedJob = NonNullable<Awaited<ReturnType<typeof claimContentJob>>>
export type GeneratedArtifact = { title: string; summary: string; changeSummary: string;
  objectKey: string; digest: string; resourceIds: string[] }

export async function commitContentJob(claim: ClaimedJob, artifact: GeneratedArtifact) {
  return prisma.$transaction(async (tx) => {
    const work = await tx.interactiveWork.findUniqueOrThrow({ where: { id: claim.work.id } })
    const job = await tx.interactiveJob.findUniqueOrThrow({ where: { id: claim.job.id } })
    if (job.status !== 'running' || job.leaseToken !== claim.job.leaseToken) throw new ContentError('job_not_running', 409)
    const versionId = id()
    const transition = decideSharedSave({ head: asHead(work), fence: { workId: work.id, actorId: job.actorId,
      basedOnVersionId: claim.work.currentVersionId ?? '', headRevision: claim.work.headRevision,
      writeEpoch: claim.job.writeEpoch, leaseToken: claim.job.leaseToken! }, activeLeaseToken: work.leaseToken ?? '',
    leaseExpiresAt: work.leaseExpiresAt?.getTime() ?? 0, now: Date.now(), newVersionId: versionId,
    nextSeq: work.versionCount + 1, requestKey: `save:${job.id}` })
    const changed = await tx.interactiveWork.updateMany({ where: { id: work.id, status: work.status,
      headRevision: claim.work.headRevision, writeEpoch: claim.job.writeEpoch, leaseToken: claim.job.leaseToken,
      leaseExpiresAt: { gt: new Date() } }, data: { title: artifact.title, summary: artifact.summary,
      currentVersionId: versionId, newestVersionId: versionId, versionCount: transition.next.versionCount,
      headRevision: transition.next.headRevision, leaseToken: null, leaseExpiresAt: null } })
    if (!changed.count) throw new ContentError('commit_fence_changed', 409)
    await tx.interactiveVersion.create({ data: { id: versionId, workId: work.id, seq: transition.next.versionCount,
      actorId: job.actorId, basedOnVersionId: claim.work.currentVersionId, ...artifact } })
    await tx.interactiveHeadEvent.create({ data: { id: id(), workId: work.id, actorId: job.actorId, kind: 'save',
      fromId: claim.work.currentVersionId, toId: versionId, headRevision: transition.next.headRevision, requestKey: `save:${job.id}` } })
    await tx.interactiveJob.update({ where: { id: job.id }, data: { status: 'completed', instruction: '', snapshotHtml: null, observation: null, finishedAt: new Date() } })
    await tx.interactiveAsset.updateMany({ where: { id: { in: artifact.resourceIds }, ownerId: job.actorId, workId: null }, data: { workId: work.id } })
    if (work.status === 'published') await tx.interactiveAsset.updateMany({ where: { id: { in: artifact.resourceIds }, publishedAt: null }, data: { publishedAt: new Date() } })
    await touchActivity(job.actorId, work.id, 'interact', tx)
    return versionId
  })
}
/** Publication is a transaction: shared historical asset capabilities survive later source deletion. */
export async function publishContentWork(actorId: string, workId: string, expectedHeadRevision: number) {
  return prisma.$transaction(async (tx) => {
    const changed = await tx.interactiveWork.updateMany({ where: { id: workId, creatorId: actorId,
      status: { not: 'deleted' }, currentVersionId: { not: null }, headRevision: expectedHeadRevision }, data: { status: 'published' } })
    if (!changed.count) throw new ContentError('publish_unavailable_or_changed', 409)
    // Bounded pages; publishing makes saved history public, not private input instructions.
    let cursor: string | undefined
    while (true) {
      const versions = await tx.interactiveVersion.findMany({ where: { workId }, orderBy: { id: 'asc' }, take: 100,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, resourceIds: true } })
      const resources = [...new Set(versions.flatMap((version) => Array.isArray(version.resourceIds)
        ? version.resourceIds.filter((value): value is string => typeof value === 'string') : []))]
      if (resources.length) await tx.interactiveAsset.updateMany({ where: { id: { in: resources }, publishedAt: null }, data: { publishedAt: new Date() } })
      if (versions.length < 100) break
      cursor = versions[versions.length - 1].id
    }
    return { published: true }
  })
}
export async function failContentJob(claim: ClaimedJob, code: string) {
  await prisma.$transaction(async (tx) => {
    await tx.interactiveJob.updateMany({ where: { id: claim.job.id, status: 'running', leaseToken: claim.job.leaseToken },
      data: { status: 'failed', errorCode: code.slice(0, 64), instruction: '', snapshotHtml: null, observation: null, finishedAt: new Date() } })
    await tx.interactiveWork.updateMany({ where: { id: claim.work.id, leaseToken: claim.job.leaseToken },
      data: { leaseToken: null, leaseExpiresAt: null } })
  })
}

export async function activateContentVersion(actorId: string, workId: string, versionId: string, expected: number, requestKey: string) {
  return prisma.$transaction(async (tx) => {
    const prior = await tx.interactiveHeadEvent.findUnique({ where: { actorId_requestKey: { actorId, requestKey } } })
    if (prior) {
      if (prior.kind !== 'activate' || prior.workId !== workId || prior.toId !== versionId) throw new ContentError('idempotency_conflict', 409)
      return { currentVersionId: prior.toId, headRevision: prior.headRevision }
    }
    const work = await tx.interactiveWork.findUniqueOrThrow({ where: { id: workId } })
    const version = await tx.interactiveVersion.findFirst({ where: { id: versionId, workId } })
    if (!version) throw new ContentError('version_unavailable', 404)
    const transition = decideVersionActivation({ head: asHead(work), target: { workId, versionId,
      seq: version.seq, actorId: version.actorId, readable: true, safe: work.status !== 'deleted' },
    actorId, expectedHeadRevision: expected, requestKey })
    const changed = await tx.interactiveWork.updateMany({ where: { id: workId, creatorId: actorId,
      headRevision: expected, status: { not: 'deleted' } }, data: { currentVersionId: versionId,
      title: version.title, summary: version.summary, headRevision: transition.next.headRevision,
      writeEpoch: transition.next.writeEpoch, leaseToken: null, leaseExpiresAt: null } })
    if (!changed.count) throw new ContentError('head_changed', 409)
    await tx.interactiveJob.updateMany({ where: { workId, status: { in: ['queued', 'running'] }, writeEpoch: { lt: transition.next.writeEpoch } },
      data: { status: 'invalidated', instruction: '', snapshotHtml: null, observation: null, finishedAt: new Date() } })
    await tx.interactiveHeadEvent.create({ data: { id: id(), workId, actorId, kind: 'activate',
      fromId: work.currentVersionId, toId: versionId, headRevision: transition.next.headRevision, requestKey } })
    return { currentVersionId: versionId, headRevision: transition.next.headRevision }
  })
}

export async function cancelContentJob(actorId: string, requestId: string) {
  return prisma.$transaction(async (tx) => {
    const job = await tx.interactiveJob.findFirst({ where: { id: requestId, actorId } })
    if (!job) throw new ContentError('job_unavailable', 404)
    if (!['queued', 'running'].includes(job.status)) return { requestId, status: job.status }
    if (job.status === 'running' && job.leaseToken) {
      await tx.interactiveWork.updateMany({ where: { id: job.workId, leaseToken: job.leaseToken },
        data: { leaseToken: null, leaseExpiresAt: null } })
    }
    const changed = await tx.interactiveJob.updateMany({ where: { id: requestId, actorId, status: { in: ['queued', 'running'] } },
      data: { status: 'cancelled', instruction: '', snapshotHtml: null, observation: null, finishedAt: new Date() } })
    return { requestId, status: changed.count ? 'cancelled' : (await tx.interactiveJob.findUniqueOrThrow({ where: { id: requestId } })).status }
  })
}
