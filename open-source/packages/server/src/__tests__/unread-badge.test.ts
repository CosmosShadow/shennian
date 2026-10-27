// @covers open-source/packages/server/src/services/unread-badge.ts
// @covers open-source/packages/server/src/services/session-visible-machines.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SESSION_SYNC_DATA_EPOCH } from '@shennian/wire'

const { machines, grants, sessions, memberships } = vi.hoisted(() => ({
  machines: vi.fn(), grants: vi.fn(), sessions: vi.fn(), memberships: vi.fn(),
}))
vi.mock('../lib/prisma.js', () => ({ prisma: {
  machine: { findMany: machines },
  machineGrant: { findMany: grants },
  nianSession: { findMany: sessions },
  roomMembership: { findMany: memberships },
} }))
import { countUnreadVisibleMessages } from '../services/unread-badge.js'
import { getAccessibleMachineMap } from '../services/session-visible-machines.js'

function session(id: string, machineId: string, attentionCount: number) {
  return {
    id, machineId, userId: 'user', deletedAt: null as Date | null,
    dataEpoch: SESSION_SYNC_DATA_EPOCH, agentType: 'codex', sessionMode: 'standard',
    agentIdentityId: null, agentSessionId: id, roomBinding: null,
    attentionCount, lastAttentionId: `terminal:${id}`,
    userStates: [{ lastReadAttentionCount: 0, lastReadAttentionId: null as string | null,
      manualUnread: false }],
  }
}

describe('badge visible session scope', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    machines.mockResolvedValue([{ id: 'paired', name: 'Mac' }])
    grants.mockResolvedValue([])
    memberships.mockResolvedValue([])
    sessions.mockResolvedValue([])
  })

  it('excludes the five unpaired historical results and deleted/old-epoch sessions', async () => {
    const current = session('current', 'paired', 1)
    const rows = [current, session('old-1', 'unpaired-1', 1),
      session('old-2', 'unpaired-2', 2), session('old-3', 'unpaired-3', 2),
      { ...session('deleted', 'paired', 3), deletedAt: new Date() },
      { ...session('old-epoch', 'paired', 7), dataEpoch: -1 }]
    sessions.mockImplementation(async ({ where }) => {
      expect(where).toEqual({ userId: 'user', deletedAt: null,
        machineId: { in: ['paired'] }, dataEpoch: SESSION_SYNC_DATA_EPOCH })
      return rows.filter(row => where.machineId.in.includes(row.machineId) &&
        row.deletedAt === where.deletedAt && row.dataEpoch === where.dataEpoch)
    })
    expect(await countUnreadVisibleMessages('user')).toBe(1)
    current.userStates[0].lastReadAttentionCount = 1
    current.userStates[0].lastReadAttentionId = current.lastAttentionId
    expect(await countUnreadVisibleMessages('user')).toBe(0)
    // Ownership and paired state matter; online state deliberately does not.
    expect(machines).toHaveBeenCalledWith({ where: { userId: 'user', paired: true },
      select: { id: true, name: true } })
  })

  it('shares list access rules for active grants and rejects unpaired shared machines', async () => {
    grants.mockResolvedValue([
      { machine: { id: 'shared', name: 'Shared', paired: true } },
      { machine: { id: 'removed', name: 'Removed', paired: false } },
      { machine: { id: 'paired', name: 'Duplicate', paired: true } },
    ])
    expect([...await getAccessibleMachineMap('user')]).toEqual([
      ['paired', 'Mac'], ['shared', 'Shared'],
    ])
    expect(grants).toHaveBeenCalledWith(expect.objectContaining({ where: {
      granteeId: 'user', revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
    } }))
  })

  it('counts an unread Room once when there are no accessible machines', async () => {
    machines.mockResolvedValue([])
    memberships.mockResolvedValue([{ readState: { lastReadSequence: 8n },
      room: { nextSequence: 10n } }])
    expect(await countUnreadVisibleMessages('user')).toBe(1)
    expect(sessions).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ machineId: { in: [] } }),
    }))
  })

  it('retains manual unread and avoids manager substrate/room double counting', async () => {
    sessions.mockResolvedValue([
      { ...session('manager', 'paired', 1), sessionMode: 'manager', agentSessionId: 'native' },
      { ...session('substrate', 'paired', 4), agentSessionId: 'native' },
      { ...session('room', 'paired', 3), roomBinding: { status: 'active' } },
      { ...session('manual', 'paired', 0), userStates: [{ manualUnread: true,
        lastReadAttentionCount: 0, lastReadAttentionId: null }] },
    ])
    expect(await countUnreadVisibleMessages('user')).toBe(1)
  })
})
