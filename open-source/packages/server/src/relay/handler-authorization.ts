// @arch open-source/docs/server-runtime.md

// @arch open-source/docs/server-runtime.md
// @test src/__tests__/machine-version-gate.test.ts
// @test src/__tests__/machine-connection-rate-limit.test.ts
// @test src/__tests__/machine-ownership.test.ts
import WebSocket from 'ws'
import type { FastifyRequest } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { verifyToken } from '../services/jwt.js'
import { upsertSession } from '../services/sessions.js'
import { connections } from './connections.js'
import { pubsub } from './pubsub.js'
import {
  SESSION_SYNC_PROTOCOL_VERSION,
  SESSION_SYNC_DATA_EPOCH,
  SESSION_SYNC_ADDITIVE_CAPABILITIES,
  hasRequiredSessionSyncCapabilities,
  type Frame,
  type SessionActivitySnapshot,
  type SessionTitleGenerateParams,
  type SessionDeletionsAckParams,
  type SessionDeletionsSyncParams,
} from '@shennian/wire'
import { checkMachineCliVersion } from './machine-version-gate.js'
import { getMachineAccess, historicalPermissionAllowsUse } from '../services/machine-access.js'
import {
  getPersonalBodyReplicaIdentity,
  getPersonalHistoryIdentity,
  personalHistoryOpenError,
  personalHistoryRelay,
} from './personal-history-relay.js'
import {
  getSensitivePersonalIdentity,
  isAttachmentTransferMethod,
  sensitivePersonalRelay,
} from './sensitive-personal-relay.js'
import {
  acknowledgeSessionDeletions,
  syncSessionDeletions,
} from '../services/session-deletion-sync.js'
import { generateSessionTitleFromSeed } from '../services/session-title-generator.js'
import { setMachineAgents } from '../services/machine-status.js'
import {
  recordPersonalSyncClientCapability,
  recordPersonalSyncOperation,
} from '../services/personal-sync-operations.js'
import { projectFsSensitiveRelay } from './project-fs-sensitive-relay.js'
import {
  ATTACHMENT_RELAY_MAX_BUFFERED_BYTES,
  ClientAuthContext,
  MANAGED_AGENT_DIRECT_MIN_CLI_VERSION,
  STEWARD_MIN_CLI_VERSION,
  sendClientCloseAck,
  sendClientError,
  sendClientRes,
  sendMachineRes,
} from './handler-base.js'

async function authorizePersonalHistoryRequest(
  socket: WebSocket,
  mode: 'legacy' | 'multiplex',
  machineId: string,
  userId: string,
  authenticatedInstallationId: string | null,
  frame: Extract<Frame, { type: 'req' }>,
): Promise<boolean> {
  const isHistoryMethod =
    frame.method === 'session.history.open' ||
    frame.method === 'session.history.page' ||
    frame.method === 'session.history.close'
  if (!isHistoryMethod) return true
  const identity = getPersonalHistoryIdentity(frame)
  if (!identity) {
    sendClientRes(socket, mode, machineId, frame.id, 'invalid_identity')
    return false
  }
  if (frame.method === 'session.history.open') {
    recordPersonalSyncClientCapability(authenticatedInstallationId, 'session_scoped')
  }
  if (frame.method !== 'session.history.open') {
    if (
      personalHistoryRelay.hasClientRoute(
        socket,
        machineId,
        identity.sessionId,
        identity.subscriptionId,
      )
    )
      return true
    if (frame.method === 'session.history.close') {
      sendClientCloseAck(socket, mode, machineId, frame, identity)
      return false
    }
    sendClientRes(socket, mode, machineId, frame.id, 'subscription_not_found')
    return false
  }
  const session = await prisma.nianSession.findFirst({
    where: {
      id: identity.sessionId,
      machineId,
      userId,
      dataEpoch: SESSION_SYNC_DATA_EPOCH,
      deletedAt: null,
      bodyStorageMode: 'machine_local',
    },
    select: {
      id: true,
      machine: {
        select: {
          online: true,
          sessionSyncProtocolVersion: true,
          sessionSyncDataEpoch: true,
          sessionSyncCapabilities: true,
          daemonInstallationId: true,
        },
      },
    },
  })
  const availabilityError = personalHistoryOpenError(session)
  const missingCapabilities =
    session && Array.isArray(session.machine.sessionSyncCapabilities)
      ? !hasRequiredSessionSyncCapabilities(session.machine.sessionSyncCapabilities as string[])
      : true
  const identityConflict = session?.machine.daemonInstallationId !== identity.daemonInstallationId
  if (availabilityError || missingCapabilities || identityConflict) {
    recordPersonalSyncOperation('historyUnavailable')
    sendClientRes(
      socket,
      mode,
      machineId,
      frame.id,
      identityConflict ? 'invalid_identity' : (availabilityError ?? 'upgrade_required'),
    )
    return false
  }
  try {
    personalHistoryRelay.registerClientRoute({
      socket,
      machineId,
      sessionId: identity.sessionId,
      subscriptionId: identity.subscriptionId,
      protocolVersion: identity.protocolVersion,
      dataEpoch: identity.dataEpoch,
      daemonInstallationId: identity.daemonInstallationId,
      mode,
    })
    return true
  } catch (error) {
    sendClientRes(
      socket,
      mode,
      machineId,
      frame.id,
      error instanceof Error ? error.message : 'subscription_limit_exceeded',
    )
    return false
  }
}

async function authorizePersonalBodyReplicaRequest(
  socket: WebSocket,
  mode: 'legacy' | 'multiplex',
  machineId: string,
  userId: string,
  authenticatedInstallationId: string | null,
  frame: Extract<Frame, { type: 'req' }>,
): Promise<boolean> {
  if (
    frame.method !== 'session.body.replica.subscribe' &&
    frame.method !== 'session.body.replica.unsubscribe'
  )
    return true
  const identity = getPersonalBodyReplicaIdentity(frame)
  if (!identity) {
    sendClientRes(socket, mode, machineId, frame.id, 'invalid_identity')
    return false
  }
  if (!authenticatedInstallationId || identity.appInstallationId !== authenticatedInstallationId) {
    sendClientRes(socket, mode, machineId, frame.id, 'invalid_identity')
    return false
  }
  if (frame.method === 'session.body.replica.subscribe') {
    recordPersonalSyncClientCapability(authenticatedInstallationId, 'machine_stream')
  }
  if (frame.method === 'session.body.replica.unsubscribe') {
    if (
      personalHistoryRelay.hasReplicaRoute(
        socket,
        machineId,
        identity.streamId,
        identity.generation,
      )
    )
      return true
    const response: Frame = {
      type: 'res',
      id: frame.id,
      ok: true,
      payload: { ...identity, closed: true },
    }
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(
        mode === 'multiplex'
          ? JSON.stringify({ type: 'relay', machineId, frame: response })
          : JSON.stringify(response),
      )
    }
    return false
  }
  const machine = await prisma.machine.findFirst({
    where: {
      id: machineId,
      userId,
      online: true,
      daemonInstallationId: identity.daemonInstallationId,
      sessionSyncProtocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
      sessionSyncDataEpoch: SESSION_SYNC_DATA_EPOCH,
    },
    select: { sessionSyncCapabilities: true },
  })
  const capabilities = Array.isArray(machine?.sessionSyncCapabilities)
    ? (machine.sessionSyncCapabilities as string[])
    : []
  if (
    !machine ||
    !hasRequiredSessionSyncCapabilities(capabilities) ||
    !capabilities.includes('session_body_replica_stream_v1')
  ) {
    sendClientRes(socket, mode, machineId, frame.id, 'history_unavailable')
    return false
  }
  try {
    personalHistoryRelay.registerReplicaRoute({
      socket,
      mode,
      machineId,
      ...identity,
    })
    return true
  } catch (error) {
    sendClientRes(
      socket,
      mode,
      machineId,
      frame.id,
      error instanceof Error ? error.message : 'subscription_limit_exceeded',
    )
    return false
  }
}

async function authorizeSensitivePersonalRequest(
  socket: WebSocket,
  mode: 'legacy' | 'multiplex',
  machineId: string,
  userId: string,
  frame: Extract<Frame, { type: 'req' }>,
): Promise<boolean> {
  if (
    frame.method !== 'session.tool.detail' &&
    frame.method !== 'session.message.status' &&
    frame.method !== 'session.history.sync' &&
    !isAttachmentTransferMethod(frame.method)
  )
    return true
  const identity = getSensitivePersonalIdentity(frame)
  if (!identity) {
    sendClientRes(
      socket,
      mode,
      machineId,
      frame.id,
      frame.method === 'session.tool.detail'
        ? 'upgrade_required: exact toolCallId and detailRevision are required'
        : frame.method === 'session.history.sync'
          ? 'invalid history sync request'
          : frame.method === 'session.message.status'
            ? 'upgrade_required: exact sessionId and clientMessageId are required'
            : 'invalid_attachment_transfer_request',
    )
    return false
  }
  if (identity.kind === 'attachment_transfer') {
    const machineIdentity = await prisma.machine.findFirst({
      where: {
        id: machineId,
        daemonInstallationId: identity.daemonInstallationId,
        sessionSyncDataEpoch: SESSION_SYNC_DATA_EPOCH,
      },
      select: { id: true },
    })
    if (!machineIdentity) {
      sendClientRes(socket, mode, machineId, frame.id, 'invalid_identity')
      return false
    }
    const machineSocket = connections.getMachine(machineId)
    if (machineSocket && machineSocket.bufferedAmount > ATTACHMENT_RELAY_MAX_BUFFERED_BYTES) {
      sendClientRes(socket, mode, machineId, frame.id, 'attachment_relay_backpressure')
      return false
    }
    try {
      sensitivePersonalRelay.registerClientRequest({ socket, mode, machineId, frame })
      return true
    } catch (error) {
      sendClientRes(
        socket,
        mode,
        machineId,
        frame.id,
        error instanceof Error ? error.message : 'request_id_conflict',
      )
      return false
    }
  }
  const session = await prisma.nianSession.findFirst({
    where: {
      id: identity.sessionId,
      machineId,
      userId,
      dataEpoch: SESSION_SYNC_DATA_EPOCH,
      deletedAt: null,
      bodyStorageMode: 'machine_local',
    },
    select: {
      id: true,
      machine: {
        select: {
          online: true,
          sessionSyncProtocolVersion: true,
          sessionSyncDataEpoch: true,
          sessionSyncCapabilities: true,
          daemonInstallationId: true,
        },
      },
    },
  })
  if (
    !session ||
    !session.machine.online ||
    session.machine.sessionSyncProtocolVersion !== SESSION_SYNC_PROTOCOL_VERSION ||
    session.machine.sessionSyncDataEpoch !== SESSION_SYNC_DATA_EPOCH ||
    !hasRequiredSessionSyncCapabilities(
      Array.isArray(session.machine.sessionSyncCapabilities)
        ? (session.machine.sessionSyncCapabilities as string[])
        : null,
    ) ||
    (identity.kind === 'history_sync' &&
      !(
        Array.isArray(session.machine.sessionSyncCapabilities) &&
        (session.machine.sessionSyncCapabilities as string[]).includes(
          SESSION_SYNC_ADDITIVE_CAPABILITIES[0],
        )
      )) ||
    !session.machine.daemonInstallationId ||
    session.machine.daemonInstallationId !== identity.daemonInstallationId
  ) {
    sendClientRes(
      socket,
      mode,
      machineId,
      frame.id,
      identity.kind === 'tool_detail'
        ? 'tool_detail_unavailable'
        : identity.kind === 'history_sync'
          ? 'history_unavailable'
          : 'message_status_unavailable',
    )
    return false
  }
  try {
    sensitivePersonalRelay.registerClientRequest({ socket, mode, machineId, frame })
    return true
  } catch (error) {
    sendClientRes(
      socket,
      mode,
      machineId,
      frame.id,
      error instanceof Error ? error.message : 'request_id_conflict',
    )
    return false
  }
}

const PERSONAL_IDENTITY_METHODS = new Set([
  'chat.send',
  'chat.enqueue',
  'chat.queue.get',
  'chat.codex.settings.get',
  'chat.codex.settings.set',
  'chat.queue.edit',
  'chat.queue.delete',
  'chat.queue.promote',
  'chat.abort',
  'session.refresh',
  'session.history',
  'session.resume',
  'session.title.set',
  'voice.session.body.window',
])

async function authorizePersonalIdentityRequest(
  socket: WebSocket,
  mode: 'legacy' | 'multiplex',
  machineId: string,
  userId: string,
  frame: Extract<Frame, { type: 'req' }>,
): Promise<boolean> {
  if (!PERSONAL_IDENTITY_METHODS.has(frame.method)) return true
  const { protocolVersion, dataEpoch, daemonInstallationId } = frame.params
  if (
    protocolVersion !== SESSION_SYNC_PROTOCOL_VERSION ||
    dataEpoch !== SESSION_SYNC_DATA_EPOCH ||
    typeof daemonInstallationId !== 'string' ||
    !daemonInstallationId ||
    daemonInstallationId.length > 191
  ) {
    sendClientRes(socket, mode, machineId, frame.id, 'invalid_identity')
    return false
  }
  const machine = await prisma.machine.findFirst({
    where: {
      id: machineId,
      daemonInstallationId,
      sessionSyncDataEpoch: SESSION_SYNC_DATA_EPOCH,
    },
    select: { id: true, cliVersion: true },
  })
  if (!machine) {
    sendClientRes(socket, mode, machineId, frame.id, 'invalid_identity')
    return false
  }
  const sessionId = typeof frame.params.sessionId === 'string' ? frame.params.sessionId : ''
  const personalSession = sessionId
    ? await prisma.nianSession.findFirst({
        where: { id: sessionId, machineId, userId, deletedAt: null },
        select: { agentIdentityId: true, sessionScope: true, agentType: true, workDir: true, agentSessionId: true, sessionMode: true },
      })
    : null
  if (!personalSession) {
    sendClientError(socket, mode, machineId, frame.id, 'session_owner_required')
    return false
  }
  if (frame.method === 'chat.codex.settings.get' || frame.method === 'chat.codex.settings.set') {
    // Never trust a client-supplied scope or native thread identity.
    frame.params.codexSettingsSession = personalSession
  }
  if (frame.method === 'chat.send' || frame.method === 'chat.enqueue') {
    const params = frame.params as Record<string, unknown>
    delete params.managedAgentDirect
    // Steward scope comes only from the Server session row, never from the client.
    delete params.sessionScope
    if (sessionId && personalSession.sessionScope === 'steward') {
      if (!checkMachineCliVersion(machine.cliVersion, STEWARD_MIN_CLI_VERSION).allowed) {
        sendClientError(socket, mode, machineId, frame.id, 'steward_requires_cli_upgrade')
        return false
      }
      params.sessionScope = 'steward'
    }
    if (sessionId) {
      if (personalSession.agentIdentityId) {
        if (frame.method === 'chat.enqueue') {
          const supported = checkMachineCliVersion(
            machine.cliVersion,
            MANAGED_AGENT_DIRECT_MIN_CLI_VERSION,
          ).allowed
          if (supported) {
            // The Relay, not the client, attests that this owner-authenticated
            // queue item belongs to a managed Agent session. The daemon then
            // derives the current binding, prompt and permission policy locally.
            params.managedAgentDirect = true
            return true
          }
        }
        sendClientError(
          socket,
          mode,
          machineId,
          frame.id,
          frame.method === 'chat.enqueue'
            ? 'managed_agent_direct_requires_cli_upgrade'
            : 'managed_agent_direct_dispatch_forbidden',
        )
        return false
      }
    }
  }
  return true
}

async function authorizeRemoteAccessPauseRequest(
  socket: WebSocket,
  mode: 'legacy' | 'multiplex',
  machineId: string,
  userId: string,
  frame: Extract<Frame, { type: 'req' }>,
): Promise<boolean> {
  if (frame.method !== 'machine.remote-access.pause') return true
  const machine = await prisma.machine.findUnique({
    where: { id: machineId },
    select: { userId: true, online: true },
  })
  if (!machine || machine.userId !== userId) {
    sendClientError(socket, mode, machineId, frame.id, 'machine_owner_required')
    return false
  }
  if (!machine.online) {
    sendClientError(socket, mode, machineId, frame.id, 'machine_offline')
    return false
  }
  return true
}

function sendSubscriptionCloses(socket: WebSocket): void {
  projectFsSensitiveRelay.closeSocket(socket)
  sensitivePersonalRelay.closeSocket(socket)
  personalHistoryRelay.closeSocket(socket, (machineId, frame) => {
    personalHistoryRelay.observeForwardedRequest(machineId, frame)
    const data = JSON.stringify(frame)
    if (!connections.sendToMachine(machineId, data)) pubsub.publishToRelay(machineId, data)
  })
}

function tryParseReqFrame(data: string): Extract<Frame, { type: 'req' }> | null {
  try {
    const frame = JSON.parse(data) as Frame
    if (frame?.type === 'req' && typeof frame.id === 'string' && typeof frame.method === 'string') {
      return frame
    }
  } catch {
    // not JSON or not a req frame
  }
  return null
}

async function handleMachineServerReq(
  socket: WebSocket,
  machineId: string,
  ownerId: string | undefined,
  frame: Extract<Frame, { type: 'req' }>,
): Promise<boolean> {
  if (frame.method === 'machine.agents.report') {
    if (!ownerId) throw new Error('machine_owner_required')
    const agents = frame.params?.agents
    if (!Array.isArray(agents)) throw new Error('machine_agents_invalid')
    try { await setMachineAgents(machineId, agents) }
    catch (error) {
      // The daemon must stop public delivery if its new proof was not stored.
      socket.close(1011, 'machine capability update failed')
      throw error
    }
    sendMachineRes(socket, frame.id, true)
    return true
  }
  if (frame.method === 'session.deletions.sync') {
    if (!ownerId) throw new Error('machine_owner_required')
    const payload = await syncSessionDeletions({
      machineId,
      ownerId,
      params: frame.params as SessionDeletionsSyncParams,
    })
    sendMachineRes(socket, frame.id, true, payload)
    return true
  }
  if (frame.method === 'session.deletions.ack') {
    if (!ownerId) throw new Error('machine_owner_required')
    const payload = await acknowledgeSessionDeletions({
      machineId,
      ownerId,
      params: frame.params as SessionDeletionsAckParams,
    })
    sendMachineRes(socket, frame.id, true, payload)
    return true
  }
  if (frame.method === 'session.title.generate') {
    if (!ownerId) throw new Error('machine_owner_required')
    const payload = await generateSessionTitleFromSeed(
      machineId,
      ownerId,
      frame.params as SessionTitleGenerateParams,
    )
    sendMachineRes(socket, frame.id, true, payload)
    return true
  }
  if (frame.method !== 'wecom.send' && frame.method !== 'external.send') return false
  sendMachineRes(socket, frame.id, false, 'feature_retired')
  return true
}

async function authenticateClient(
  socket: WebSocket,
  request: FastifyRequest,
): Promise<ClientAuthContext | null> {
  const url = new URL(request.url, 'http://localhost')
  const token = url.searchParams.get('token')
  if (!token) {
    socket.close(4001, 'Missing token')
    return null
  }

  const payload = verifyToken(token)
  if (!payload) {
    socket.close(4001, 'Invalid token')
    return null
  }

  const device = await prisma.device.findUnique({
    where: { id: payload.deviceId },
    select: { platform: true, tokenExpiry: true, installationId: true },
  })
  if (!device || device.tokenExpiry < new Date() || device.platform === 'web') {
    socket.close(4001, 'Token expired')
    return null
  }

  return {
    userId: payload.userId,
    deviceId: payload.deviceId,
    installationId: device.installationId,
    platform: device.platform,
  }
}

async function ensureMachineAccess(
  machineId: string,
  userId: string,
): Promise<Awaited<ReturnType<typeof getMachineAccess>> | 'not-found'> {
  const machine = await prisma.machine.findUnique({
    where: { id: machineId },
    select: { id: true },
  })
  if (!machine) return 'not-found'
  return (await getMachineAccess(machineId, userId, 'view')) ?? null
}

const SHARED_MACHINE_PUBLIC_EVENTS = new Set([
  'tick',
  'machine.agents',
  'machine.status',
  'machine.removed',
  'machine.upgrade-policy',
  'upgrade',
])

const PERSONAL_SESSION_EVENTS = new Set([
  'session.update',
  'session.activity',
  'session.delete',
  'session.queue.update',
  'session.user-state',
  'session.body.delta',
  'session.body.error',
  'session.body.replica.delta',
  'session.body.replica.error',
])

async function shouldDeliverSharedMachineFrame(
  data: string,
  machineId: string,
  userId: string,
  pendingRequestIds: Set<string>,
): Promise<boolean> {
  let frame: { type?: string; id?: string; event?: string; payload?: unknown }
  try {
    frame = JSON.parse(data) as typeof frame
  } catch {
    return false
  }

  if (frame.type === 'res') {
    if (!frame.id || !pendingRequestIds.delete(frame.id)) return false
    return true
  }
  if (frame.type !== 'event' || !frame.event) return false
  if (SHARED_MACHINE_PUBLIC_EVENTS.has(frame.event)) return true
  if (!PERSONAL_SESSION_EVENTS.has(frame.event)) return false

  const payload = frame.payload as
    | {
        sessionId?: unknown
        session?: { id?: unknown }
        queue?: { sessionId?: unknown }
      }
    | undefined
  const sessionId =
    frame.event === 'session.update'
      ? payload?.session?.id
      : frame.event === 'session.queue.update'
        ? payload?.queue?.sessionId
        : payload?.sessionId
  if (typeof sessionId !== 'string' || !sessionId) return false
  const session = await prisma.nianSession.findFirst({
    where: { id: sessionId, machineId, userId, deletedAt: null },
    select: { id: true },
  })
  return Boolean(session)
}

function rememberPendingRequest(pendingRequestIds: Set<string>, requestId: string): void {
  pendingRequestIds.add(requestId)
  if (pendingRequestIds.size <= 2_000) return
  const oldest = pendingRequestIds.values().next().value
  if (oldest) pendingRequestIds.delete(oldest)
}

async function authorizeMachineUseRequest(
  socket: WebSocket,
  mode: 'legacy' | 'multiplex',
  machineId: string,
  userId: string,
  frame: Extract<Frame, { type: 'req' }>,
): Promise<boolean> {
  if (frame.method === 'room.message.deliver' || frame.method === 'project.taskEvent') {
    sendClientError(socket, mode, machineId, frame.id, 'server_request_required')
    return false
  }
  const access = await getMachineAccess(machineId, userId, 'view')
  if (
    access &&
    (access.role === 'owner' || historicalPermissionAllowsUse(access.permission ?? ''))
  ) {
    return true
  }
  sendClientError(socket, mode, machineId, frame.id, 'machine_access_denied')
  return false
}

const MACHINE_OWNER_ONLY_METHODS = new Set([
  'personal.workspace', 'personal.recording',
  'personal.apps.list', 'personal.apps.register', 'personal.apps.remove', 'personal.service',
  'chat.codex.settings.get',
  'chat.codex.settings.set',
  'upgrade.start',
  'upgrade.set-policy',
  'region.switch',
  'agents.refresh',
  'agent.config.upsert',
  'agent.config.clear',
  'agent.config.test',
  'skill.install',
  'skill.setup',
  'manager.channel.upsert',
  'machine.remote-access.pause',
])

async function authorizeMachineOwnerRequest(
  socket: WebSocket,
  mode: 'legacy' | 'multiplex',
  machineId: string,
  userId: string,
  frame: Extract<Frame, { type: 'req' }>,
): Promise<boolean> {
  if (!MACHINE_OWNER_ONLY_METHODS.has(frame.method)) return true
  const machine = await prisma.machine.findFirst({
    where: { id: machineId, userId, ...(frame.method.startsWith('personal.') ? { paired: true, remoteAccessDisabledAt: null } : {}) },
    select: { id: true },
  })
  if (machine) return true
  sendClientError(socket, mode, machineId, frame.id, 'machine_owner_required')
  return false
}

async function handleSessionUpdateEvent(
  machineId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const session = payload.session as
    | {
        id: string
        agentType?: string
        agentSessionId?: string
        modelId?: string | null
        status?: string
        workDir?: string
      }
    | undefined

  if (!session?.id) return

  const machine = await prisma.machine.findUnique({
    where: { id: machineId },
    select: { userId: true },
  })
  if (!machine?.userId) return

  await upsertSession({
    id: session.id,
    machineId,
    userId: machine.userId,
    agentType: session.agentType,
    agentSessionId: session.agentSessionId,
    modelId: session.modelId,
    status: session.status,
    workDir: session.workDir,
  })
}

// Per-session queue to serialise activity updates so that a slow delta
// cannot overtake a fast final and revive a cleared activity snapshot.
const activityQueues = new Map<string, Promise<void>>()

function enqueueActivityUpdate(
  sessionId: string,
  work: () => Promise<SessionActivitySnapshot | null | undefined>,
  onResult: (activity: SessionActivitySnapshot | null | undefined) => void,
): void {
  const prev = activityQueues.get(sessionId) ?? Promise.resolve()
  const next = prev
    .then(() => work())
    .then(onResult)
    .catch(() => {})
    .finally(() => {
      if (activityQueues.get(sessionId) === next) {
        activityQueues.delete(sessionId)
      }
    })
  activityQueues.set(sessionId, next)
}

export {
  MACHINE_OWNER_ONLY_METHODS,
  PERSONAL_IDENTITY_METHODS,
  PERSONAL_SESSION_EVENTS,
  SHARED_MACHINE_PUBLIC_EVENTS,
  activityQueues,
  authenticateClient,
  authorizeMachineOwnerRequest,
  authorizeMachineUseRequest,
  authorizePersonalBodyReplicaRequest,
  authorizePersonalHistoryRequest,
  authorizePersonalIdentityRequest,
  authorizeRemoteAccessPauseRequest,
  authorizeSensitivePersonalRequest,
  enqueueActivityUpdate,
  ensureMachineAccess,
  handleMachineServerReq,
  handleSessionUpdateEvent,
  rememberPendingRequest,
  sendSubscriptionCloses,
  shouldDeliverSharedMachineFrame,
  tryParseReqFrame,
}
