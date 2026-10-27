// @arch docs/tasks/20260929-1455_神念管家本机入口.md
// @test src/__tests__/steward-model.test.ts

import { create } from 'zustand'
import type { NianSession } from '@shennian/wire'
import { authApi } from '../../config/api'
import { db } from '../../storage/db'
import { accountRuntime } from '../account-runtime/accountRuntime'
import { isStewardSession, paintedStewardReadSession, stewardReadWatermark, unreadStewardSessionsOnMachine } from './stewardModel'

/**
 * Steward conversations are deliberately absent from the ordinary sessions store
 * (it hides internal sessions from every project and conversation list), so the
 * steward keeps its own small store: the local database is the base, the Server's
 * steward history is merged in, and only this account's steward sessions enter.
 */
type StewardSessionsState = {
  accountId: string
  sessions: NianSession[]
  hydrated: boolean
  /** Ids this device just deleted; a slower in-flight fetch must not resurrect them. */
  deletedIds: Set<string>
  hydrate(accountId: string): Promise<void>
  refresh(accountId: string): Promise<boolean>
  upsert(session: NianSession): void
  remove(ids: readonly string[]): void
  markRead(sessionId: string, presented?: NianSession): Promise<void>
  markMachineRead(machineId: string, presentedCurrent: NianSession): Promise<void>
}

function mine(sessions: readonly NianSession[], accountId: string): NianSession[] {
  return sessions.filter((session) => isStewardSession(session) && session.userId === accountId && !session.deletedAt)
}

function merge(current: readonly NianSession[], incoming: readonly NianSession[]): NianSession[] {
  const byId = new Map(current.map((session) => [session.id, session]))
  for (const session of incoming) {
    const existing = byId.get(session.id)
    // A draft has no Server row yet; never let an older snapshot regress a created session.
    if (existing && existing.localCreationState !== 'draft' && session.localCreationState === 'draft') continue
    // A row the Server returns exists there, so a local copy still marked draft has been created (sent).
    const created = existing?.localCreationState === 'draft' && session.localCreationState !== 'draft'
    // A refresh started before a successful read PATCH may arrive afterwards.
    // Do not let that older snapshot recreate a dot this device already cleared.
    const localRead = existing?.userState
    const remoteRead = session.userState
    const keepLocalRead = (localRead?.lastReadAttentionCount ?? 0) > (remoteRead?.lastReadAttentionCount ?? 0)
    byId.set(session.id, existing ? {
      ...existing, ...session,
      ...(keepLocalRead ? { userState: localRead } : {}),
      ...(created ? { localCreationState: 'created' as const } : {}),
    } : session)
  }
  return [...byId.values()]
}

// Focus and the selected-session effect can request the same index concurrently.
const hydrations = new Map<string, Promise<void>>()
const refreshes = new Map<string, Promise<boolean>>()

export const useStewardSessionsStore = create<StewardSessionsState>((set, get) => ({
  accountId: '',
  sessions: [],
  hydrated: false,
  deletedIds: new Set(),
  async hydrate(accountId) {
    if (!accountId || (get().accountId === accountId && get().hydrated)) return
    const pending = hydrations.get(accountId)
    if (pending) return pending
    const task = (async () => {
      let local: NianSession[] = []
      try {
        local = mine(await (db.getSessionSyncTargets?.() ?? db.getSessions()), accountId)
      } catch { /* an unreadable local store still leaves the Server history */ }
      set((state) => ({
        accountId,
        sessions: merge(
          state.accountId === accountId ? state.sessions : [],
          local.filter((session) => !state.deletedIds.has(session.id)),
        ),
        hydrated: true,
      }))
    })()
    hydrations.set(accountId, task)
    try { await task } finally { if (hydrations.get(accountId) === task) hydrations.delete(accountId) }
  },
  async refresh(accountId) {
    if (!accountId) return false
    const pending = refreshes.get(accountId)
    if (pending) return pending
    const task = (async () => {
      try {
        const { sessions } = await authApi<{ sessions: NianSession[] }>('/sessions/steward?limit=50')
        const remote = mine(sessions, accountId)
        for (const session of remote) {
          try { await accountRuntime.persistSession(session) } catch { /* the in-memory copy still works */ }
        }
        set((state) => ({
          accountId,
          // A refresh in flight when the user deletes a session must not resurrect it
          // once its (now stale) response lands.
          sessions: merge(
            state.accountId === accountId ? state.sessions : [],
            remote.filter((session) => !state.deletedIds.has(session.id)),
          ),
        }))
        return true
      } catch {
        return false
      }
    })()
    refreshes.set(accountId, task)
    try { return await task } finally { if (refreshes.get(accountId) === task) refreshes.delete(accountId) }
  },
  remove(ids) {
    if (!ids.length) return
    const gone = new Set(ids)
    set((state) => ({
      sessions: state.sessions.filter((session) => !gone.has(session.id)),
      deletedIds: new Set([...state.deletedIds, ...ids]),
    }))
  },
  /** Submit one steward session's captured attention watermark, never the ordinary store's. */
  async markRead(sessionId, presented) {
    const session = useStewardSessionsStore.getState().sessions.find((item) => item.id === sessionId)
    const readWatermark = stewardReadWatermark(presented ?? session)
    if (!session || !readWatermark) return
    if (readWatermark.attentionCount <= (session.userState?.lastReadAttentionCount ?? 0)) return
    const lastReadAt = new Date().toISOString()
    await authApi(`/sessions/${encodeURIComponent(sessionId)}/user-state`, {
      method: 'PATCH',
      body: JSON.stringify({ manualUnread: false, lastReadAt, readWatermark }),
    })
    const read = (item: NianSession): NianSession => ({
      ...item,
      userState: {
        ...(item.userState ?? { userId: item.userId, sessionId, updatedAt: lastReadAt }),
        sessionId,
        userId: item.userId,
        manualUnread: false,
        lastReadAt,
        lastReadBodyRevision: readWatermark.bodyRevision,
        lastReadVisibleMessageCount: readWatermark.visibleMessageCount,
        lastReadVisibleMessageId: readWatermark.lastVisibleMessageId,
        lastReadAttentionCount: readWatermark.attentionCount,
        lastReadAttentionId: readWatermark.lastAttentionId,
        updatedAt: lastReadAt,
      },
    })
    set((state) => ({
      sessions: state.sessions.map((item) => (item.id === sessionId ? read(item) : item)),
    }))
    // Keep the local copy in step, so a cold start does not show the dot again before a refresh.
    try { await accountRuntime.persistSession(read(session)) } catch { /* the Server copy is authoritative */ }
  },
  async markMachineRead(machineId, presentedCurrent) {
    const accountId = useStewardSessionsStore.getState().accountId
    // Include older conversations the initial local hydrate may not know about yet.
    // A failed refresh cannot prove that every conversation on this machine was
    // acknowledged; let the painted view retry rather than silently succeeding.
    if (accountId && !await useStewardSessionsStore.getState().refresh(accountId)) {
      throw new Error('steward_read_refresh_failed')
    }
    const unread = unreadStewardSessionsOnMachine(useStewardSessionsStore.getState().sessions, machineId)
    const latestCurrent = unread.find((session) => session.id === presentedCurrent.id)
    if (latestCurrent && (latestCurrent.bodyRevision ?? 0) > (presentedCurrent.bodyRevision ?? 0)) {
      // The refresh found a newer body after the paint callback. Keep the read
      // pending until that body paints; do not silently complete with a stale
      // attention watermark and leave the list dot stuck.
      throw new Error('steward_painted_body_stale')
    }
    await Promise.all(unread.map((session) => useStewardSessionsStore.getState().markRead(
      session.id,
      session.id === presentedCurrent.id ? paintedStewardReadSession(presentedCurrent, session) : undefined,
    )))
  },
  upsert(session) {
    if (!isStewardSession(session)) return
    set((state) => ({
      accountId: state.accountId || session.userId,
      sessions: merge(state.sessions, [session]),
    }))
  },
}))
