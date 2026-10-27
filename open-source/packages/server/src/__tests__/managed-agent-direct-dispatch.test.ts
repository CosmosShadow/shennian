// @covers open-source/packages/server/src/relay/handler.ts

import WebSocket from 'ws'
import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { machineFindFirst, sessionFindFirst, authDeviceFindUnique } = vi.hoisted(() => ({
  authDeviceFindUnique: vi.fn(async () => ({ platform: 'ios', installationId: 'app-1', tokenExpiry: new Date(Date.now() + 60_000) })),
  machineFindFirst: vi.fn(),
  sessionFindFirst: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    machine: { findFirst: machineFindFirst, findUnique: vi.fn(async () => ({ id: 'machine-1' })) },
    device: { findUnique: authDeviceFindUnique },
    nianSession: { findFirst: sessionFindFirst },
  },
}))

vi.mock('../services/jwt.js', () => ({ verifyToken: () => ({ userId: 'user-1', deviceId: 'device-1' }) }))
vi.mock('../services/review-account-policy.js', () => ({ isReviewAccountUserId: async () => false }))
vi.mock('../services/plan-access.js', () => ({ getPlanAccess: async () => ({ allowed: true }) }))
vi.mock('../services/machine-access.js', () => ({ getMachineAccess: async () => ({ role: 'owner' }) }))
vi.mock('../services/log.js', () => ({ writeLog: async () => {} }))
vi.mock('../relay/session-sync-gate.js', () => ({ checkAppSessionSyncHandshake: () => ({ allowed: true }) }))
vi.mock('../relay/client-connection-leases.js', () => ({ clientConnectionLeases: { acquire: async () => ({ renew: async () => true, release: async () => {} }) } }))

import { connections } from '../relay/connections.js'
import {
  handleClientConnection,
  handleMultiplexClientConnection,
  authorizeMachineOwnerRequest,
  authorizePersonalIdentityRequest,
  shouldDeliverSharedMachineFrame,
} from '../relay/handler.js'

function socket() {
  return { readyState: WebSocket.OPEN, send: vi.fn() } as unknown as WebSocket
}

function request(
  method: 'chat.send' | 'chat.enqueue' | 'chat.queue.edit' | 'chat.queue.delete' | 'chat.queue.promote',
  sessionId: string,
) {
  return {
    type: 'req' as const,
    id: `request-${method}`,
    method,
    params: {
      protocolVersion: 2,
      dataEpoch: 2,
      daemonInstallationId: 'installation-1',
      sessionId,
      message: 'untrusted bootstrap',
    },
  }
}

describe('managed Agent direct dispatch boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    machineFindFirst.mockResolvedValue({ id: 'machine-1', cliVersion: '0.4.11' })
  })

  it('attests an owner enqueue for a managed Agent session', async () => {
    sessionFindFirst.mockResolvedValue({ agentIdentityId: 'agent-1' })
    const client = socket()
    const frame = request('chat.enqueue', 'session-1')

    await expect(
      authorizePersonalIdentityRequest(
        client,
        'legacy',
        'machine-1',
        'user-1',
        frame as never,
      ),
    ).resolves.toBe(true)

    expect(frame.params).toMatchObject({ managedAgentDirect: true })
    expect(client.send).not.toHaveBeenCalled()
  })

  it('keeps legacy direct chat.send blocked for a managed Agent session', async () => {
    sessionFindFirst.mockResolvedValue({ agentIdentityId: 'agent-1' })
    const client = socket()

    await expect(
      authorizePersonalIdentityRequest(
        client,
        'legacy',
        'machine-1',
        'user-1',
        request('chat.send', 'session-1') as never,
      ),
    ).resolves.toBe(false)

    expect(client.send).toHaveBeenCalledWith(
      expect.stringContaining('managed_agent_direct_dispatch_forbidden'),
    )
  })

  it('requires a daemon version that enforces managed direct policy', async () => {
    machineFindFirst.mockResolvedValue({ id: 'machine-1', cliVersion: '0.4.10' })
    sessionFindFirst.mockResolvedValue({ agentIdentityId: 'agent-1' })
    const client = socket()

    await expect(
      authorizePersonalIdentityRequest(
        client,
        'legacy',
        'machine-1',
        'user-1',
        request('chat.enqueue', 'session-1') as never,
      ),
    ).resolves.toBe(false)

    expect(client.send).toHaveBeenCalledWith(
      expect.stringContaining('managed_agent_direct_requires_cli_upgrade'),
    )
  })

  it.each(['chat.queue.edit', 'chat.queue.delete', 'chat.queue.promote'] as const)(
    'lets the daemon distinguish editable owner queue items from immutable Room items for %s',
    async (method) => {
      sessionFindFirst.mockResolvedValue({ agentIdentityId: null })
      const client = socket()
      await expect(
        authorizePersonalIdentityRequest(
          client,
          'legacy',
          'machine-1',
          'user-1',
          request(method, 'session-1') as never,
        ),
      ).resolves.toBe(true)
      expect(sessionFindFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ id: 'session-1', userId: 'user-1' }),
      }))
      expect(client.send).not.toHaveBeenCalled()
    },
  )

  it('continues to allow direct personal Session sends', async () => {
    sessionFindFirst.mockResolvedValue({ agentIdentityId: null })
    const client = socket()

    await expect(
      authorizePersonalIdentityRequest(
        client,
        'multiplex',
        'machine-1',
        'user-1',
        request('chat.send', 'personal-session') as never,
      ),
    ).resolves.toBe(true)
    expect(client.send).not.toHaveBeenCalled()
  })

  it('strips a forged managed marker from a personal enqueue', async () => {
    sessionFindFirst.mockResolvedValue({ agentIdentityId: null })
    const client = socket()
    const frame = request('chat.enqueue', 'personal-session')
    Object.assign(frame.params, { managedAgentDirect: true })

    await expect(
      authorizePersonalIdentityRequest(
        client,
        'multiplex',
        'machine-1',
        'user-1',
        frame as never,
      ),
    ).resolves.toBe(true)
    expect(frame.params).not.toHaveProperty('managedAgentDirect')
  })
})

describe('shared-machine owner-only relay boundary', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(['legacy', 'multiplex'] as const)(
    'rejects privileged machine mutation in %s mode for a grantee',
    async (mode) => {
      machineFindFirst.mockResolvedValue(null)
      const client = socket()

      await expect(authorizeMachineOwnerRequest(
        client,
        mode,
        'machine-1',
        'grantee-1',
        { type: 'req', id: 'request-1', method: 'upgrade.start', params: {} } as never,
      )).resolves.toBe(false)

      expect(client.send).toHaveBeenCalledWith(expect.stringContaining('machine_owner_required'))
    },
  )

  it('allows ordinary use requests through the owner-only filter', async () => {
    const client = socket()
    await expect(authorizeMachineOwnerRequest(
      client,
      'multiplex',
      'machine-1',
      'grantee-1',
      { type: 'req', id: 'request-1', method: 'chat.send', params: {} } as never,
    )).resolves.toBe(true)
    expect(machineFindFirst).not.toHaveBeenCalled()
    expect(client.send).not.toHaveBeenCalled()
  })
})

describe('shared-machine relay response and event privacy', () => {
  beforeEach(() => vi.clearAllMocks())

  it('delivers a response only to the grantee socket that sent its request', async () => {
    const mine = new Set(['request-1'])
    const somebodyElse = new Set<string>()
    const response = JSON.stringify({ type: 'res', id: 'request-1', ok: true, payload: { files: ['private'] } })
    await expect(shouldDeliverSharedMachineFrame(response, 'machine-1', 'grantee-1', mine))
      .resolves.toBe(true)
    await expect(shouldDeliverSharedMachineFrame(response, 'machine-1', 'grantee-2', somebodyElse))
      .resolves.toBe(false)
    expect(mine.size).toBe(0)
  })

  it('delivers session events only when the session belongs to that grantee', async () => {
    sessionFindFirst.mockResolvedValueOnce({ id: 'session-1' }).mockResolvedValueOnce(null)
    const event = JSON.stringify({
      type: 'event', event: 'session.activity', payload: { sessionId: 'session-1', activity: {} },
    })
    await expect(shouldDeliverSharedMachineFrame(event, 'machine-1', 'grantee-1', new Set()))
      .resolves.toBe(true)
    await expect(shouldDeliverSharedMachineFrame(event, 'machine-1', 'grantee-2', new Set()))
      .resolves.toBe(false)
    expect(sessionFindFirst).toHaveBeenCalledWith({
      where: { id: 'session-1', machineId: 'machine-1', userId: 'grantee-1', deletedAt: null },
      select: { id: true },
    })
  })

  it('delivers nested queue snapshots to the session owner', async () => {
    sessionFindFirst.mockResolvedValueOnce({ id: 'session-1' }).mockResolvedValueOnce(null)
    const event = JSON.stringify({
      type: 'event',
      event: 'session.queue.update',
      payload: { queue: { sessionId: 'session-1', pending: [], controllablePending: [] } },
    })

    await expect(shouldDeliverSharedMachineFrame(event, 'machine-1', 'grantee-1', new Set()))
      .resolves.toBe(true)
    await expect(shouldDeliverSharedMachineFrame(event, 'machine-1', 'grantee-2', new Set()))
      .resolves.toBe(false)
    expect(sessionFindFirst).toHaveBeenCalledWith({
      where: { id: 'session-1', machineId: 'machine-1', userId: 'grantee-1', deletedAt: null },
      select: { id: true },
    })
  })

  it('allows public machine state but fails closed for unknown events', async () => {
    await expect(shouldDeliverSharedMachineFrame(
      JSON.stringify({ type: 'event', event: 'machine.agents', payload: {} }),
      'machine-1', 'grantee-1', new Set(),
    )).resolves.toBe(true)
    await expect(shouldDeliverSharedMachineFrame(
      JSON.stringify({ type: 'event', event: 'owner.private-event', payload: {} }),
      'machine-1', 'grantee-1', new Set(),
    )).resolves.toBe(false)
  })
})


describe('managed authorization in forwarded wire frames', () => {
  it.each(['legacy', 'multiplex'] as const)('forwards the post-authorization %s payload', async mode => {
    machineFindFirst.mockResolvedValue({ id: 'machine-1', cliVersion: '0.4.62' })
    sessionFindFirst.mockResolvedValue({ agentIdentityId: 'agent-1' })
    const client = Object.assign(new EventEmitter(), { readyState: WebSocket.OPEN, send: vi.fn(), close: vi.fn() })
    const forwarded = vi.spyOn(connections, 'sendToMachine').mockReturnValue(true)
    try {
      const handler = mode === 'legacy' ? handleClientConnection : handleMultiplexClientConnection
      await handler(client as never, { url: '/relay/client?token=test', params: { machineId: 'machine-1' }, ip: '127.0.0.1' } as never)
      expect(client.close).not.toHaveBeenCalled()
      const frame = request('chat.enqueue', 'managed-session')
      client.emit('message', JSON.stringify(mode === 'legacy' ? frame : { type: 'relay', machineId: 'machine-1', frame }))
      await vi.waitFor(() => expect(forwarded).toHaveBeenCalled())
      expect(JSON.parse(forwarded.mock.calls[0]![1]).params.managedAgentDirect).toBe(true)
    } finally {
      client.emit('close')
      forwarded.mockRestore()
    }
  })
})

describe('steward session attestation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    machineFindFirst.mockResolvedValue({ id: 'machine-1', cliVersion: '0.5.15' })
  })

  it.each(['chat.send', 'chat.enqueue'] as const)('attests steward scope from the Server row for %s', async (method) => {
    sessionFindFirst.mockResolvedValue({ agentIdentityId: null, sessionScope: 'steward' })
    const frame = request(method, 'session-1')
    await expect(authorizePersonalIdentityRequest(socket(), 'legacy', 'machine-1', 'user-1', frame as never)).resolves.toBe(true)
    expect(frame.params).toMatchObject({ sessionScope: 'steward' })
  })

  it.each(['chat.send', 'chat.enqueue'] as const)('discards a client-claimed scope on an ordinary session for %s', async (method) => {
    sessionFindFirst.mockResolvedValue({ agentIdentityId: null, sessionScope: 'personal' })
    const frame = request(method, 'session-1')
    ;(frame.params as Record<string, unknown>).sessionScope = 'steward'
    await expect(authorizePersonalIdentityRequest(socket(), 'legacy', 'machine-1', 'user-1', frame as never)).resolves.toBe(true)
    expect(frame.params).not.toHaveProperty('sessionScope')
  })

  it('blocks a steward turn for a Client that predates steward sessions', async () => {
    machineFindFirst.mockResolvedValue({ id: 'machine-1', cliVersion: '0.5.14' })
    sessionFindFirst.mockResolvedValue({ agentIdentityId: null, sessionScope: 'steward' })
    const client = socket()
    await expect(authorizePersonalIdentityRequest(client, 'legacy', 'machine-1', 'user-1', request('chat.enqueue', 'session-1') as never)).resolves.toBe(false)
    expect(client.send).toHaveBeenCalledWith(expect.stringContaining('steward_requires_cli_upgrade'))
  })
})


describe('immediate first frame during asynchronous authentication', () => {
  it.each(['legacy', 'multiplex'] as const)('preserves and authorizes the first %s request without a client delay', async mode => {
    machineFindFirst.mockResolvedValue({ id: 'machine-1', cliVersion: '0.4.62' })
    sessionFindFirst.mockResolvedValue({ agentIdentityId: 'agent-1' })
    let allowAuthentication!: (value: { platform: string; installationId: string; tokenExpiry: Date }) => void
    authDeviceFindUnique.mockImplementationOnce(() => new Promise(resolve => { allowAuthentication = resolve }))
    const client = Object.assign(new EventEmitter(), { readyState: WebSocket.OPEN, send: vi.fn(), close: vi.fn() })
    const forwarded = vi.spyOn(connections, 'sendToMachine').mockReturnValue(true)
    try {
      const handler = mode === 'legacy' ? handleClientConnection : handleMultiplexClientConnection
      const authenticating = handler(client as never, { url: '/relay/client?token=test', params: { machineId: 'machine-1' }, ip: '127.0.0.1' } as never)
      const frame = request('chat.enqueue', 'managed-session')
      client.emit('message', Buffer.from(JSON.stringify(mode === 'legacy' ? frame : { type: 'relay', machineId: 'machine-1', frame })), false)
      expect(forwarded).not.toHaveBeenCalled()
      await vi.waitFor(() => expect(allowAuthentication).toBeTypeOf('function'))
      allowAuthentication({ platform: 'ios', installationId: 'app-1', tokenExpiry: new Date(Date.now() + 60_000) })
      await authenticating
      await vi.waitFor(() => expect(forwarded).toHaveBeenCalledTimes(1))
      expect(JSON.parse(forwarded.mock.calls[0]![1]).params.managedAgentDirect).toBe(true)
    } finally {
      client.emit('close')
      forwarded.mockRestore()
    }
  })
})

it.each(['legacy', 'multiplex'] as const)('never forwards an early %s request after rejected authentication', async mode => {
  let rejectAuthentication!: (value: never) => void
  authDeviceFindUnique.mockImplementationOnce(() => new Promise(resolve => { rejectAuthentication = resolve }))
  const client = Object.assign(new EventEmitter(), {
    readyState: WebSocket.OPEN as number,
    send: vi.fn(),
    close: vi.fn(() => { client.readyState = WebSocket.CLOSED; client.emit('close') }),
  })
  const forwarded = vi.spyOn(connections, 'sendToMachine').mockReturnValue(true)
  try {
    const handler = mode === 'legacy' ? handleClientConnection : handleMultiplexClientConnection
    const authenticating = handler(client as never, { url: '/relay/client?token=test', params: { machineId: 'machine-1' }, ip: '127.0.0.1' } as never)
    const frame = request('chat.enqueue', 'managed-session')
    client.emit('message', Buffer.from(JSON.stringify(mode === 'legacy' ? frame : { type: 'relay', machineId: 'machine-1', frame })), false)
    await vi.waitFor(() => expect(rejectAuthentication).toBeTypeOf('function'))
    rejectAuthentication(null as never)
    await authenticating
    expect(client.close).toHaveBeenCalledWith(4001, 'Token expired')
    expect(forwarded).not.toHaveBeenCalled()
    expect(client.listenerCount('message')).toBe(0)
  } finally {
    client.emit('close')
    forwarded.mockRestore()
  }
})
