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
import { type RoutedFrame, isProjectFsMethod } from '@shennian/wire'
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
import { clientConnectionLeases, type ClientConnectionLease } from './client-connection-leases.js'
import { projectFsSensitiveRelay } from './project-fs-sensitive-relay.js'
import {
  buildRoutedData,
  createWsTrafficStats,
  maybeLogTrafficSummary,
  prepareProjectFsRequest,
  rawDataBytes,
  recordWsIn,
  rejectRoutedIfMachineOffline,
  sendTracked,
  startClientLeaseRenewal,
  tryParseRoutedFrame,
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
} from './handler-authorization.js'

export async function handleMultiplexClientConnection(
  socket: WebSocket,
  request: FastifyRequest,
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

  if (socket.readyState !== WebSocket.OPEN) return

  const subscriptions = new Map<
    string,
    {
      unsubscribe: () => void
      lease: ClientConnectionLease
      renewal: NodeJS.Timeout
      unregisterRevoker: () => void
      expiryTimer: NodeJS.Timeout | null
      pendingRequestIds: Set<string>
    }
  >()
  const subscriptionAttempts = new Map<string, { promise: Promise<boolean>; cancelled: boolean }>()
  const trafficStats = createWsTrafficStats({
    connectionType: 'multiplex-client',
    userId: auth.userId,
    ip: request.ip,
  })

  const subscribeMachine = async (machineId: string): Promise<boolean> => {
    if (subscriptions.has(machineId)) return true

    const existingAttempt = subscriptionAttempts.get(machineId)
    if (existingAttempt) return existingAttempt.promise

    const attemptState: { promise: Promise<boolean>; cancelled: boolean } = {
      promise: Promise.resolve(false),
      cancelled: false,
    }
    const attempt = (async (): Promise<boolean> => {
      const access = await ensureMachineAccess(machineId, auth.userId)
      if (!access || access === 'not-found') {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(
            JSON.stringify({
              type: 'relay',
              machineId,
              frame: {
                type: 'event',
                event: 'relay.error',
                payload: {
                  code: access === 'not-found' ? 'machine_not_found' : 'forbidden',
                },
              },
            }),
          )
        }
        return false
      }

      const lease = await clientConnectionLeases.acquire(machineId)
      if (!lease) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.close(4008, 'Too many clients for machine')
        }
        return false
      }

      if (socket.readyState !== WebSocket.OPEN) {
        await lease.release()
        return false
      }
      if (attemptState.cancelled) {
        await lease.release()
        return false
      }

      const accepted = connections.addClient(
        machineId,
        socket,
        auth.userId,
        auth.deviceId,
        auth.platform,
        'multiplex',
      )
      if (!accepted) {
        await lease.release()
        if (socket.readyState === WebSocket.OPEN) {
          socket.close(4008, 'Too many clients for machine')
        }
        return false
      }

      const renewal = startClientLeaseRenewal(socket, lease)

      const pendingRequestIds = new Set<string>()
      const unsubClient = pubsub.subscribeClient(machineId, (data) => {
        if (socket.readyState !== WebSocket.OPEN) return
        void shouldDeliverSharedMachineFrame(data, machineId, auth.userId, pendingRequestIds).then(
          (allowed) => {
            if (allowed && socket.readyState === WebSocket.OPEN) {
              sendTracked(socket, trafficStats, buildRoutedData(machineId, data))
            }
          },
        )
      })
      const revokeAccess = () => {
        unsubscribeMachine(machineId)
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(
            JSON.stringify({
              type: 'relay',
              machineId,
              frame: { type: 'event', event: 'relay.error', payload: { code: 'access_revoked' } },
            }),
          )
        }
      }
      const unregisterRevoker = connections.registerMachineAccessRevoker(
        machineId,
        auth.userId,
        revokeAccess,
      )
      const expiryTimer = access.expiresAt
        ? setTimeout(revokeAccess, Math.max(0, access.expiresAt.getTime() - Date.now()))
        : null
      subscriptions.set(machineId, {
        unsubscribe: unsubClient,
        lease,
        renewal,
        unregisterRevoker,
        expiryTimer,
        pendingRequestIds,
      })

      void writeLog({
        traceId: randomBytes(8).toString('hex'),
        machineId,
        userId: auth.userId,
        source: 'server',
        type: 'ws',
        level: 'info',
        wsEvent: 'client.subscribe',
        wsDirection: 'in',
        metadata: { deviceId: auth.deviceId, platform: auth.platform },
      })

      return true
    })().finally(() => {
      subscriptionAttempts.delete(machineId)
    })

    attemptState.promise = attempt
    subscriptionAttempts.set(machineId, attemptState)
    return attempt
  }

  const unsubscribeMachine = (machineId: string): void => {
    const pending = subscriptionAttempts.get(machineId)
    if (pending) pending.cancelled = true
    const subscription = subscriptions.get(machineId)
    if (!subscription) return
    subscriptions.delete(machineId)
    subscription.unregisterRevoker()
    if (subscription.expiryTimer) clearTimeout(subscription.expiryTimer)
    clearInterval(subscription.renewal)
    void subscription.lease.release()
    connections.removeClient(machineId, socket)
    subscription.unsubscribe()
    const remaining = connections.getClients(machineId)
    if (!remaining || remaining.size === 0) {
      pubsub.unsubscribeClient(machineId)
    }
  }

  const unsubUserPubsub = pubsub.subscribeUser(auth.userId, (data) => {
    if (socket.readyState === WebSocket.OPEN) {
      sendTracked(socket, trafficStats, data)
    }
  })

  // A WebSocket upgrade opens before this async authority setup completes.
  // Confirm the authenticated multiplex runtime so clients do not treat a
  // later gate rejection as a successful connection and start reconciliation.
  if (socket.readyState === WebSocket.OPEN) {
    sendTracked(
      socket,
      trafficStats,
      JSON.stringify({
        type: 'event',
        event: 'tick',
        payload: { ts: Date.now() },
      }),
    )
  }

  void writeLog({
    traceId: randomBytes(8).toString('hex'),
    userId: auth.userId,
    source: 'server',
    type: 'ws',
    level: 'info',
    wsEvent: 'client.connect',
    wsDirection: 'in',
    metadata: { deviceId: auth.deviceId, platform: auth.platform, mode: 'multiplex' },
  })

  messages.activate((raw: RawData) => {
    const rawBytes = rawDataBytes(raw)
    const data = typeof raw === 'string' ? raw : raw.toString()
    recordWsIn(trafficStats, data, rawBytes)
    const routed = tryParseRoutedFrame(data)
    if (!routed) return

    if (routed.type === 'relay.subscribe') {
      void subscribeMachine(routed.machineId)
      return
    }

    if (routed.type === 'relay.unsubscribe') {
      unsubscribeMachine(routed.machineId)
      return
    }

    const routedFrame = routed as RoutedFrame
    const machineId = routedFrame.machineId
    void subscribeMachine(machineId).then(async (ok) => {
      if (!ok) return

      let checkedFrame = routedFrame.frame
      if (checkedFrame.type === 'req') {
        const prepared = await prepareProjectFsRequest(
          socket,
          'multiplex',
          machineId,
          auth.userId,
          checkedFrame,
        )
        if (!prepared) return
        checkedFrame = prepared
      }

      if (
        checkedFrame.type === 'req' &&
        !isProjectFsMethod(checkedFrame.method) &&
        !(await authorizeMachineUseRequest(
          socket,
          'multiplex',
          machineId,
          auth.userId,
          checkedFrame,
        ))
      )
        return
      if (
        checkedFrame.type === 'req' &&
        !(await authorizeMachineOwnerRequest(
          socket,
          'multiplex',
          machineId,
          auth.userId,
          checkedFrame,
        ))
      )
        return
      if (
        checkedFrame.type === 'req' &&
        !(await authorizePersonalHistoryRequest(
          socket,
          'multiplex',
          machineId,
          auth.userId,
          auth.installationId,
          checkedFrame,
        ))
      )
        return
      if (
        checkedFrame.type === 'req' &&
        !(await authorizePersonalBodyReplicaRequest(
          socket,
          'multiplex',
          machineId,
          auth.userId,
          auth.installationId,
          checkedFrame,
        ))
      )
        return
      if (
        checkedFrame.type === 'req' &&
        !(await authorizePersonalIdentityRequest(
          socket,
          'multiplex',
          machineId,
          auth.userId,
          checkedFrame,
        ))
      )
        return
      if (
        checkedFrame.type === 'req' &&
        !(await authorizeSensitivePersonalRequest(
          socket,
          'multiplex',
          machineId,
          auth.userId,
          checkedFrame,
        ))
      )
        return
      if (
        checkedFrame.type === 'req' &&
        !(await authorizeRemoteAccessPauseRequest(
          socket,
          'multiplex',
          machineId,
          auth.userId,
          checkedFrame,
        ))
      )
        return
      if (checkedFrame.type === 'req') {
        personalHistoryRelay.observeForwardedRequest(machineId, checkedFrame)
        sensitivePersonalRelay.observeForwardedRequest(machineId, checkedFrame)
        projectFsSensitiveRelay.observeForwardedRequest(machineId, checkedFrame)
        if (!isProjectFsMethod(checkedFrame.method)) {
          rememberPendingRequest(subscriptions.get(machineId)!.pendingRequestIds, checkedFrame.id)
        }
      }

      const checkedFrameData = JSON.stringify(checkedFrame)
      const sent = connections.sendToMachine(machineId, checkedFrameData)
      if (!sent) {
        pubsub.publishToRelay(machineId, checkedFrameData)
        const machineWs = connections.getMachine(machineId)
        if (!machineWs && !pubsub.isActive) {
          rejectRoutedIfMachineOffline(machineId, checkedFrame, socket)
        }
      }
    })
  })

  socket.on('close', () => {
    sendSubscriptionCloses(socket)
    for (const machineId of [...subscriptions.keys()]) {
      unsubscribeMachine(machineId)
    }
    unsubUserPubsub()
    maybeLogTrafficSummary(trafficStats, 'close', true)

    void writeLog({
      traceId: randomBytes(8).toString('hex'),
      userId: auth.userId,
      source: 'server',
      type: 'ws',
      level: 'info',
      wsEvent: 'client.disconnect',
      wsDirection: 'in',
      metadata: { mode: 'multiplex' },
    })
  })
}
