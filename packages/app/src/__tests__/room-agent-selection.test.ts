// @covers src/features/rooms/roomAgentSelection.ts
// @covers app/(main)/spaces/agent-add.tsx
import { describe, expect, it, vi } from 'vitest'
import type { AgentWorkspace } from '@shennian/wire'
import type { RoomMemberView } from '../features/rooms/types'
import {
  getAddedRoomAgentIds,
  isExpectedManagedRoomBinding,
  toggleRoomAgentSelection,
  submitRoomAgentSelection,
} from '../features/rooms/roomAgentSelection'

describe('Room Agent selection draft', () => {
  it('keeps pre-existing members locked while allowing repeated select/deselect', () => {
    const existing = new Set(['existing'])
    let draft = toggleRoomAgentSelection([], 'new', existing)
    expect(draft).toEqual(['new'])
    expect(toggleRoomAgentSelection(draft, 'existing', existing)).toBe(draft)
    draft = toggleRoomAgentSelection(draft, 'new', existing)
    expect(draft).toEqual([])
  })

  it('recognizes active, paused and pending bindings and authoritative memberships', () => {
    const agents = ['active', 'paused', 'pending_approval', 'detached'].map((status) => ({
      id: status,
      sessions: [{ room: { roomId: 'room', status } }],
    })) as AgentWorkspace[]
    agents.push({
      id: 'elsewhere',
      sessions: [{ room: { roomId: 'other', status: 'active' } }],
    } as AgentWorkspace)
    const members = [{ principalType: 'agent', agentIdentityId: 'member-only' }] as RoomMemberView[]
    expect([...getAddedRoomAgentIds(agents, members, 'room', ['just-added'])].sort()).toEqual(
      ['active', 'paused', 'pending_approval', 'member-only', 'just-added'].sort(),
    )
  })

  it('submits only confirmed choices, sequentially, stopping on failure and retrying the remainder', async () => {
    let draft = ['first', 'second', 'third']
    const completed: string[] = []
    const add = vi.fn(async (id: string) => {
      if (id === 'second') return false
      completed.push(id)
      draft = draft.filter((selected) => selected !== id)
      return true
    })
    expect(await submitRoomAgentSelection([...draft], add)).toBe(false)
    expect(add.mock.calls).toEqual([['first'], ['second']])
    expect(completed).toEqual(['first'])
    expect(draft).toEqual(['second', 'third'])
    const retry = vi.fn(async () => true)
    expect(await submitRoomAgentSelection(draft, retry)).toBe(true)
    expect(retry.mock.calls).toHaveLength(2)
    const noSelection = vi.fn(async () => true)
    await submitRoomAgentSelection([], noSelection)
    expect(noSelection).not.toHaveBeenCalled()
  })

  it('accepts only the exact Room, Agent identity and private Session returned by managed binding', () => {
    const expected = {
      roomId: 'room-a',
      agentIdentityId: 'agent-a',
      nianSessionId: 'session-a',
      activationMode: 'auto_follow' as const,
    }
    const result = {
      binding: {
        id: 'binding-a',
        roomId: 'room-a',
        agentIdentityId: 'agent-a',
        agentMembershipId: 'membership-a',
        nianSessionId: 'session-a',
        status: 'active',
        activationMode: 'auto_follow',
      },
      idempotent: false,
    }

    expect(isExpectedManagedRoomBinding(result, expected)).toBe(true)
    expect(
      isExpectedManagedRoomBinding(
        { ...result, binding: { ...result.binding, status: 'paused' } },
        expected,
      ),
    ).toBe(true)
    for (const binding of [
      { ...result.binding, roomId: 'room-b' },
      { ...result.binding, agentIdentityId: 'agent-b' },
      { ...result.binding, nianSessionId: 'session-b' },
      { ...result.binding, agentMembershipId: '' },
      { ...result.binding, status: 'pending_approval' },
      { ...result.binding, activationMode: 'mention_only' },
    ]) {
      expect(isExpectedManagedRoomBinding({ ...result, binding }, expected)).toBe(false)
    }
    expect(isExpectedManagedRoomBinding(undefined, expected)).toBe(false)
    expect(isExpectedManagedRoomBinding({}, expected)).toBe(false)
  })
})
