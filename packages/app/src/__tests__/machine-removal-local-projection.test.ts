// @covers packages/app/src/storage/room-agent-store.native.ts

import { describe, expect, it, vi } from 'vitest'
import type { AgentWorkspace } from '@shennian/wire'
import { projectAgentWorkspaceRuntimeUnavailable } from '@shennian/shared'
import {
  roomMemberUsesSession,
  createRoomAgentStore,
} from '../storage/room-agent-store.native'

const agent: AgentWorkspace = {
  id: 'agent-1',
  displayName: '小念',
  description: '',
  systemPrompt: '',
  avatar: null,
  status: 'active',
  availability: 'available',
  repairAction: null,
  machineId: 'machine-1',
  machineName: 'Mac',
  runtimeAdapter: 'codex',
  workDir: '/work',
  modelId: null,
  sessionMode: 'standard',
  managerConfig: null,
  createdAt: '2026-09-03T00:00:00.000Z',
  updatedAt: '2026-09-03T00:00:00.000Z',
  sessions: [{
    id: 'session-1', title: '', status: 'active', agentType: 'codex', modelId: null,
    machineId: 'machine-1', machineName: 'Mac', workDir: '/work',
    lastActivityAt: '2026-09-03T00:00:00.000Z',
    room: {
      bindingId: 'binding-1', status: 'active', roomId: 'room-1', roomName: '讨论组',
      activationMode: 'auto_follow', availability: 'available', repairAction: null,
    },
  }],
}

describe('machine removal local projection', () => {
  it('preserves the identity but drops only conversations hosted on the removed machine', () => {
    const other = { ...agent.sessions[0]!, id: 'other-session', machineId: 'machine-2' }
    const projected = projectAgentWorkspaceRuntimeUnavailable({ ...agent, sessions: [...agent.sessions, other] }, 'machine-1')
    expect(projected).toMatchObject({ id: agent.id, displayName: agent.displayName, availability: 'unavailable', repairAction: null })
    expect(projected.sessions).toEqual([other])
    expect(projectAgentWorkspaceRuntimeUnavailable(agent, 'machine-2')).toBe(agent)
    const migrated = { ...agent, machineId: 'machine-2' }
    expect(projectAgentWorkspaceRuntimeUnavailable(migrated, 'machine-1').sessions).toEqual([])
  })

  it('matches the exact session dependency rather than removing every membership of an identity', () => {
    const member = { id: 'member', roomId: 'room', payload: {
      principalType: 'agent', ownBinding: { nianSessionId: 'session-1' },
    } }
    expect(roomMemberUsesSession(member, new Set(['session-1']))).toBe(true)
    expect(roomMemberUsesSession(member, new Set(['session-2']))).toBe(false)
    expect(roomMemberUsesSession({ ...member, payload: { principalType: 'human' } }, new Set(['session-1']))).toBe(false)
  })

  it('writes the removal barrier to Agent, Room link and member SQLite payloads', async () => {
    const member = {
      id: 'member-agent-1',
      roomId: 'room-1',
      payload: {
        principalType: 'agent',
        agentIdentityId: 'agent-1',
        agentParticipation: { activationMode: 'auto_follow', availability: 'available' },
        ownBinding: { nianSessionId: 'session-1', status: 'active', availability: 'available', repairAction: null },
      },
    }
    const runAsync = vi.fn(async (..._args: unknown[]) => undefined)
    const fakeDb = {
      withTransactionAsync: async (task: () => Promise<void>) => task(),
      getAllAsync: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT agentId, payload FROM agent_workspaces')) {
          return [{ agentId: agent.id, payload: JSON.stringify({ ...agent, sessions: [] }) }]
        }
        if (sql.includes('SELECT sessionId, payload FROM agent_session_links')) {
          return [{ sessionId: agent.sessions[0]!.id, payload: JSON.stringify(agent.sessions[0]) }]
        }
        if (sql.includes('SELECT roomId, membershipId, payload FROM room_members')) {
          return [{
            roomId: member.roomId,
            membershipId: member.id,
            payload: JSON.stringify(member),
          }]
        }
        return []
      }),
      runAsync,
    }
    const store = createRoomAgentStore(async () => fakeDb as never)

    await store.markMachineAgentsUnavailable?.('account-1', 'machine-1')

    const updates = runAsync.mock.calls
      .filter(([sql]) => String(sql).startsWith('UPDATE'))
      .map(([, payload]) => JSON.parse(String(payload)) as Record<string, unknown>)
    expect(updates[0]).toMatchObject({ availability: 'unavailable', repairAction: null })
    expect(runAsync).toHaveBeenCalledWith(
      'DELETE FROM agent_session_links WHERE accountId = ? AND agentId = ? AND sessionId = ?',
      'account-1', 'agent-1', 'session-1',
    )
    expect(runAsync).toHaveBeenCalledWith(
      'DELETE FROM room_members WHERE accountId = ? AND roomId = ? AND membershipId = ?',
      'account-1', 'room-1', 'member-agent-1',
    )
    expect(runAsync.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM room_messages'))).toBe(false)
    expect(runAsync.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM agent_workspaces'))).toBe(false)
  })
})
