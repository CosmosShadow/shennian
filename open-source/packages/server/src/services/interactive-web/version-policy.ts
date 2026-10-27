// @arch open-source/docs/server-runtime.md
// @test src/__tests__/interactive-web-version-policy.test.ts

/** Pure decisions only. The repository must compare and persist these in ONE short transaction. */
export type WorkHead = Readonly<{
  workId: string
  creatorId: string
  currentVersionId: string
  newestVersionId: string
  versionCount: number
  headRevision: number
  writeEpoch: number
  deleted: boolean
}>
export type VersionRef = Readonly<{
  workId: string
  versionId: string
  seq: number
  actorId: string
  readable: boolean
  safe: boolean
}>
export type WriteFence = Readonly<{
  workId: string
  actorId: string
  basedOnVersionId: string
  headRevision: number
  writeEpoch: number
  leaseToken: string
}>
export type HeadTransition = {
  expected: WorkHead
  next: WorkHead
  event: { kind: 'save' | 'activate'; actorId: string; from: string; to: string; requestKey: string }
}
export class VersionPolicyError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'VersionPolicyError' }
}

function active(head: WorkHead) {
  if (head.deleted) throw new VersionPolicyError('work_deleted')
}
function readable(head: WorkHead, version: VersionRef) {
  active(head)
  if (version.workId !== head.workId || !version.readable || !version.safe) {
    throw new VersionPolicyError('version_unavailable')
  }
}

/** Dequeue reads the CURRENT head, not the snapshot captured when the request was submitted. */
export function startSharedWrite(input: {
  head: WorkHead; actorId: string; queuedWriteEpoch: number
  leaseToken: string; viewedVersionId: string; followCurrent: boolean
}): WriteFence {
  active(input.head)
  if (!input.followCurrent || input.viewedVersionId !== input.head.currentVersionId) {
    throw new VersionPolicyError('history_is_read_only')
  }
  if (input.queuedWriteEpoch !== input.head.writeEpoch) throw new VersionPolicyError('request_invalidated')
  if (!input.actorId || !input.leaseToken) throw new VersionPolicyError('invalid_identity_or_lease')
  return {
    workId: input.head.workId, actorId: input.actorId,
    basedOnVersionId: input.head.currentVersionId, headRevision: input.head.headRevision,
    writeEpoch: input.head.writeEpoch, leaseToken: input.leaseToken,
  }
}

/**
 * Must run after durable immutable artifact upload and inside commit's transaction.
 * Repository checks actor access, unique requestKey, unexpired lease and expected head atomically.
 * No automatic replay of non-idempotent external side effects.
 */
export function decideSharedSave(input: {
  head: WorkHead; fence: WriteFence; activeLeaseToken: string; leaseExpiresAt: number; now: number
  newVersionId: string; nextSeq: number; requestKey: string
}): HeadTransition {
  const { head, fence } = input
  active(head)
  if (fence.workId !== head.workId || fence.writeEpoch !== head.writeEpoch) throw new VersionPolicyError('request_invalidated')
  if (!input.activeLeaseToken || fence.leaseToken !== input.activeLeaseToken || input.leaseExpiresAt <= input.now) {
    throw new VersionPolicyError('lease_lost')
  }
  if (fence.headRevision !== head.headRevision || fence.basedOnVersionId !== head.currentVersionId) {
    throw new VersionPolicyError('head_changed')
  }
  if (!input.newVersionId || !input.requestKey || input.newVersionId === head.currentVersionId
    || input.newVersionId === head.newestVersionId || input.nextSeq !== head.versionCount + 1) {
    throw new VersionPolicyError('invalid_new_version')
  }
  return {
    expected: head,
    next: { ...head, currentVersionId: input.newVersionId, newestVersionId: input.newVersionId,
      versionCount: head.versionCount + 1, headRevision: head.headRevision + 1 },
    event: { kind: 'save', actorId: fence.actorId, from: head.currentVersionId,
      to: input.newVersionId, requestKey: input.requestKey },
  }
}

/** Activate does not erase history or create a duplicate immutable version. */
export function decideVersionActivation(input: {
  head: WorkHead; target: VersionRef; actorId: string; expectedHeadRevision: number; requestKey: string
}): HeadTransition {
  const { head, target } = input
  readable(head, target)
  if (input.actorId !== head.creatorId) throw new VersionPolicyError('creator_required')
  if (input.expectedHeadRevision !== head.headRevision) throw new VersionPolicyError('head_changed')
  if (!input.requestKey) throw new VersionPolicyError('request_key_required')
  return {
    expected: head,
    next: { ...head, currentVersionId: target.versionId,
      headRevision: head.headRevision + 1, writeEpoch: head.writeEpoch + 1 },
    event: { kind: 'activate', actorId: input.actorId, from: head.currentVersionId,
      to: target.versionId, requestKey: input.requestKey },
  }
}

export type ViewerPosition = Readonly<{
  workId: string; viewedVersionId: string; followCurrent: boolean; viewEpoch: number
}>
export function viewHistoricalVersion(head: WorkHead, target: VersionRef, viewer: ViewerPosition): ViewerPosition {
  readable(head, target)
  if (viewer.workId !== head.workId) throw new VersionPolicyError('context_changed')
  return { ...viewer, viewedVersionId: target.versionId, followCurrent: false, viewEpoch: viewer.viewEpoch + 1 }
}
export function followSharedCurrent(head: WorkHead, viewer: ViewerPosition): ViewerPosition {
  active(head)
  if (viewer.workId !== head.workId) throw new VersionPolicyError('context_changed')
  return { ...viewer, viewedVersionId: head.currentVersionId, followCurrent: true, viewEpoch: viewer.viewEpoch + 1 }
}
/** Historical viewers stay pinned even when another participant updates or restores the head. */
export function receiveSharedHead(head: WorkHead, viewer: ViewerPosition): ViewerPosition {
  if (viewer.workId !== head.workId || !viewer.followCurrent) return viewer
  return followSharedCurrent(head, viewer)
}
