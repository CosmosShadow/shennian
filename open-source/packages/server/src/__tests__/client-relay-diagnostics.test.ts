// @arch open-source/docs/server-runtime.md
// @covers src/relay/client-relay-diagnostics.ts

import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyRequest } from 'fastify'
import type WebSocket from 'ws'

const { mockWriteLog } = vi.hoisted(() => ({ mockWriteLog: vi.fn() }))
vi.mock('../services/log.js', () => ({ writeLog: mockWriteLog }))

import { signToken } from '../services/jwt.js'
import {
  buildClientRelayDiagnostic,
  observeClientRelayLifecycle,
} from '../relay/client-relay-diagnostics.js'

describe('client relay diagnostics', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps compatibility metadata and anonymizes the device without retaining the token', () => {
    const token = signToken({ userId: 'user-1', deviceId: 'device-secret-1' })
    const diagnostic = buildClientRelayDiagnostic(
      `/relay/client?token=${encodeURIComponent(token)}&connectionId=relay_123&platform=desktop&deliveryVersion=0.4.10&desktopVersion=0.4.0&syncProtocol=2&dataEpoch=2&syncCapabilities=local_canonical_v1&appBuild=0`,
      'multiplex',
    )

    expect(diagnostic.traceId).toBe('relay_123')
    expect(diagnostic.userId).toBe('user-1')
    expect(diagnostic.metadata).toMatchObject({
      connectionId: 'relay_123',
      mode: 'multiplex',
      platform: 'desktop',
      deliveryVersion: '0.4.10',
      desktopVersion: '0.4.0',
      appBuild: 0,
      syncProtocol: 2,
      dataEpoch: 2,
    })
    expect(diagnostic.metadata.deviceHash).toMatch(/^[a-f0-9]{16}$/)
    expect(JSON.stringify(diagnostic)).not.toContain(token)
    expect(JSON.stringify(diagnostic)).not.toContain('device-secret-1')
  })

  it('rejects an attacker-controlled correlation id', () => {
    const diagnostic = buildClientRelayDiagnostic(
      '/relay/client?connectionId=bad%20value&syncProtocol=2&dataEpoch=2&appBuild=53',
      'multiplex',
    )
    expect(diagnostic.metadata.connectionId).toBeNull()
    expect(diagnostic.traceId).toMatch(/^[a-f0-9]{16}$/)
  })

  it('records a closed lifecycle with retry semantics and no credential material', async () => {
    const token = signToken({ userId: 'user-1', deviceId: 'device-secret-1' })
    const socket = new EventEmitter()
    const warn = vi.fn()
    const request = {
      url: `/relay/client?token=${encodeURIComponent(token)}&connectionId=relay_456`,
      log: { warn, info: vi.fn() },
    } as unknown as FastifyRequest

    observeClientRelayLifecycle(socket as unknown as WebSocket, request, 'multiplex')
    socket.emit('close', 1013, Buffer.from('server restart'))
    await vi.waitFor(() => expect(mockWriteLog).toHaveBeenCalledOnce())

    expect(warn).toHaveBeenCalledWith(expect.objectContaining({
      event: 'relay.client-closed',
      connectionId: 'relay_456',
      closeCode: 1013,
      retryable: true,
    }), 'client relay closed')
    const persisted = JSON.stringify(mockWriteLog.mock.calls[0][0])
    expect(persisted).not.toContain(token)
    expect(persisted).not.toContain('device-secret-1')
  })
})
