// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test ../../__tests__/desktop-account-runtime.test.ts

import { useEffect, useSyncExternalStore } from 'react'
import {
  getSessionLiveActivity,
  useChatStore,
  useMachinesStore,
  useProjectsStore,
  useSessionsStore,
} from '@shennian/shared'
import type {
  EventFrame,
  Machine,
  NianProject,
  NianSession,
  UpgradeEventPayload,
} from '@shennian/wire'
import { scheduleNativeBadgeSync } from '../../lib/push-badge'
import { publishAgentRefreshEvent, publishAgentReplicaRevision } from '../agents/agentEvents'
import { publishRoomRelayEvent, publishRoomReplicaRevision } from '../rooms/roomEvents'
import {
  markChatOutboundSessionDeleted,
  removeChatOutboundSession,
} from '../chat/utils/outboundStorage'
import { removeChatDraft } from '../chat/utils/draftStorage'
import {
  publishDesktopRoomNotification,
  publishDesktopSessionNotification,
} from './desktopNotifications'
import {
  DesktopAccountRuntime,
  requireDesktopAccountSyncBridge,
  type DesktopAccountProjection,
  type DesktopAccountRuntimeState,
  type DesktopAccountSyncEvent,
  type DesktopAccountSyncSnapshot,
} from './desktopAccountRuntime'
import type { DesktopMachineOperation, AccountMachineRequestOptions } from '../account-runtime/accountRuntime.types'
import type { DesktopSessionLaunchInput } from '../desktop-launch/desktopSessionLaunch'

let rendererRuntime: DesktopAccountRuntime | null = null

function requireRendererRuntime(): DesktopAccountRuntime {
  rendererRuntime ??= new DesktopAccountRuntime(
    requireDesktopAccountSyncBridge(),
    createDesktopAccountProjection(),
  )
  return rendererRuntime
}

export function useDesktopAccountSync(): DesktopAccountRuntimeState {
  const runtime = requireRendererRuntime()
  const state = useSyncExternalStore(
    runtime.subscribeState,
    runtime.getState,
    runtime.getState,
  )
  useEffect(() => runtime.retain(), [runtime])
  return state
}

export function getDesktopAccountRuntimeState(): DesktopAccountRuntimeState {
  return requireRendererRuntime().getState()
}

export function subscribeDesktopAccountRuntimeState(listener: () => void): () => void {
  return requireRendererRuntime().subscribeState(listener)
}

/** Desktop-only domain operations. No SyncEngine or RelayManager escapes into the renderer. */
export const desktopAccountActions = {
  createSession: (input: DesktopSessionLaunchInput) => requireRendererRuntime().createSession(input),
  clearLocalData: () => requireRendererRuntime().clearLocalData(),
  reconcile: (context?: unknown) => requireRendererRuntime().reconcile(context),
  syncVisibleSessionBody: (sessionId: string) => requireRendererRuntime().syncVisibleSessionBody(sessionId),
  reconnect: (source?: string) => requireRendererRuntime().reconnect(source),
  loadProjectSessions: (projectId: string, page?: unknown) =>
    requireRendererRuntime().loadProjectSessions(projectId, page),
  persistSession: (session: NianSession) => requireRendererRuntime().persistSession(session),
  deleteSession: (sessionId: string, cleanupPolicy?: 'none' | 'auto') =>
    requireRendererRuntime().deleteSession(sessionId, cleanupPolicy),
  updateSessionUserState: (sessionId: string, userState: unknown) =>
    requireRendererRuntime().updateSessionUserState(sessionId, userState),
  markSessionRead: (sessionId: string, lastReadAt?: string, readWatermark?: unknown) =>
    requireRendererRuntime().markSessionRead(sessionId, lastReadAt, readWatermark),
  deleteProject: (projectId: string) => requireRendererRuntime().deleteProject(projectId),
  canonicalizeProject: (input: { machineId: string; workDir: string }) => requireRendererRuntime().canonicalizeProject(input),
  resolveProjectAliases: () => requireRendererRuntime().resolveProjectAliases(),
  observeMachine: (machineId: string) => requireRendererRuntime().observeMachine(machineId),
  unobserveMachine: (machineId: string) => requireRendererRuntime().unobserveMachine(machineId),
  requestMachineOperation: <T>(
    operation: DesktopMachineOperation,
    machineId: string,
    params: Record<string, unknown>,
    options?: AccountMachineRequestOptions,
  ) => requireRendererRuntime().requestMachineOperation<T>(
    operation,
    machineId,
    params,
    options?.connectTimeoutMs,
    options?.responseTimeoutMs,
  ),
  publishMachineEvent: (machineId: string, event: EventFrame) =>
    requireRendererRuntime().publishMachineEvent(machineId, event),
  setNetworkOnline: (online: boolean) => requireRendererRuntime().setNetworkOnline(online),
}

function createDesktopAccountProjection(): DesktopAccountProjection {
  return {
    applySnapshot(snapshot) {
      useSessionsStore.getState().setSessions(snapshot.sessions)
      useSessionsStore.getState().setServerSyncing(snapshot.status.phase === 'syncing')
      useMachinesStore.getState().setMachines(snapshot.machines)
      useMachinesStore.getState().setRemoteResolved(snapshot.status.remoteResolved)
      useProjectsStore.getState().setProjects(snapshot.projects)
      if (!snapshot.accountId) useChatStore.getState().clear()
      else {
        publishRoomReplicaRevision(null, ['inventory'])
        publishAgentReplicaRevision()
      }
    },
    applyEvent(event) {
      applyDesktopAccountEvent(event)
    },
  }
}

function applyDesktopAccountEvent(event: DesktopAccountSyncEvent): void {
  switch (event.type) {
    case 'status': {
      const status = event.value as DesktopAccountSyncSnapshot['status']
      useSessionsStore.getState().setServerSyncing(status.phase === 'syncing')
      useMachinesStore.getState().setRemoteResolved(status.remoteResolved)
      if (status.phase === 'signed-out') useChatStore.getState().clear()
      return
    }
    case 'sessions': {
      const sessions = asSessions(event.value)
      if (sessions) useSessionsStore.getState().setSessions(sessions)
      return
    }
    case 'session-upsert': {
      const session = asSession(event.value)
      if (session) applySessionUpsert(session)
      return
    }
    case 'session-batch': {
      const sessions = asSessions(event.value)
      if (!sessions) return
      const previousById = new Map(
        useSessionsStore.getState().sessions.map((session) => [session.id, session]),
      )
      useSessionsStore.getState().upsertSessions(sessions)
      for (const session of sessions) {
        publishDesktopSessionNotification(previousById.get(session.id), session)
      }
      return
    }
    case 'session-delete':
      applySessionDelete(event.accountId, event.value)
      return
    case 'machines':
    case 'machine-status':
    case 'machine-agents': {
      const machines = asMachines(event.value)
      if (machines) useMachinesStore.getState().setMachines(machines)
      return
    }
    case 'projects': {
      const projects = asProjects(event.value)
      if (projects) useProjectsStore.getState().setProjects(projects)
      return
    }
    case 'session-queue': {
      const value = asObject(event.value)
      const chat = useChatStore.getState()
      if (typeof value?.sessionId === 'string' && chat.sessionId === value.sessionId) {
        chat.setQueue((value.queue ?? null) as never)
      }
      return
    }
    case 'agent-revision':
      publishAgentReplicaRevision()
      return
    case 'room-revision': {
      const value = asObject(event.value)
      if (
        (value?.roomId === null || typeof value?.roomId === 'string') &&
        Array.isArray(value.scopes) &&
        value.scopes.every((scope) => typeof scope === 'string')
      ) {
        publishRoomReplicaRevision(value.roomId as string | null, value.scopes as string[])
      }
      return
    }
    case 'relay-event':
      applyRelayEvent(event.accountId, event.value)
  }
}

function applySessionUpsert(session: NianSession): void {
  const previous = useSessionsStore.getState().sessions.find((item) => item.id === session.id)
  useSessionsStore.getState().upsertSession(session)
  publishDesktopSessionNotification(previous, session)
  if (unreadStateChanged(previous, session)) scheduleNativeBadgeSync()

  const chat = useChatStore.getState()
  if (chat.sessionId === session.id) chat.restoreRunPhase(getSessionLiveActivity(session))
}

function applySessionDelete(accountId: string | null, value: unknown): void {
  const deletion = asObject(value)
  if (typeof deletion?.sessionId !== 'string' || !deletion.sessionId) return
  const sessionId = deletion.sessionId
  markChatOutboundSessionDeleted(sessionId)
  useSessionsStore.getState().removeSession(sessionId)
  if (accountId) {
    removeChatOutboundSession(accountId, sessionId)
    removeChatDraft(accountId, sessionId)
  }
  const chat = useChatStore.getState()
  if (chat.sessionId === sessionId) chat.clear()
}

function applyRelayEvent(accountId: string | null, value: unknown): void {
  const payload = asObject(value)
  if (typeof payload?.machineId !== 'string' || !isEventFrame(payload.event)) return
  const frame = payload.event
  if (frame.event === 'upgrade') {
    const upgrade = asObject(frame.payload)
    if (typeof upgrade?.machineId === 'string') {
      useMachinesStore.getState().handleUpgradeEvent(upgrade as UpgradeEventPayload & {
        machineId: string
      })
    }
  }
  publishRoomRelayEvent(frame)
  publishAgentRefreshEvent(frame)
  publishDesktopRoomNotification(frame, accountId ?? undefined)
}

function unreadStateChanged(previous: NianSession | undefined, next: NianSession): boolean {
  return (
    previous?.userState?.lastReadAt !== next.userState?.lastReadAt ||
    previous?.userState?.manualUnread !== next.userState?.manualUnread
  )
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asSession(value: unknown): NianSession | null {
  const session = asObject(value)
  return typeof session?.id === 'string' && typeof session.machineId === 'string'
    ? (session as NianSession)
    : null
}

function asSessions(value: unknown): NianSession[] | null {
  if (!Array.isArray(value)) return null
  const sessions = value.map(asSession)
  return sessions.every((session): session is NianSession => session !== null) ? sessions : null
}

function asMachines(value: unknown): Machine[] | null {
  if (!Array.isArray(value)) return null
  return value.every((machine) => typeof asObject(machine)?.id === 'string')
    ? (value as Machine[])
    : null
}

function asProjects(value: unknown): NianProject[] | null {
  if (!Array.isArray(value)) return null
  return value.every((project) => typeof asObject(project)?.id === 'string')
    ? (value as NianProject[])
    : null
}

function isEventFrame(value: unknown): value is EventFrame {
  const frame = asObject(value)
  return frame?.type === 'event' && typeof frame.event === 'string'
}
