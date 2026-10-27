// @arch open-source/docs/server-runtime.md
// @covers open-source/packages/server/src/relay/handler-authorization.ts
import WebSocket from 'ws'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SESSION_SYNC_DATA_EPOCH, SESSION_SYNC_PROTOCOL_VERSION, type ReqFrame } from '@shennian/wire'
const { machine, session } = vi.hoisted(() => ({ machine: vi.fn(), session: vi.fn() }))
vi.mock('../lib/prisma.js', () => ({ prisma: { machine: { findFirst: machine }, nianSession: { findFirst: session } } }))
import { authorizeMachineOwnerRequest, authorizePersonalIdentityRequest } from '../relay/handler-authorization.js'
const socket = () => ({ readyState: WebSocket.OPEN, send: vi.fn() }) as unknown as WebSocket
const req = (): ReqFrame => ({ type: 'req', id: 'settings-1', method: 'chat.codex.settings.set', params: {
  protocolVersion: SESSION_SYNC_PROTOCOL_VERSION, dataEpoch: SESSION_SYNC_DATA_EPOCH,
  daemonInstallationId: 'installation-1', sessionId: 'session-1', codexSettingsSession: { agentType: 'codex' },
} })
describe('Codex settings Relay authorization', () => {
  beforeEach(() => { vi.clearAllMocks(); machine.mockResolvedValue({ id: 'machine-1' }) })
  it('requires machine ownership, not a machine-use grant', async () => {
    const ws = socket()
    machine.mockResolvedValue(null)
    expect(await authorizeMachineOwnerRequest(ws, 'legacy', 'machine-1', 'grantee', req())).toBe(false)
    expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('machine_owner_required'))
    machine.mockResolvedValue({ id: 'machine-1' })
    expect(await authorizeMachineOwnerRequest(socket(), 'legacy', 'machine-1', 'owner', req())).toBe(true)
  })
  it('rejects mismatched identity and a session not owned by the requesting user', async () => {
    const ws = socket(), request = req()
    request.params.protocolVersion = -1
    expect(await authorizePersonalIdentityRequest(ws, 'legacy', 'machine-1', 'owner', request)).toBe(false)
    expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('invalid_identity'))
    session.mockResolvedValue(null)
    expect(await authorizePersonalIdentityRequest(ws, 'legacy', 'machine-1', 'owner', req())).toBe(false)
    expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('session_owner_required'))
  })
  it('overwrites client-claimed scope and native identity with the authoritative row', async () => {
    const row = { agentType: 'codex', workDir: '/test', agentSessionId: 'thread-1', sessionMode: 'standard',
      sessionScope: 'personal', agentIdentityId: 'managed-1' }
    session.mockResolvedValue(row)
    const request = req()
    expect(await authorizePersonalIdentityRequest(socket(), 'multiplex', 'machine-1', 'owner', request)).toBe(true)
    expect(request.params.codexSettingsSession).toEqual(row)
    expect(session).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'session-1', machineId: 'machine-1', userId: 'owner', deletedAt: null } }))
  })
})
