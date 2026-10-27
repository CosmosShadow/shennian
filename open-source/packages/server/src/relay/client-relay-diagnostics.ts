// @arch open-source/docs/server-runtime.md
// @test src/__tests__/client-relay-diagnostics.test.ts

import { createHash, randomBytes } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import type WebSocket from 'ws'
import { classifyRelayClose } from '@shennian/wire'
import { verifyToken } from '../services/jwt.js'
import { writeLog } from '../services/log.js'
import { parseSessionSyncHandshake } from './session-sync-gate.js'

type RelayClientMode = 'legacy' | 'multiplex'

function safeConnectionId(value: string | null): string | null {
  return value && /^[a-zA-Z0-9_-]{1,96}$/.test(value) ? value : null
}

function anonymousDeviceId(value: string | undefined): string | null {
  if (!value) return null
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

export function buildClientRelayDiagnostic(
  requestUrl: string,
  mode: RelayClientMode,
): {
  traceId: string
  userId: string | null
  metadata: Record<string, unknown>
} {
  const url = new URL(requestUrl, 'http://localhost')
  const payload = verifyToken(url.searchParams.get('token') ?? '')
  const handshake = parseSessionSyncHandshake(url)
  const connectionId = safeConnectionId(url.searchParams.get('connectionId'))
  return {
    traceId: connectionId ?? randomBytes(8).toString('hex'),
    userId: payload?.userId ?? null,
    metadata: {
      connectionId,
      deviceHash: anonymousDeviceId(payload?.deviceId),
      mode,
      platform: url.searchParams.get('platform')?.slice(0, 24) || null,
      deliveryVersion: url.searchParams.get('deliveryVersion')?.slice(0, 32) || null,
      desktopVersion: handshake.desktopVersion,
      appBuild: handshake.appBuild,
      syncProtocol: handshake.protocolVersion,
      dataEpoch: handshake.dataEpoch,
      syncCapabilities: handshake.capabilities,
      serverInstance: process.env.HOSTNAME ?? null,
    },
  }
}

export function observeClientRelayLifecycle(
  socket: WebSocket,
  request: FastifyRequest,
  mode: RelayClientMode,
): void {
  const diagnostic = buildClientRelayDiagnostic(request.url, mode)
  const openedAt = Date.now()
  socket.once('close', (code: number, reasonBuffer: Buffer) => {
    const closeReason = reasonBuffer.toString('utf8').slice(0, 160) || null
    const classification = classifyRelayClose(code, closeReason ?? '')
    const metadata = {
      ...diagnostic.metadata,
      closeCode: code,
      closeReason,
      durationMs: Date.now() - openedAt,
      reason: classification.reason,
      retryable: classification.retryable,
    }
    const level = code === 1000 ? 'info' : 'warn'
    request.log[level]({ event: 'relay.client-closed', ...metadata }, 'client relay closed')
    void writeLog({
      traceId: diagnostic.traceId,
      userId: diagnostic.userId,
      source: 'server',
      type: 'ws',
      level,
      wsEvent: 'client.disconnect',
      wsDirection: 'in',
      durationMs: metadata.durationMs,
      metadata,
    })
  })
}
