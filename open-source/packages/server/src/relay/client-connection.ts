// @arch open-source/docs/server-runtime.md

// @arch open-source/docs/server-runtime.md
// @test src/__tests__/machine-version-gate.test.ts
// @test src/__tests__/machine-connection-rate-limit.test.ts
// @test src/__tests__/machine-ownership.test.ts
import WebSocket, { type RawData } from 'ws'
import { capturePreAuthMessages } from './pre-auth-messages.js'
import type { FastifyRequest } from 'fastify'
import { connections } from './connections.js'
import { pubsub } from './pubsub.js'
import { isProjectFsMethod } from '@shennian/wire'
import { writeLog } from '../services/log.js'
import { randomBytes } from 'crypto'
import { getPlanAccess } from '../services/plan-access.js'
import {
  isReviewAccountUserId,
  REVIEW_ACCOUNT_MACHINE_ACCESS_ERROR,
} from '../services/review-account-policy.js'
import { personalHistoryRelay } from './personal-history-relay.js'
import { sensitivePersonalRelay } from './sensitive-personal-relay.js'
import { checkAppSessionSyncHandshake } from './session-sync-gate.js'
import { clientConnectionLeases } from './client-connection-leases.js'
import { projectFsSensitiveRelay } from './project-fs-sensitive-relay.js'
import {
  createWsTrafficStats,
  maybeLogTrafficSummary,
  prepareProjectFsRequest,
  rawDataBytes,
  recordWsIn,
  rejectIfMachineOffline,
  sendTracked,
  startClientLeaseRenewal,
} from './handler-base.js'
import {
  authenticateClient,
  authorizeMachineOwnerRequest,
  authorizeMachineUseRequest,
  authorizePersonalBodyReplicaRequest,
  authorizePersonalHistoryRequest,
  authorizePersonalIdentityRequest,
  authorizeRemoteAccessPauseRequest,
  authorizeSensitivePersonalRequest,
  ensureMachineAccess,
  rememberPendingRequest,
  sendSubscriptionCloses,
  shouldDeliverSharedMachineFrame,
  tryParseReqFrame,
} from './handler-authorization.js'

export async function handleClientConnection(
  socket: WebSocket,
  request: FastifyRequest<{ Params: { machineId: string } }>,
): Promise<void> {
  const messages = capturePreAuthMessages(socket)
  const auth = await authenticateClient(socket, request)
  if (!auth) return
  if (await isReviewAccountUserId(auth.userId)) {
    socket.close(4403, REVIEW_ACCOUNT_MACHINE_ACCESS_ERROR)
    return
  }
  const syncDecision = checkAppSessionSyncHandshake(
    new URL(request.url, 'http://localhost'),
    auth.platform,
  )
  if (!syncDecision.allowed) {
    socket.close(4406, `${syncDecision.code}:${syncDecision.reason}`)
    return
  }
  if (!(await getPlanAccess(auth.userId)).allowed) {
    socket.close(4402, 'Pro subscription required')
    return
  }
  const machineId = request.params.machineId

  const access = await ensureMachineAccess(machineId, auth.userId)
  if (access === 'not-found') {
    socket.close(4004, 'Machine not found')
    return
  }
  if (!access) {
    socket.close(4003, 'No access to this machine')
    return
  }

  const clientLease = await clientConnectionLeases.acquire(machineId)
  if (!clientLease) {
    socket.close(4008, 'Too many clients for machine')
    return
  }
  const accepted = connections.addClient(
    machineId,
    socket,
    auth.userId,
    auth.deviceId,
    auth.platform,
  )
  if (!accepted || socket.readyState !== WebSocket.OPEN) {
    await clientLease.release()
    if (!accepted && socket.readyState === WebSocket.OPEN) {
      socket.close(4008, 'Too many clients for machine')
    }
    return
  }
  const revokeAccess = () => socket.close(4411, 'Machine access revoked')
  const unregisterAccessRevoker = connections.registerMachineAccessRevoker(
    machineId,
    auth.userId,
    revokeAccess,
  )
  const expiryTimer = access.expiresAt
    ? setTimeout(revokeAccess, Math.max(0, access.expiresAt.getTime() - Date.now()))
    : null
  const leaseRenewal = startClientLeaseRenewal(socket, clientLease)
  const trafficStats = createWsTrafficStats({
    connectionType: 'client',
    machineId,
    userId: auth.userId,
    ip: request.ip,
  })
  const pendingRequestIds = new Set<string>()

  void writeLog({
    traceId: randomBytes(8).toString('hex'),
    machineId,
    userId: auth.userId,
    source: 'server',
    type: 'ws',
    level: 'info',
    wsEvent: 'client.connect',
    wsDirection: 'in',
    metadata: { deviceId: auth.deviceId, platform: auth.platform },
  })

  const unsubPubsub = pubsub.subscribeClient(machineId, (data) => {
    if (socket.readyState !== WebSocket.OPEN) return
    void shouldDeliverSharedMachineFrame(data, machineId, auth.userId, pendingRequestIds).then(
      (allowed) => {
        if (allowed && socket.readyState === WebSocket.OPEN) sendTracked(socket, trafficStats, data)
      },
    )
  })
  const unsubUserPubsub = pubsub.subscribeUser(auth.userId, (data) => {
    if (socket.readyState === WebSocket.OPEN) {
      sendTracked(socket, trafficStats, data)
    }
  })

  messages.activate((raw: RawData) => {
    const rawBytes = rawDataBytes(raw)
    const data = typeof raw === 'string' ? raw : raw.toString()
    recordWsIn(trafficStats, data, rawBytes)

    void (async () => {
      let frame = tryParseReqFrame(data)

      if (frame) {
        frame = await prepareProjectFsRequest(socket, 'legacy', machineId, auth.userId, frame)
        if (!frame) return
      }

      if (
        frame &&
        !isProjectFsMethod(frame.method) &&
        !(await authorizeMachineUseRequest(socket, 'legacy', machineId, auth.userId, frame))
      )
        return
      if (
        frame &&
        !(await authorizeMachineOwnerRequest(socket, 'legacy', machineId, auth.userId, frame))
      )
        return
      if (
        frame &&
        !(await authorizePersonalHistoryRequest(
          socket,
          'legacy',
          machineId,
          auth.userId,
          auth.installationId,
          frame,
        ))
      )
        return
      if (
        frame &&
        !(await authorizePersonalBodyReplicaRequest(
          socket,
          'legacy',
          machineId,
          auth.userId,
          auth.installationId,
          frame,
        ))
      )
        return
      if (
        frame &&
        !(await authorizePersonalIdentityRequest(socket, 'legacy', machineId, auth.userId, frame))
      )
        return
      if (
        frame &&
        !(await authorizeSensitivePersonalRequest(socket, 'legacy', machineId, auth.userId, frame))
      )
        return
      if (
        frame &&
        !(await authorizeRemoteAccessPauseRequest(socket, 'legacy', machineId, auth.userId, frame))
      )
        return
      if (frame) {
        personalHistoryRelay.observeForwardedRequest(machineId, frame)
        sensitivePersonalRelay.observeForwardedRequest(machineId, frame)
        projectFsSensitiveRelay.observeForwardedRequest(machineId, frame)
        if (!isProjectFsMethod(frame.method)) rememberPendingRequest(pendingRequestIds, frame.id)
      }

      const forwardData = frame ? JSON.stringify(frame) : data
      const sent = connections.sendToMachine(machineId, forwardData)
      if (!sent) {
        pubsub.publishToRelay(machineId, forwardData)
        const machineWs = connections.getMachine(machineId)
        if (!machineWs && !pubsub.isActive) {
          // Single-server mode: machine is definitely offline — reject immediately
          rejectIfMachineOffline(data, socket)
        }
        // Multi-server: machine might be on another node — publishToRelay handles it
      }
    })()
  })

  socket.on('close', () => {
    unregisterAccessRevoker()
    if (expiryTimer) clearTimeout(expiryTimer)
    clearInterval(leaseRenewal)
    void clientLease.release()
    sendSubscriptionCloses(socket)
    connections.removeClient(machineId, socket)
    unsubPubsub()
    unsubUserPubsub()

    void writeLog({
      traceId: randomBytes(8).toString('hex'),
      machineId,
      userId: auth.userId,
      source: 'server',
      type: 'ws',
      level: 'info',
      wsEvent: 'client.disconnect',
      wsDirection: 'in',
    })
    const remaining = connections.getClients(machineId)
    if (!remaining || remaining.size === 0) {
      pubsub.unsubscribeClient(machineId)
    }
    maybeLogTrafficSummary(trafficStats, 'close', true)
  })
}
