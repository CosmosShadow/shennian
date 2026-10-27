import { create } from 'zustand'
import type { NianSession, SessionActivitySnapshot, SessionUserState } from '@shennian/wire'
import {
  filterManagerSubstrateSessions,
  isManagerWorkerSession,
  isProjectVisibleSession,
  sortSessions,
} from '../lib/session-list'
import { mergeSessionPatch } from '../lib/sync-session-state'
import { incrementRuntimeMetric } from '../runtime-metrics'

function filterRetainedSessionProjection(sessions: NianSession[]): NianSession[] {
  const ordinary = filterManagerSubstrateSessions(sessions)
  const ordinaryIds = new Set(ordinary.map((session) => session.id))
  return sessions.filter((session) =>
    ordinaryIds.has(session.id)
    || (session.agentIdentityId == null && isManagerWorkerSession(session)),
  )
}

function upsertPreview(
  previews: Record<string, string>,
  previewTimestamps: Record<string, string>,
  sessionId: string,
  text: string | undefined,
  updatedAt: string,
) {
  if (text === undefined) {
    return { previews, previewTimestamps }
  }
  return {
    previews: { ...previews, [sessionId]: text },
    previewTimestamps: { ...previewTimestamps, [sessionId]: updatedAt },
  }
}

function projectSessionPreview(
  previews: Record<string, string>,
  previewTimestamps: Record<string, string>,
  session: NianSession,
) {
  const preview = session.lastMessagePreview?.trim()
  if (!preview) return { previews, previewTimestamps }

  // A canonical list preview is an indivisible tuple. Legacy/incomplete
  // projections must not borrow a later tool/heartbeat activity timestamp;
  // retain the previous complete render tuple until exact repair arrives.
  if (!session.lastMessagePreviewMessageId || !session.lastMessagePreviewAt) {
    return { previews, previewTimestamps }
  }

  const incomingAt = session.lastMessagePreviewAt
  const cachedAt = previewTimestamps[session.id]
  const incomingMs = new Date(incomingAt).getTime()
  const cachedMs = new Date(cachedAt ?? '').getTime()
  const isOlder = Number.isFinite(cachedMs) && Number.isFinite(incomingMs) && incomingMs < cachedMs
  if (isOlder) return { previews, previewTimestamps }
  if (previews[session.id] === preview && cachedAt === incomingAt) {
    return { previews, previewTimestamps }
  }
  return upsertPreview(previews, previewTimestamps, session.id, preview, incomingAt)
}

function projectSessionPreviews(
  previews: Record<string, string>,
  previewTimestamps: Record<string, string>,
  sessions: NianSession[],
) {
  let nextPreviews = previews
  let nextTimestamps = previewTimestamps
  for (const session of sessions) {
    const next = projectSessionPreview(nextPreviews, nextTimestamps, session)
    nextPreviews = next.previews
    nextTimestamps = next.previewTimestamps
  }
  return { previews: nextPreviews, previewTimestamps: nextTimestamps }
}

function newerIso(
  left: string | null | undefined,
  right: string | null | undefined,
): string | null {
  if (!left) return right ?? null
  if (!right) return left
  return new Date(right).getTime() > new Date(left).getTime() ? right : left
}

function sessionSnapshotEqual(left: NianSession, right: NianSession): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sessionSortKeyEqual(left: NianSession, right: NianSession): boolean {
  return (
    left.lastUserMessageAt === right.lastUserMessageAt &&
    left.createdAt === right.createdAt &&
    left.userState?.pinnedAt === right.userState?.pinnedAt
  )
}

function mergeSessionSnapshot(current: NianSession, session: NianSession): NianSession {
  const merged = mergeSessionPatch(current, session)
  return {
    ...merged,
    createdAt: session.createdAt || current.createdAt,
    lastActivityAt: session.lastActivityAt || current.lastActivityAt,
    updatedAt: session.updatedAt || current.updatedAt,
    externalChannel:
      session.externalChannel === undefined ? current.externalChannel : session.externalChannel,
    ownerName: session.ownerName === undefined ? current.ownerName : session.ownerName,
    ownerPhone: session.ownerPhone === undefined ? current.ownerPhone : session.ownerPhone,
    ownerEmail: session.ownerEmail === undefined ? current.ownerEmail : session.ownerEmail,
    canManage: session.canManage === undefined ? current.canManage : session.canManage,
    sharedMachineSession:
      session.sharedMachineSession === undefined
        ? current.sharedMachineSession
        : session.sharedMachineSession,
  }
}

function normalizeNewSessionPreview(session: NianSession): NianSession {
  if (session.lastMessagePreview == null) {
    return {
      ...session,
      lastMessagePreview: null,
      lastMessagePreviewMessageId: null,
      lastMessagePreviewAt: null,
    }
  }
  if (
    typeof session.lastMessagePreviewMessageId === 'string' &&
    session.lastMessagePreviewMessageId.length > 0 &&
    Number.isFinite(new Date(session.lastMessagePreviewAt ?? '').getTime())
  ) return session
  return {
    ...session,
    lastMessagePreview: null,
    lastMessagePreviewMessageId: null,
    lastMessagePreviewAt: null,
  }
}

type SessionsState = {
  sessions: NianSession[]
  loading: boolean
  /** True while SyncEngine is performing a server sync round (boot or reconnect). */
  serverSyncing: boolean
  previews: Record<string, string>
  previewTimestamps: Record<string, string>
  setSessions(sessions: NianSession[]): void
  upsertSession(session: NianSession): void
  upsertSessions(sessions: NianSession[]): void
  removeSession(id: string): void
  setLoading(loading: boolean): void
  setServerSyncing(syncing: boolean): void
  setPreview(sessionId: string, text: string, updatedAt: string): void
  touchSession(sessionId: string, lastActivityAt: string, preview?: string): void
  applyActivity(
    sessionId: string,
    lastActivityAt: string,
    preview?: string,
    opts?: { lastReadAt?: string | null; userMessageAt?: string },
  ): void
  updateSessionUserState(sessionId: string, patch: Partial<SessionUserState> | null): void
  updateSessionActivity(sessionId: string, activity: SessionActivitySnapshot | null): void
}

export const useSessionsStore = create<SessionsState>((set) => ({
  sessions: [],
  loading: true,
  serverSyncing: true,
  previews: {},
  previewTimestamps: {},
  setSessions(incoming) {
    set((state) => {
      const visible = filterRetainedSessionProjection(
        incoming.filter((session) => !session.deletedAt),
      )
      const previewState = projectSessionPreviews(
        state.previews,
        state.previewTimestamps,
        visible,
      )
      return { sessions: sortSessions(visible), loading: false, ...previewState }
    })
  },
  upsertSession(session) {
    set((s) => {
      const now = new Date().toISOString()
      if (session.deletedAt || !isProjectVisibleSession(session)) {
        return { sessions: s.sessions.filter((item) => item.id !== session.id) }
      }
      const idx = s.sessions.findIndex((x) => x.id === session.id)
      if (idx >= 0) {
        const merged = mergeSessionSnapshot(s.sessions[idx], session)
        const previewState = projectSessionPreview(s.previews, s.previewTimestamps, merged)
        if (sessionSnapshotEqual(s.sessions[idx], merged)) {
          if (
            previewState.previews === s.previews &&
            previewState.previewTimestamps === s.previewTimestamps
          ) return s
          return previewState
        }
        const next = [...s.sessions]
        next[idx] = merged
        const visible = filterRetainedSessionProjection(next)
        const nextSessions = sessionSortKeyEqual(s.sessions[idx], merged)
          ? visible
          : sortSessions(visible)
        return { sessions: nextSessions, ...previewState }
      }
      const filled = normalizeNewSessionPreview({
        ...session,
        createdAt: session.createdAt || now,
        lastActivityAt: session.lastActivityAt || session.updatedAt || now,
        updatedAt: session.updatedAt || now,
      })
      return {
        sessions: sortSessions(filterRetainedSessionProjection([filled, ...s.sessions])),
        ...projectSessionPreview(s.previews, s.previewTimestamps, filled),
      }
    })
  },
  upsertSessions(incoming) {
    if (incoming.length === 0) return
    set((state) => {
      const byId = new Map(state.sessions.map((session) => [session.id, session]))
      let changed = false
      let sortChanged = false
      const now = new Date().toISOString()
      for (const session of incoming) {
        const current = byId.get(session.id)
        if (session.deletedAt || !isProjectVisibleSession(session)) {
          if (current) {
            byId.delete(session.id)
            changed = true
          }
          continue
        }
        const next = current
          ? mergeSessionSnapshot(current, session)
          : normalizeNewSessionPreview({
              ...session,
              createdAt: session.createdAt || now,
              lastActivityAt: session.lastActivityAt || session.updatedAt || now,
              updatedAt: session.updatedAt || now,
            })
        if (current && sessionSnapshotEqual(current, next)) continue
        byId.set(session.id, next)
        changed = true
        sortChanged = sortChanged || !current || !sessionSortKeyEqual(current, next)
      }
      const previewState = projectSessionPreviews(
        state.previews,
        state.previewTimestamps,
        incoming.map((session) => byId.get(session.id) ?? session),
      )
      if (!changed) {
        if (
          previewState.previews === state.previews &&
          previewState.previewTimestamps === state.previewTimestamps
        ) return state
        return previewState
      }
      const sessions = filterRetainedSessionProjection([...byId.values()])
      return {
        sessions: sortChanged ? sortSessions(sessions) : sessions,
        ...previewState,
      }
    })
  },
  removeSession(id) {
    set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id) }))
  },
  setLoading(loading) {
    set({ loading })
  },
  setServerSyncing(syncing) {
    set({ serverSyncing: syncing })
  },
  setPreview(sessionId, text, updatedAt) {
    set((s) => {
      if (s.previews[sessionId] === text && s.previewTimestamps[sessionId] === updatedAt) return s
      return {
        previews: { ...s.previews, [sessionId]: text },
        previewTimestamps: { ...s.previewTimestamps, [sessionId]: updatedAt },
      }
    })
  },
  applyActivity(sessionId, lastActivityAt, preview, opts) {
    set((s) => {
      const idx = s.sessions.findIndex((x) => x.id === sessionId)
      if (idx < 0) return s

      const current = s.sessions[idx]
      const currentTs = new Date(current.lastActivityAt).getTime()
      const incomingTs = new Date(lastActivityAt).getTime()
      const nextActivityAt =
        Number.isFinite(incomingTs) && incomingTs > currentTs
          ? lastActivityAt
          : current.lastActivityAt

      const currentPreviewTs = new Date(s.previewTimestamps[sessionId] ?? '').getTime()
      const canApplyPreview =
        preview !== undefined &&
        (!Number.isFinite(currentPreviewTs) ||
          !Number.isFinite(incomingTs) ||
          incomingTs >= currentPreviewTs)

      const nextPreview = canApplyPreview ? preview : s.previews[sessionId]
      const nextPreviewTs = canApplyPreview ? lastActivityAt : s.previewTimestamps[sessionId]
      const nextVisibleEventAt = canApplyPreview
        ? newerIso(current.lastVisibleEventAt, lastActivityAt)
        : current.lastVisibleEventAt
      // Optimistic chat text lives in the preview cache only. The canonical
      // session tuple is replaced atomically by the daemon index event, where
      // text, message id and timestamp all identify the same envelope.
      const nextSessionPreview = current.lastMessagePreview
      const nextUserMessageAt = newerIso(current.lastUserMessageAt, opts?.userMessageAt)
      const nextReadAt =
        opts?.lastReadAt === undefined
          ? undefined
          : opts.lastReadAt === null
            ? null
            : newerIso(current.userState?.lastReadAt, opts.lastReadAt)
      const nextUserState =
        opts?.lastReadAt === undefined
          ? current.userState
          : current.userState?.lastReadAt === nextReadAt &&
              current.userState?.manualUnread === false
            ? current.userState
            : {
                ...(current.userState ?? {
                  sessionId,
                  userId: current.userId,
                  updatedAt: new Date().toISOString(),
                }),
                sessionId,
                userId: current.userId,
                lastReadAt: nextReadAt,
                manualUnread: false,
                updatedAt: new Date().toISOString(),
              }

      const sessionChanged =
        nextUserMessageAt !== (current.lastUserMessageAt ?? null) ||
        nextActivityAt !== current.lastActivityAt ||
        nextVisibleEventAt !== current.lastVisibleEventAt ||
        nextSessionPreview !== current.lastMessagePreview ||
        nextUserState !== current.userState
      const previewChanged =
        canApplyPreview &&
        (nextPreview !== s.previews[sessionId] || nextPreviewTs !== s.previewTimestamps[sessionId])

      if (!sessionChanged && !previewChanged) return s

      const nextSessions = [...s.sessions]
      nextSessions[idx] = {
        ...current,
        lastUserMessageAt: nextUserMessageAt,
        lastActivityAt: nextActivityAt,
        lastVisibleEventAt: nextVisibleEventAt,
        lastMessagePreview: nextSessionPreview,
        ...(nextUserState ? { userState: nextUserState } : {}),
      }
      const sorted =
        sessionSortKeyEqual(current, nextSessions[idx]) ? nextSessions : sortSessions(nextSessions)

      const previewState = upsertPreview(
        s.previews,
        s.previewTimestamps,
        sessionId,
        nextPreview,
        nextPreviewTs ?? lastActivityAt,
      )

      return {
        sessions: sorted,
        previews: previewChanged ? previewState.previews : s.previews,
        previewTimestamps: previewChanged ? previewState.previewTimestamps : s.previewTimestamps,
      }
    })
  },
  touchSession(sessionId, lastActivityAt, preview) {
    set((s) => {
      const idx = s.sessions.findIndex((x) => x.id === sessionId)
      if (idx < 0) return s

      const current = s.sessions[idx]
      const currentTs = new Date(current.lastActivityAt).getTime()
      const incomingTs = new Date(lastActivityAt).getTime()
      const nextActivityAt =
        Number.isFinite(incomingTs) && incomingTs > currentTs
          ? lastActivityAt
          : current.lastActivityAt

      const currentPreviewTs = new Date(s.previewTimestamps[sessionId] ?? '').getTime()
      const canApplyPreview =
        preview !== undefined &&
        (!Number.isFinite(currentPreviewTs) ||
          !Number.isFinite(incomingTs) ||
          incomingTs >= currentPreviewTs)
      const nextPreview = canApplyPreview ? preview : s.previews[sessionId]
      const nextPreviewTs = canApplyPreview ? lastActivityAt : s.previewTimestamps[sessionId]
      const nextVisibleEventAt = canApplyPreview
        ? newerIso(current.lastVisibleEventAt, lastActivityAt)
        : current.lastVisibleEventAt
      const nextSessionPreview = current.lastMessagePreview
      if (
        nextActivityAt === current.lastActivityAt &&
        nextVisibleEventAt === current.lastVisibleEventAt &&
        nextSessionPreview === current.lastMessagePreview &&
        (!canApplyPreview ||
          (nextPreview === s.previews[sessionId] &&
            nextPreviewTs === s.previewTimestamps[sessionId]))
      ) {
        return s
      }
      const nextSessions = [...s.sessions]
      nextSessions[idx] = {
        ...current,
        lastActivityAt: nextActivityAt,
        lastVisibleEventAt: nextVisibleEventAt,
        lastMessagePreview: nextSessionPreview,
      }
      const previewState = upsertPreview(
        s.previews,
        s.previewTimestamps,
        sessionId,
        nextPreview,
        nextPreviewTs ?? lastActivityAt,
      )
      return {
        sessions: nextSessions,
        previews: canApplyPreview ? previewState.previews : s.previews,
        previewTimestamps: canApplyPreview ? previewState.previewTimestamps : s.previewTimestamps,
      }
    })
  },
  updateSessionUserState(sessionId, patch) {
    set((s) => {
      const idx = s.sessions.findIndex((x) => x.id === sessionId)
      if (idx < 0) return s
      const current = s.sessions[idx]
      const nextSessions = [...s.sessions]
      nextSessions[idx] = {
        ...current,
        userState: patch
          ? {
              ...(current.userState ?? {
                sessionId,
                userId: current.userId,
                updatedAt: new Date().toISOString(),
              }),
              ...patch,
              sessionId,
              userId: current.userId,
            }
          : null,
      }
      return {
        sessions:
          current.userState?.pinnedAt === nextSessions[idx].userState?.pinnedAt
            ? nextSessions
            : sortSessions(nextSessions),
      }
    })
  },
  updateSessionActivity(sessionId, activity) {
    set((s) => {
      const idx = s.sessions.findIndex((x) => x.id === sessionId)
      if (idx < 0) return s
      if (JSON.stringify(s.sessions[idx].activity ?? null) === JSON.stringify(activity ?? null)) {
        return s
      }
      const nextSessions = [...s.sessions]
      nextSessions[idx] = {
        ...s.sessions[idx],
        activity,
      }
      return { sessions: nextSessions }
    })
  },
}))

useSessionsStore.subscribe(() => incrementRuntimeMetric('store.sessions_notifications'))
