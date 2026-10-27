// @arch open-source/docs/shared-runtime.md
// @test src/__tests__/sync-engine.test.ts

import {
  isInternalSession,
  type NianSession,
  type SessionActivitySnapshot,
  type SessionUserState,
} from '@shennian/wire'

function toMs(value: string | null | undefined): number {
  if (!value) return 0
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function newerIso(left: string | null | undefined, right: string | null | undefined): string {
  return toMs(right) > toMs(left)
    ? (right ?? left ?? new Date().toISOString())
    : (left ?? right ?? new Date().toISOString())
}

function hasReadablePreview(preview: string | null | undefined): preview is string {
  return typeof preview === 'string' && preview.trim().length > 0
}

export function normalizeSession(session: NianSession): NianSession {
  return {
    ...session,
    lastActivityAt: session.lastActivityAt || session.updatedAt || new Date().toISOString(),
    deletedAt: session.deletedAt ?? null,
    userState: session.userState ?? null,
    activity: session.activity ?? null,
    externalChannel: session.externalChannel ?? null,
  }
}

export function sessionSnapshotEqual(left: NianSession, right: NianSession): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function activityProjectionEqual(
  left: SessionActivitySnapshot | null | undefined,
  right: SessionActivitySnapshot | null | undefined,
): boolean {
  if (!left || !right) return !left && !right
  return (
    left.runId === right.runId &&
    left.runPhase === right.runPhase &&
    left.toolCallCount === right.toolCallCount &&
    left.canStop === right.canStop
  )
}

export function mergeReadWatermark(
  existing: string | null | undefined,
  incoming: string | null | undefined,
): string | null | undefined {
  if (incoming === undefined) return existing
  if (incoming === null) return null
  if (!existing) return incoming
  return newerIso(existing, incoming)
}

function mergeSessionUserState(
  existing: SessionUserState | null | undefined,
  incoming: SessionUserState | null | undefined,
): SessionUserState | null {
  if (incoming === undefined) return existing ?? null
  if (incoming === null) return null
  if (!existing) return incoming

  const existingReadRevision = existing.lastReadBodyRevision ?? 0
  const incomingReadRevision = incoming.lastReadBodyRevision ?? 0
  const keepExistingReadIndex = existingReadRevision > incomingReadRevision
  const existingReadAttention = existing.lastReadAttentionCount ?? 0
  const incomingReadAttention = incoming.lastReadAttentionCount ?? 0
  const keepExistingAttention = existingReadAttention > incomingReadAttention

  return {
    ...existing,
    ...incoming,
    lastReadAt: mergeReadWatermark(existing.lastReadAt, incoming.lastReadAt) ?? null,
    lastReadBodyRevision: keepExistingReadIndex
      ? existingReadRevision
      : incomingReadRevision,
    lastReadVisibleMessageCount: keepExistingReadIndex
      ? (existing.lastReadVisibleMessageCount ?? 0)
      : (incoming.lastReadVisibleMessageCount ?? 0),
    lastReadVisibleMessageId: keepExistingReadIndex
      ? (existing.lastReadVisibleMessageId ?? null)
      : (incoming.lastReadVisibleMessageId ?? null),
    lastReadAttentionCount: keepExistingAttention
      ? existingReadAttention
      : incomingReadAttention,
    lastReadAttentionId: keepExistingAttention
      ? (existing.lastReadAttentionId ?? null)
      : (incoming.lastReadAttentionId ?? null),
    readSyncPending:
      incoming.readSyncPending === false
        ? false
        : existing.readSyncPending || incoming.readSyncPending || false,
    updatedAt: newerIso(existing.updatedAt, incoming.updatedAt),
  }
}

function mergeSessionProjection(
  existing: NianSession,
  patch: Partial<NianSession>,
  opts?: { localLatestMessageTs?: number },
): Pick<
  NianSession,
  | 'lastActivityAt'
  | 'lastMessagePreview'
  | 'lastMessagePreviewMessageId'
  | 'lastMessagePreviewAt'
  | 'lastVisibleEventAt'
  | 'lastUserMessageAt'
> {
  const hasIncomingActivity =
    typeof patch.lastActivityAt === 'string' && patch.lastActivityAt.length > 0
  const incomingActivityAt = hasIncomingActivity ? patch.lastActivityAt! : existing.lastActivityAt
  const existingActivityMs = toMs(existing.lastActivityAt)
  const incomingActivityMs = toMs(incomingActivityAt)
  const hasIncomingPreview = Object.prototype.hasOwnProperty.call(patch, 'lastMessagePreview')
  const incomingPreview = hasIncomingPreview
    ? (patch.lastMessagePreview ?? null)
    : (existing.lastMessagePreview ?? null)
  const hasIncomingPreviewIdentity =
    Object.prototype.hasOwnProperty.call(patch, 'lastMessagePreviewMessageId') &&
    Object.prototype.hasOwnProperty.call(patch, 'lastMessagePreviewAt')
  const hasCompleteIncomingPreviewTuple = hasIncomingPreview && hasIncomingPreviewIdentity && (
    incomingPreview === null
      ? patch.lastMessagePreviewMessageId == null && patch.lastMessagePreviewAt == null
      : typeof patch.lastMessagePreviewMessageId === 'string'
        && patch.lastMessagePreviewMessageId.length > 0
        && toMs(patch.lastMessagePreviewAt) > 0
  )

  const nextActivityAt =
    hasIncomingActivity && incomingActivityMs > existingActivityMs
      ? patch.lastActivityAt!
      : existing.lastActivityAt
  const nextVisibleEventAt =
    toMs(patch.lastVisibleEventAt) > toMs(existing.lastVisibleEventAt)
      ? patch.lastVisibleEventAt!
      : existing.lastVisibleEventAt ?? null

  const localLatestMessageTs = opts?.localLatestMessageTs ?? 0
  const localCoversIncomingActivity =
    localLatestMessageTs > 0 && localLatestMessageTs >= incomingActivityMs

  let nextPreview = incomingPreview
  let nextPreviewMessageId = existing.lastMessagePreviewMessageId ?? null
  let nextPreviewAt = existing.lastMessagePreviewAt ?? null

  if (hasCompleteIncomingPreviewTuple) {
    nextPreviewMessageId = patch.lastMessagePreviewMessageId ?? null
    nextPreviewAt = patch.lastMessagePreviewAt ?? null
  } else if (hasIncomingPreview) {
    nextPreview = existing.lastMessagePreview ?? null
  }

  if (!hasCompleteIncomingPreviewTuple && hasIncomingActivity && incomingActivityMs < existingActivityMs) {
    nextPreview = existing.lastMessagePreview ?? null
  } else if (!hasCompleteIncomingPreviewTuple && !hasReadablePreview(nextPreview) && hasReadablePreview(existing.lastMessagePreview)) {
    nextPreview = existing.lastMessagePreview
  } else if (
    !hasCompleteIncomingPreviewTuple &&
    hasReadablePreview(existing.lastMessagePreview) &&
    hasReadablePreview(nextPreview) &&
    nextPreview !== existing.lastMessagePreview &&
    localCoversIncomingActivity
  ) {
    nextPreview = existing.lastMessagePreview
  }

  return {
    lastActivityAt: nextActivityAt,
    lastMessagePreview: nextPreview,
    lastMessagePreviewMessageId: nextPreviewMessageId,
    lastMessagePreviewAt: nextPreviewAt,
    lastVisibleEventAt: nextVisibleEventAt,
    lastUserMessageAt: toMs(patch.lastUserMessageAt) > toMs(existing.lastUserMessageAt)
      ? patch.lastUserMessageAt : existing.lastUserMessageAt ?? null,
  }
}

export function mergeSessionPatch(
  existing: NianSession,
  patch: Partial<NianSession>,
  opts?: { localLatestMessageTs?: number },
): NianSession {
  const existingIndexRevision = existing.indexRevision ?? 0
  const incomingIndexRevision = patch.indexRevision
  if (
    incomingIndexRevision !== undefined &&
    incomingIndexRevision < existingIndexRevision
  ) {
    // A delayed list page or Relay projection must never roll canonical index
    // fields backwards. User state is a separate account projection and may
    // still legitimately advance while carrying an older session index.
    return normalizeSession({
      ...existing,
      userState: Object.prototype.hasOwnProperty.call(patch, 'userState')
        ? mergeSessionUserState(existing.userState, patch.userState)
        : existing.userState ?? null,
    })
  }
  const defined = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  )
  const nextUserState =
    'userState' in defined
      ? mergeSessionUserState(
          existing.userState,
          defined.userState as SessionUserState | null | undefined,
        )
      : existing.userState
  const nextProjection = mergeSessionProjection(existing, defined, opts)

  return normalizeSession({
    ...existing,
    ...defined,
    ...nextProjection,
    ...(isInternalSession(existing) ? { nativeSessionVisibility: 'internal' as const } : {}),
    // Promotion is one-way even if an older composer snapshot is persisted later.
    ...(existing.localCreationState === 'created' ? { localCreationState: 'created' as const } : {}),
    userState: nextUserState ?? null,
  })
}
