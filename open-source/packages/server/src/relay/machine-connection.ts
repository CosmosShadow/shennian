// @arch open-source/docs/server-runtime.md

// @arch open-source/docs/server-runtime.md
// @test src/__tests__/machine-version-gate.test.ts
// @test src/__tests__/machine-connection-rate-limit.test.ts
// @test src/__tests__/machine-ownership.test.ts
import WebSocket, { type RawData } from 'ws'
import type { FastifyRequest } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { verifyToken, verifyMachineToken } from '../services/jwt.js'
import {
  setMachineOnline,
  setMachineOffline,
  setMachineAgentList,
  setMachineAgents,
  setMachineAutoUpgrade,
  setMachineRemoteAccessDisabled,
} from '../services/machine-status.js'
import { connections } from './connections.js'
import { pubsub } from './pubsub.js'
import { publishMachineAccessPaused } from './connection-control.js'
import { routeVoiceChiefAgentEvent } from '../services/voice-chief-runtime.js'
import { SESSION_SYNC_DATA_EPOCH, type Frame, type SessionIndexUpdate } from '@shennian/wire'
import {
  updateSessionActivityFromAgentEvent,
  clearActivitiesForMachine,
} from '../services/session-activity.js'
import { writeLog } from '../services/log.js'
import { isDiagnosticUserId } from '../services/log-policy.js'
import { randomBytes } from 'crypto'
import { applySessionIndexUpdate } from '../services/session-index-sync.js'
import { acceptServerRequestRelay, resolveServerRequest } from './server-requests.js'
import {
  finalizeMachineOwnershipClose,
  machineOwnership,
  shouldCloseForMachineReplacement,
  type MachineReplacementEvent,
} from './machine-ownership.js'
import {
  isReviewAccountUserId,
  REVIEW_ACCOUNT_MACHINE_ACCESS_ERROR,
} from '../services/review-account-policy.js'
import { personalHistoryRelay } from './personal-history-relay.js'
import { sensitivePersonalRelay } from './sensitive-personal-relay.js'
import { checkDaemonSessionSyncHandshake } from './session-sync-gate.js'
import {
  recordPersonalSyncOperation,
  recordPersonalSyncRejection,
} from '../services/personal-sync-operations.js'
import {
  normalizeSessionSyncRejection,
  SessionSyncRejectionError,
} from '../services/session-sync-rejection.js'
import { projectFsSensitiveRelay } from './project-fs-sensitive-relay.js'
import { MachineHeartbeat, MACHINE_PING_INTERVAL } from './machine-heartbeat.js'
import {
  createProjectFsNegotiation,
  isProjectFsSensitiveAuthorityConfigured,
  verifyProjectFsNegotiation,
  withNegotiatedProjectFsCapability,
  withoutProjectFsCapability,
} from './project-fs-negotiation.js'
import {
  PERSONAL_EVENT_METHODS,
  RELAY_EVENT_TRACE_ENABLED,
  createWsTrafficStats,
  maybeLogTrafficSummary,
  rawDataBytes,
  recordWsIn,
  rejectBlockedMachineVersion,
  rejectMachineConnectionRateLimit,
  sendMachineRejection,
  sendMachineRes,
  sendTracked,
  tryParseEventFrame,
} from './handler-base.js'
import {
  enqueueActivityUpdate,
  handleMachineServerReq,
  handleSessionUpdateEvent,
  tryParseReqFrame,
} from './handler-authorization.js'

export async function handleMachineConnection(
  socket: WebSocket,
  request: FastifyRequest,
): Promise<void> {
  const url = new URL(request.url, 'http://localhost')
  const token = url.searchParams.get('token')
  const cliVersion = url.searchParams.get('v')
  if (!token) {
    socket.close(4001, 'Missing token')
    return
  }

  let machineId: string
  let ownerId: string | undefined
  let authorizedDaemonInstallationId: string | null = null
  let authorizedMachineToken: string | null = null

  const machinePayload = verifyMachineToken(token)
  if (machinePayload) {
    machineId = machinePayload.machineId
    if (rejectMachineConnectionRateLimit(socket, request, machineId, cliVersion)) return

    const machine = await prisma.machine.findUnique({
      where: { id: machineId, paired: true },
      select: { id: true, userId: true, machineToken: true, daemonInstallationId: true },
    })
    if (!machine) {
      socket.close(4003, 'Machine not found or not paired')
      return
    }
    if (machine.machineToken !== token) {
      socket.close(4403, 'token_revoked')
      return
    }
    ownerId = machine.userId ?? undefined
    authorizedDaemonInstallationId = machine.daemonInstallationId
    authorizedMachineToken = machine.machineToken
    if (await isReviewAccountUserId(ownerId)) {
      socket.close(4403, REVIEW_ACCOUNT_MACHINE_ACCESS_ERROR)
      return
    }
    if (rejectBlockedMachineVersion(socket, request, machineId, cliVersion)) return
  } else {
    const userPayload = verifyToken(token)
    if (!userPayload) {
      socket.close(4001, 'Invalid token')
      return
    }
    const machine = await prisma.machine.findFirst({
      where: { userId: userPayload.userId, paired: true },
    })
    if (!machine) {
      socket.close(4003, 'No paired machine found')
      return
    }
    machineId = machine.id
    ownerId = userPayload.userId
    authorizedDaemonInstallationId = machine.daemonInstallationId
    authorizedMachineToken = machine.machineToken
    if (await isReviewAccountUserId(ownerId)) {
      socket.close(4403, REVIEW_ACCOUNT_MACHINE_ACCESS_ERROR)
      return
    }
    if (rejectMachineConnectionRateLimit(socket, request, machineId, cliVersion)) return
    if (rejectBlockedMachineVersion(socket, request, machineId, cliVersion)) return
  }

  const syncDecision = checkDaemonSessionSyncHandshake(url)
  if (!syncDecision.allowed) {
    socket.close(4406, `${syncDecision.code}:${syncDecision.reason}`)
    return
  }
  if (authorizedDaemonInstallationId !== syncDecision.handshake.daemonInstallationId) {
    socket.close(4403, 'invalid_identity:daemon_installation_mismatch')
    return
  }
  const initialSyncCapabilities = withoutProjectFsCapability(syncDecision.handshake.capabilities)
  const serverRegion = process.env.SERVER_REGION || 'global'
  const agentsParam = url.searchParams.get('agents')
  const agentList = agentsParam ? agentsParam.split(',').filter(Boolean) : null
  const reportedUpgradePolicy = url.searchParams.get('upgradePolicy')
  const updaterProtocolRaw = url.searchParams.get('updaterProtocol')
  const updaterProtocolVersion =
    updaterProtocolRaw && /^\d+$/.test(updaterProtocolRaw) ? Number(updaterProtocolRaw) : undefined
  const autoUpgradePolicy =
    reportedUpgradePolicy === 'patch'
      ? 'patch'
      : reportedUpgradePolicy === 'none'
        ? 'none'
        : undefined
  const connectionId = machineOwnership.newConnectionId()
  let acquiredOwnership: Awaited<ReturnType<typeof machineOwnership.acquire>>
  try {
    acquiredOwnership = await machineOwnership.acquire(machineId, connectionId)
  } catch (error) {
    request.log.error({ machineId, error }, 'machine ownership acquire failed')
    socket.close(1013, 'Machine ownership unavailable')
    return
  }
  const ownership = acquiredOwnership.ownership
  connections.addMachine(machineId, socket, ownerId, serverRegion)
  let ownershipLost = false
  let unsubscribeMachineControl = () => {}
  try {
    if (machineOwnership.enabled) {
      unsubscribeMachineControl = await pubsub.subscribeMachineControl(machineId, (data) => {
        let event: Partial<MachineReplacementEvent>
        try {
          event = JSON.parse(data) as typeof event
        } catch {
          return
        }
        if (
          event.version === 1 &&
          event.type === 'machine.connection.replaced' &&
          typeof event.machineId === 'string' &&
          typeof event.connectionId === 'string' &&
          typeof event.generation === 'number' &&
          shouldCloseForMachineReplacement(ownership, event as MachineReplacementEvent)
        ) {
          ownershipLost = true
          socket.close(4410, 'ownership_replaced')
        }
      })
      // Close the subscribe-before-check race: if a newer owner published its
      // replacement event before this instance subscribed, the conditional
      // renew still detects that this generation is stale.
      const stillOwner = await machineOwnership.renew(ownership)
      if (!stillOwner || ownershipLost) {
        ownershipLost = true
        unsubscribeMachineControl()
        connections.removeMachine(machineId, socket)
        socket.close(4410, 'ownership_replaced')
        return
      }
    }
  } catch (error) {
    connections.removeMachine(machineId, socket)
    await machineOwnership.release(ownership).catch(() => {})
    request.log.error({ machineId, error }, 'machine ownership control subscribe failed')
    socket.close(1013, 'Machine ownership unavailable')
    return
  }
  if (machineOwnership.enabled && acquiredOwnership.previous) {
    try {
      pubsub.publishMachineControl(
        machineId,
        JSON.stringify({
          version: 1,
          type: 'machine.connection.replaced',
          machineId,
          connectionId: ownership.connectionId,
          generation: ownership.generation,
        }),
      )
    } catch (error) {
      unsubscribeMachineControl()
      connections.removeMachine(machineId, socket)
      await machineOwnership.release(ownership).catch(() => {})
      request.log.error({ machineId, error }, 'machine replacement publish failed')
      socket.close(1013, 'Machine ownership unavailable')
      return
    }
  }
  const trafficStats = createWsTrafficStats({
    connectionType: 'machine',
    machineId,
    userId: ownerId,
    ip: request.ip,
  })
  try {
    await setMachineOnline(machineId, serverRegion, cliVersion ?? undefined, autoUpgradePolicy, {
      protocolVersion: syncDecision.handshake.protocolVersion!,
      dataEpoch: SESSION_SYNC_DATA_EPOCH,
      capabilities: initialSyncCapabilities,
      daemonInstallationId: syncDecision.handshake.daemonInstallationId!,
      updaterProtocolVersion,
    })
  } catch (error) {
    unsubscribeMachineControl()
    connections.removeMachine(machineId, socket)
    await machineOwnership.release(ownership).catch(() => {})
    request.log.error({ machineId, error }, 'machine online transition failed')
    socket.close(1013, 'Machine state unavailable')
    return
  }

  if (isDiagnosticUserId(ownerId)) {
    request.log.info(
      {
        event: 'relay.machine-connected',
        userId: ownerId,
        machineId,
        cliVersion: cliVersion ?? undefined,
        region: serverRegion,
      },
      'diagnostic machine relay connected',
    )
  }

  void writeLog({
    traceId: randomBytes(8).toString('hex'),
    machineId,
    userId: ownerId ?? null,
    source: 'server',
    type: 'ws',
    level: 'info',
    wsEvent: 'machine.connect',
    wsDirection: 'in',
    metadata: {
      cliVersion: cliVersion ?? undefined,
      agentList,
      region: serverRegion,
      autoUpgradePolicy,
      sessionSyncProtocolVersion: syncDecision.handshake.protocolVersion,
      sessionSyncCapabilities: initialSyncCapabilities,
    },
  })
  if (agentList) {
    void setMachineAgentList(machineId, agentList)
  }

  // Server-side ping/pong to detect dead machine connections quickly.
  // Without this, a silently dropped connection (crash, network loss, sleep)
  // would only be detected after TCP timeout (1-2 min+).
  const machineHeartbeat = new MachineHeartbeat(socket)
  let machineCloseReason = 'close'
  const pingTimer = setInterval(() => {
    if (machineOwnership.enabled && !ownershipLost) {
      void machineOwnership
        .renew(ownership)
        .then((renewed) => {
          if (renewed || ownershipLost) return
          ownershipLost = true
          machineCloseReason = 'ownership_replaced'
          socket.close(4410, 'ownership_replaced')
        })
        .catch((error) => {
          if (ownershipLost) return
          ownershipLost = true
          machineCloseReason = 'ownership_unavailable'
          request.log.error({ machineId, error }, 'machine ownership renew failed')
          socket.close(1013, 'Machine ownership unavailable')
        })
    }
    const heartbeatResult = machineHeartbeat.tick()
    if (heartbeatResult !== 'pinged') {
      clearInterval(pingTimer)
      machineCloseReason = heartbeatResult
      socket.terminate()
      return
    }
  }, MACHINE_PING_INTERVAL)

  socket.on('ping', () => {
    machineHeartbeat.markAlive()
  })
  socket.on('pong', () => {
    machineHeartbeat.markAlive()
  })

  const unsubscribeRelay = pubsub.subscribeRelay(machineId, (data) => {
    if (socket.readyState === WebSocket.OPEN) {
      const frame = tryParseReqFrame(data)
      if (frame) {
        personalHistoryRelay.observeForwardedRequest(machineId, frame)
        sensitivePersonalRelay.observeForwardedRequest(machineId, frame)
        projectFsSensitiveRelay.observeForwardedRequest(machineId, frame)
      }
      sendTracked(socket, trafficStats, data)
    }
  })
  const unsubscribeServerRequests = pubsub.subscribeServerRequests(machineId, (data) => {
    if (socket.readyState === WebSocket.OPEN) {
      const forwardedData = acceptServerRequestRelay(data)
      if (forwardedData) sendTracked(socket, trafficStats, forwardedData)
    }
  })
  const projectFsNegotiation =
    authorizedMachineToken &&
    isProjectFsSensitiveAuthorityConfigured() &&
    syncDecision.handshake.daemonInstallationId
      ? createProjectFsNegotiation({
          machineId,
          daemonInstallationId: syncDecision.handshake.daemonInstallationId,
        })
      : null
  let projectFsNegotiated = false

  socket.on('message', (raw: RawData) => {
    machineHeartbeat.markAlive() // any data means connection is alive
    const rawBytes = rawDataBytes(raw)
    const data = typeof raw === 'string' ? raw : raw.toString()
    recordWsIn(trafficStats, data, rawBytes)

    if (projectFsNegotiation) {
      let response: Extract<Frame, { type: 'res' }> | null = null
      try {
        const parsed = JSON.parse(data) as Frame
        if (parsed?.type === 'res' && parsed.id === projectFsNegotiation.request.id) {
          response = parsed
        }
      } catch {
        // Invalid traffic follows the ordinary relay parser below.
      }
      if (response) {
        const verified =
          !projectFsNegotiated &&
          verifyProjectFsNegotiation({
            negotiation: projectFsNegotiation,
            response,
            machineId,
            daemonInstallationId: syncDecision.handshake.daemonInstallationId!,
            machineToken: authorizedMachineToken!,
          })
        if (verified && connections.getMachine(machineId) === socket) {
          projectFsNegotiated = true
          void setMachineOnline(
            machineId,
            serverRegion,
            cliVersion ?? undefined,
            autoUpgradePolicy,
            {
              protocolVersion: syncDecision.handshake.protocolVersion!,
              dataEpoch: SESSION_SYNC_DATA_EPOCH,
              capabilities: withNegotiatedProjectFsCapability(initialSyncCapabilities),
              daemonInstallationId: syncDecision.handshake.daemonInstallationId!,
              updaterProtocolVersion,
            },
          ).catch((error) => {
            projectFsNegotiated = false
            request.log.error({ machineId, error }, 'Project FS capability activation failed')
          })
        }
        return
      }
    }

    if (projectFsSensitiveRelay.routeMachineFrame(machineId, data)) return
    if (personalHistoryRelay.routeMachineFrame(machineId, data)) return
    if (sensitivePersonalRelay.routeMachineFrame(machineId, data)) return

    const reqFrame = tryParseReqFrame(data)
    if (reqFrame) {
      void (async () => {
        try {
          const handled = await handleMachineServerReq(socket, machineId, ownerId, reqFrame)
          if (!handled) pubsub.publishToClient(machineId, data)
        } catch (error) {
          const rejection = normalizeSessionSyncRejection(error)
          recordPersonalSyncRejection(rejection)
          sendMachineRes(socket, reqFrame.id, false, rejection.code, rejection)
        }
      })()
      return
    }

    const event = tryParseEventFrame(data)
    if (event?.event === 'machine.remote-access.paused') {
      if (!event.id) return
      void setMachineRemoteAccessDisabled(machineId)
        .then((remoteAccessDisabledAt) => {
          sendMachineRes(socket, event.id!, true, { remoteAccessDisabledAt })
          publishMachineAccessPaused(machineId)
        })
        .catch((error) => {
          sendMachineRes(
            socket,
            event.id!,
            false,
            error instanceof Error ? error.message : 'remote_access_pause_state_failed',
          )
        })
      return
    }
    if (event && !event.payload && PERSONAL_EVENT_METHODS.has(event.event)) {
      if (event.event.startsWith('session.index.')) recordPersonalSyncOperation('indexRejected')
      else recordPersonalSyncOperation('legacyFramesRejected')
      if (event.id && socket.readyState === WebSocket.OPEN) {
        sendMachineRejection(
          socket,
          event.id,
          new SessionSyncRejectionError('invalid_payload', {
            authoritativeEpoch: SESSION_SYNC_DATA_EPOCH,
          }),
        )
      }
      return
    }
    if (event?.payload) {
      if (event.event === 'session.update') {
        const legacySession = (event.payload as { session?: Record<string, unknown> }).session
        if (legacySession && Object.prototype.hasOwnProperty.call(legacySession, 'title')) {
          if (event.id && socket.readyState === WebSocket.OPEN) {
            sendMachineRejection(
              socket,
              event.id,
              new SessionSyncRejectionError('upgrade_required', {
                authoritativeEpoch: SESSION_SYNC_DATA_EPOCH,
              }),
            )
          }
          return
        }
        void handleSessionUpdateEvent(machineId, event.payload)
      } else if (event.event === 'machine.agents') {
        const payload = event.payload as { agents?: unknown[]; agentList?: string[] } | undefined
        if (Array.isArray(payload?.agents)) {
          void setMachineAgents(machineId, payload.agents).catch(() => {
            // A stale runtime proof must not outlive an unpersisted capability
            // change. Disconnecting also stops the daemon's public worker.
            socket.close(1011, 'machine capability update failed')
          })
        } else if (Array.isArray(payload?.agentList)) {
          void setMachineAgentList(machineId, payload.agentList).catch(() => {
            socket.close(1011, 'machine capability update failed')
          })
        }
      } else if (event.event === 'machine.upgrade-policy') {
        const policy = (event.payload as { policy?: unknown } | undefined)?.policy
        if (policy === 'none' || policy === 'patch') {
          void setMachineAutoUpgrade(machineId, policy)
        }
      } else if (event.event === 'agent') {
        const agentPayload = event.payload as Record<string, unknown>
        const state = agentPayload.state as string | undefined
        const agentSessionId = agentPayload.sessionId as string | undefined
        const agentRunId = agentPayload.runId as string | undefined
        if (RELAY_EVENT_TRACE_ENABLED && isDiagnosticUserId(ownerId) && state !== 'delta') {
          console.log(
            `[relay:agent] machineId=${machineId} sessionId=${agentSessionId} runId=${agentRunId} state=${state}`,
          )
        }
        if (agentSessionId) {
          enqueueActivityUpdate(
            agentSessionId,
            () => updateSessionActivityFromAgentEvent(agentPayload),
            (activity) => {
              if (activity === undefined) return
              if (RELAY_EVENT_TRACE_ENABLED && isDiagnosticUserId(ownerId)) {
                const phase = activity ? `${activity.runPhase}(${activity.runId})` : 'null'
                console.log(`[relay:activity] sessionId=${agentSessionId} broadcast=${phase}`)
                void writeLog({
                  traceId: randomBytes(8).toString('hex'),
                  machineId,
                  userId: ownerId ?? null,
                  sessionId: agentSessionId,
                  source: 'server',
                  type: 'ws',
                  level: 'info',
                  wsEvent: 'session.activity',
                  wsDirection: 'out',
                  metadata: { state, runId: agentRunId, activity },
                })
              }
              const activityEvent = JSON.stringify({
                type: 'event',
                event: 'session.activity',
                payload: { sessionId: agentSessionId, activity },
              })
              pubsub.publishToClient(machineId, activityEvent)
            },
          )
        }
        routeVoiceChiefAgentEvent(agentPayload)
        // Ack buffered agent events so CLI can remove from send buffer
        if (event.id && socket.readyState === WebSocket.OPEN) {
          sendTracked(socket, trafficStats, JSON.stringify({ type: 'res', id: event.id, ok: true }))
        }
      } else if (event.event === 'session.index.updated') {
        if (!ownerId) {
          recordPersonalSyncOperation('indexRejected')
          if (event.id && socket.readyState === WebSocket.OPEN) {
            sendMachineRejection(
              socket,
              event.id,
              new SessionSyncRejectionError('ownership_transferred', {
                authoritativeEpoch: SESSION_SYNC_DATA_EPOCH,
              }),
            )
          }
        } else {
          void applySessionIndexUpdate(
            machineId,
            ownerId,
            event.payload as unknown as SessionIndexUpdate,
          )
            .then((result) => {
              recordPersonalSyncOperation(result.applied ? 'indexApplied' : 'indexDuplicate')
              if (result.applied && result.sessionPatch) {
                // The list index belongs to the account, not to one machine
                // subscription. Publishing on the user channel makes a newly
                // created session and every later projection change visible to
                // all active phone clients, including a client currently
                // staying on the project list.
                const sessionUpdate = JSON.stringify({
                  type: 'event',
                  event: 'session.update',
                  payload: { machineId, session: result.sessionPatch },
                })
                pubsub.publishToUser(ownerId, sessionUpdate)
                // Keep released clients compatible while the account-scoped
                // stream rolls out. Current clients may receive both frames;
                // indexRevision makes the second application a no-op.
                pubsub.publishToClient(machineId, sessionUpdate)
              }
              if (event.id && socket.readyState === WebSocket.OPEN) {
                sendMachineRes(socket, event.id, true, {
                  sessionId: result.sessionId,
                  indexRevision: result.indexRevision,
                  applied: result.applied,
                  dataEpoch: SESSION_SYNC_DATA_EPOCH,
                  daemonInstallationId: syncDecision.handshake.daemonInstallationId!,
                })
              }
            })
            .catch((error) => {
              recordPersonalSyncOperation('indexRejected')
              if (event.id && socket.readyState === WebSocket.OPEN) {
                const rejection = normalizeSessionSyncRejection(error)
                recordPersonalSyncRejection(rejection)
                sendMachineRes(socket, event.id, false, rejection.code, rejection)
              }
            })
        }
      } else if (event.event === 'session.message') {
        recordPersonalSyncOperation('legacyFramesRejected')
        if (event.id && socket.readyState === WebSocket.OPEN) {
          sendMachineRejection(
            socket,
            event.id,
            new SessionSyncRejectionError('upgrade_required', {
              authoritativeEpoch: SESSION_SYNC_DATA_EPOCH,
            }),
          )
        }
      } else if (event.event === 'upgrade') {
        const upgradePayload = { ...(event.payload as Record<string, unknown>), machineId }
        const enriched = JSON.stringify({
          type: 'event',
          event: 'upgrade',
          payload: upgradePayload,
        })
        pubsub.publishToClient(machineId, enriched)
      } else if (event.event === 'native.session.events') {
        recordPersonalSyncOperation('legacyFramesRejected')
        if (event.id && socket.readyState === WebSocket.OPEN) {
          sendMachineRejection(
            socket,
            event.id,
            new SessionSyncRejectionError('upgrade_required', {
              authoritativeEpoch: SESSION_SYNC_DATA_EPOCH,
            }),
          )
        }
      }
    }

    // Personal body and native import legacy events are terminally rejected above.
    // Index/activity frames follow their dedicated paths; all other frames remain
    // transparent relay traffic.
    if (
      !event ||
      (event.event !== 'agent' &&
        event.event !== 'native.session.events' &&
        event.event !== 'session.index.updated' &&
        event.event !== 'session.message')
    ) {
      // Log res frames forwarded to client for debugging timing issues
      try {
        const parsed = JSON.parse(data) as { type?: string; id?: string; ok?: boolean }
        if (parsed?.type === 'res') {
          if (RELAY_EVENT_TRACE_ENABLED && isDiagnosticUserId(ownerId)) {
            console.log(`[relay:res] machineId=${machineId} reqId=${parsed.id} ok=${parsed.ok}`)
          }
          if (parsed.id && resolveServerRequest(parsed as Extract<Frame, { type: 'res' }>)) {
            return
          }
        }
      } catch {
        /* not JSON */
      }
      pubsub.publishToClient(machineId, data)
    }
  })

  if (projectFsNegotiation && socket.readyState === WebSocket.OPEN) {
    sendTracked(socket, trafficStats, JSON.stringify(projectFsNegotiation.request))
  }

  socket.on('close', () => {
    clearInterval(pingTimer)
    unsubscribeRelay()
    unsubscribeServerRequests()
    unsubscribeMachineControl()
    const removedCurrentMachine = connections.removeMachine(machineId, socket)
    void finalizeMachineOwnershipClose(machineOwnership, ownership, removedCurrentMachine, () =>
      setMachineOffline(machineId).then(() => {
        // V2: clear activities only after this connection has atomically
        // released the global ownership lease. An old socket must not clear
        // state belonging to its replacement on another Server.
        return clearActivitiesForMachine(machineId).then((sessionIds) => {
          for (const sid of sessionIds) {
            const activityEvent = JSON.stringify({
              type: 'event',
              event: 'session.activity',
              payload: { sessionId: sid, activity: null },
            })
            pubsub.publishToClient(machineId, activityEvent)
          }
        })
      }),
    ).catch((error) => {
      request.log.error({ machineId, error }, 'machine ownership release failed')
    })

    if (isDiagnosticUserId(ownerId)) {
      request.log.info(
        {
          event: 'relay.machine-disconnected',
          userId: ownerId,
          machineId,
          reason: machineCloseReason,
          ageMs: Date.now() - trafficStats.openedAt,
        },
        'diagnostic machine relay disconnected',
      )
    }

    void writeLog({
      traceId: randomBytes(8).toString('hex'),
      machineId,
      userId: ownerId ?? null,
      source: 'server',
      type: 'ws',
      level: 'info',
      wsEvent: 'machine.disconnect',
      wsDirection: 'in',
    })
    maybeLogTrafficSummary(trafficStats, machineCloseReason, true)
  })
}
