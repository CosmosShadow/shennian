// @covers open-source/packages/server/src/services/session-create.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SESSION_SYNC_PROTOCOL_VERSION, SESSION_SYNC_REQUIRED_CAPABILITIES } from '@shennian/wire'
const { database, access, project } = vi.hoisted(() => ({
  database: { nianSession: { findUnique: vi.fn(), create: vi.fn() } },
  access: vi.fn(), project: vi.fn(),
}))
vi.mock('../lib/prisma.js', () => ({ prisma: database }))
vi.mock('../services/session-creation-access.js', () => ({ requireMachineAccess: access }))
vi.mock('../services/projects.js', () => ({ upsertSessionProject: project }))
vi.mock('../services/entitlements.js', () => ({ requireEntitlement: vi.fn() }))
import { createSessionForUser } from '../services/session-create.js'

const input = { id: 'sess_35b29532-bc66-4e20-8dca-f8bf73b8f898', creationKey: 'local:owner:uuid', userId: 'owner', machineId: 'machine', agentType: 'codex', modelId: 'gpt-6-astra', workDir: '/project' }
function record() { return { ...input, deletedAt: null, agentIdentityId: null, createdAt: new Date(), lastActivityAt: new Date() } }
beforeEach(() => {
  vi.resetAllMocks()
  access.mockResolvedValue({ name: 'Mac', online: true, daemonInstallationId: 'installation', sessionSyncProtocolVersion: SESSION_SYNC_PROTOCOL_VERSION, sessionSyncCapabilities: [...SESSION_SYNC_REQUIRED_CAPABILITIES] })
  database.nianSession.findUnique.mockResolvedValue(null)
  database.nianSession.create.mockResolvedValue(record())
})
describe('idempotent local session promotion', () => {
  it('preserves the local ID and selected configuration', async () => {
    const result = await createSessionForUser(input)
    expect(result.id).toBe(input.id)
    expect(database.nianSession.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining(input) }))
  })
  it('returns an existing session on retry instead of creating another', async () => {
    database.nianSession.findUnique.mockResolvedValue(record())
    expect((await createSessionForUser(input)).id).toBe(input.id)
    expect(database.nianSession.create).not.toHaveBeenCalled()
  })
  it('recovers the same session after concurrent unique-key creation', async () => {
    database.nianSession.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(record())
    database.nianSession.create.mockRejectedValue({ code: 'P2002' })
    expect((await createSessionForUser(input)).id).toBe(input.id)
  })
  it('never reuses deleted, foreign-account, foreign-machine or wrong-ID records', async () => {
    for (const patch of [{ deletedAt: new Date() }, { userId: 'other' }, { machineId: 'other' }, { workDir: '/other' }, { id: 'other' }]) {
      database.nianSession.findUnique.mockResolvedValue({ ...record(), ...patch })
      await expect(createSessionForUser(input)).rejects.toThrow('creation key conflict')
    }
    expect(database.nianSession.create).not.toHaveBeenCalled()
  })
  it('does not create a session when machine access fails', async () => {
    access.mockRejectedValue(new Error('Not authorized'))
    await expect(createSessionForUser(input)).rejects.toThrow('Not authorized')
    expect(database.nianSession.create).not.toHaveBeenCalled()
  })
})

describe('steward session creation', () => {
  const steward = { ...input, sessionScope: 'steward' as const, workDir: '/home/owner/.shennian-steward' }
  const stewardRecord = () => ({ ...record(), ...steward })
  beforeEach(() => {
    access.mockResolvedValue({ userId: 'owner', name: 'Mac', online: true, daemonInstallationId: 'installation', sessionSyncProtocolVersion: SESSION_SYNC_PROTOCOL_VERSION, sessionSyncCapabilities: [...SESSION_SYNC_REQUIRED_CAPABILITIES] })
    database.nianSession.create.mockResolvedValue(stewardRecord())
  })
  it('stores the scope, hides it natively and never projects a project', async () => {
    await createSessionForUser(steward)
    expect(database.nianSession.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sessionScope: 'steward', nativeSessionVisibility: 'internal' }),
    }))
    expect(project).toHaveBeenCalledWith(expect.objectContaining({ sessionScope: 'steward' }))
  })
  it('is only available to the machine Owner, not to shared users', async () => {
    access.mockResolvedValue({ userId: 'someone-else', name: 'Mac', online: true, daemonInstallationId: 'installation', sessionSyncProtocolVersion: SESSION_SYNC_PROTOCOL_VERSION, sessionSyncCapabilities: [...SESSION_SYNC_REQUIRED_CAPABILITIES] })
    await expect(createSessionForUser(steward)).rejects.toThrow('Not authorized')
    expect(database.nianSession.create).not.toHaveBeenCalled()
  })
  it('rejects manager mode and Agent identities', async () => {
    await expect(createSessionForUser({ ...steward, sessionMode: 'manager' })).rejects.toThrow('standard personal session')
    await expect(createSessionForUser({ ...steward, agentIdentityId: 'agent' })).rejects.toThrow('standard personal session')
  })
  it('never reuses a creation key across scopes', async () => {
    database.nianSession.findUnique.mockResolvedValue(record())
    await expect(createSessionForUser(steward)).rejects.toThrow('creation key conflict')
    database.nianSession.findUnique.mockResolvedValue(stewardRecord())
    await expect(createSessionForUser({ ...input, workDir: steward.workDir })).rejects.toThrow('creation key conflict')
  })
})
