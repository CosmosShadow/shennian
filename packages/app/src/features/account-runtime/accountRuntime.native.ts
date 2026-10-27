// @arch docs/features/desktop-local-first-client.md#33-进程职责

import { subscribeRelayConnectivity, useSessionsStore } from '@shennian/shared'
import type { RelayConnectivitySnapshot, ResFrame } from '@shennian/wire'
import { getRelayManager, getSyncEngine } from '../../config/sync'
import {
  ACCOUNT_MACHINE_REQUEST_METHODS,
  type AccountMachineRequestMethod,
  type AccountMachineRequestOptions,
  type AccountRuntime,
} from './accountRuntime.types'

const allowedMachineMethods = new Set<string>(ACCOUNT_MACHINE_REQUEST_METHODS)

function requireEngine() {
  const engine = getSyncEngine()
  if (!engine) throw new Error('Account sync is unavailable')
  return engine
}

function requireRelayManager() {
  const manager = getRelayManager()
  if (!manager) throw new Error('Machine is offline')
  return manager
}

export const accountRuntime: AccountRuntime = {
  async loadProjectSessions(projectId, page) {
    return requireEngine().loadProjectSessions(projectId, page)
  },
  async persistSession(session) {
    await requireEngine().persistSession(session)
  },
  async deleteSession(sessionId, cleanupPolicy) {
    const session = await (await import('../../storage/db.native')).db.getSessionSyncTarget!(sessionId)
    if (session?.localCreationState === 'draft') {
      const { db } = await import('../../storage/db.native')
      await db.putSessionDeletion({ sessionId, deletedAt: new Date().toISOString(), state: 'confirmed', nativeCleanupPolicy: 'none' })
      await db.deleteSession(sessionId)
      useSessionsStore.getState().removeSession(sessionId)
      return
    }
    await requireEngine().requestSessionDeletion(sessionId, cleanupPolicy ?? 'auto')
  },
  async updateSessionUserState(sessionId, userState) {
    const session = await (await import('../../storage/db.native')).db.getSessionSyncTarget!(sessionId)
    if (session?.localCreationState === 'draft') {
      const now = new Date().toISOString()
      const next = { ...session, userState: {
        userId: session.userId, sessionId, lastReadAt: null, manualUnread: false, pinnedAt: null,
        ...session.userState,
        ...(userState.pinned === undefined ? {} : { pinnedAt: userState.pinned ? now : null }),
        ...(typeof userState.manualUnread === 'boolean' ? { manualUnread: userState.manualUnread } : {}),
        updatedAt: now,
      } }
      await requireEngine().persistSession(next)
      useSessionsStore.getState().upsertSession(next)
      return
    }
    await requireEngine().updateSessionUserState(sessionId, userState)
  },
  async markSessionRead(sessionId, lastReadAt, readWatermark) {
    if ((await (await import('../../storage/db.native')).db.getSessionSyncTarget!(sessionId))?.localCreationState === 'draft') return
    await requireEngine().markSessionRead(sessionId, lastReadAt, readWatermark as never)
  },
  async deleteProject(projectId) {
    await requireEngine().deleteProject(projectId)
  },
  async persistProject(project) {
    await requireEngine().persistProject(project)
  },
  async reconnect(source) {
    requireRelayManager().reconnectNow(source ?? 'manual')
  },
  async observeMachine(machineId) {
    return Boolean(requireRelayManager().acquire(machineId))
  },
  async unobserveMachine(machineId) {
    requireRelayManager().release(machineId)
  },
  async requestMachine(machineId, method, params, options) {
    assertAllowedMethod(method)
    const manager = requireRelayManager()
    const frame = { type: 'req' as const, method, params }
    if (options?.waitUntilReady === false) return manager.send(machineId, frame as never)
    return manager.sendWhenReady(
      machineId,
      frame as never,
      options?.connectTimeoutMs,
      options?.responseTimeoutMs,
    ) as Promise<ResFrame>
  },
  getConnectivitySnapshot() {
    return getRelayManager()?.getUserConnectivitySnapshot() ?? null
  },
  subscribeConnectivity(listener) {
    return subscribeRelayConnectivity(listener)
  },
}

function assertAllowedMethod(method: AccountMachineRequestMethod): void {
  if (!allowedMachineMethods.has(method)) throw new Error('Machine request method is not allowed')
}

export type { AccountMachineRequestMethod, AccountMachineRequestOptions }
export type { RelayConnectivitySnapshot }
