// @covers src/features/rooms/agentParticipationNavigation.ts
// @covers src/features/rooms/components/RoomAgentParticipation.tsx
// @covers src/features/rooms/components/RoomAgentParticipationEntry.tsx
// @covers src/features/agents/AgentOverview.tsx
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  resolveScopedAgentIdentity,
  selectRoomParticipationAgent,
} from '../features/rooms/agentParticipationNavigation'
import type { RoomMemberView } from '../features/rooms/types'

const agent = (identity: string, owner = 'me') =>
  ({
    id: `member-${identity}`,
    principalType: 'agent',
    agentIdentityId: identity,
    ownerUserId: owner,
  }) as RoomMemberView
const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf8')

describe('Agent participation navigation', () => {
  it('selects a sole owned Agent but never an arbitrary first Agent in a group', () => {
    const first = agent('first')
    expect(selectRoomParticipationAgent([first, agent('foreign', 'other')], 'me')).toBe(first)
    expect(selectRoomParticipationAgent([first, agent('second')], 'me')).toBeNull()
    expect(selectRoomParticipationAgent([agent('foreign', 'other')], 'me')).toBeNull()
    expect(selectRoomParticipationAgent([first], null)).toBeNull()
  })
  it('retains an explicit selection and never silently substitutes a removed or foreign Agent', () => {
    const second = agent('second')
    expect(selectRoomParticipationAgent([agent('first'), second], 'me', 'second')).toBe(second)
    expect(selectRoomParticipationAgent([agent('first')], 'me', 'second')).toBeNull()
    expect(
      selectRoomParticipationAgent([agent('first'), agent('foreign', 'other')], 'me', 'foreign'),
    ).toBeNull()
  })
  it('keeps Agent-index scope stable when a restart replaces the bound Session', () => {
    const before = [{ agentIdentityId: 'a', sessionId: 'old' }]
    const identity = resolveScopedAgentIdentity(before, 'old')
    const after = [
      { agentIdentityId: 'a', sessionId: 'replacement' },
      { agentIdentityId: 'b', sessionId: 'other' },
    ]
    expect(identity).toBe('a')
    expect(resolveScopedAgentIdentity(after, 'old', identity!)).toBe('a')
    expect(resolveScopedAgentIdentity(after, 'unknown')).toBeNull()
    expect(resolveScopedAgentIdentity([], 'old', identity!)).toBe('a')
  })
  it('does not switch a group message face to AI when a restart completes', () => {
    const workspace = read('../features/rooms/RoomWorkspaceScreen.tsx')
    expect(workspace).toContain('current === previousSessionId ? replacement.id : current')
    expect(workspace).toContain('setParticipationOpen(false) }, [currentUserId, roomId]')
  })
  it('uses a dedicated relationship page and guards in-flight changes', () => {
    const entry = read('../features/rooms/components/RoomAgentParticipationEntry.tsx')
    const content = read('../features/rooms/components/RoomAgentParticipation.tsx')
    const detail = read('../../app/(main)/agents/[agentId]/index.tsx')
    const guard = read('../features/rooms/AgentParticipationMutationBoundary.tsx')
    expect(entry).not.toMatch(/<Modal|<BottomSheet/)
    expect(entry).toContain("pathname: '/(main)/agents/[agentId]'")
    expect(entry).toContain('contextRoomId: roomId')
    expect(detail).not.toContain('agent-participation-show-all')
    expect(detail).not.toContain('setExpandedRoomKey')
    expect(detail).toContain("pathname: '/(main)/room-workspace'")
    expect(detail).not.toContain('onEnterRoom=')
    expect(detail).toContain('scopedAgentSessionId: session.id')
    expect(detail).toContain('{contextRoomId ? (')
    expect(detail).toContain('roomId={contextRoomId}')
    expect(detail).toContain("returnAfterSave: '1'")
    expect(read('../features/agents/screens/AgentEditScreen.tsx')).toContain("returnAfterSave === '1' && navigation.isFocused()")
    expect(detail).toContain('showOverview={false}')
    expect(detail).toContain('scopedAgentIdentityId: agent.id')
    expect(detail).toContain('`${accountId}:${agentId}:${roomId}`')
    expect(content).toContain('onEnterRoom ?')
    expect(content).not.toContain('agent-settings-mode')
    expect(guard).toContain('usePreventRemove(busy')
    expect(guard).not.toContain('draft.apply')
    expect(detail).not.toContain("t('agent_participation_group_settings')")
  })
  it('keeps list navigation separate and each relationship action on its own row', () => {
    const detail = read('../../app/(main)/agents/[agentId]/index.tsx')
    const content = read('../features/rooms/components/RoomAgentParticipation.tsx')
    const mode = read('../features/rooms/components/RoomAgentModeControl.tsx')
    expect(detail).toContain('testID="agent-participation-count"')
    expect(detail).not.toContain('marginLeft: 72')
    const actions = content.slice(content.indexOf('<View testID="room-agent-stacked-actions"'), content.indexOf('export function ParticipationAction'))
    expect(actions.indexOf('agent-participation-enter-room')).toBeLessThan(actions.indexOf('room-agent-restart'))
    expect(actions.indexOf('room-agent-restart')).toBeLessThan(actions.indexOf('room-agent-leave'))
    expect(actions).not.toContain('backgroundColor: colors.surface')
    expect(actions).not.toContain('chevron-forward')
    expect(actions).toContain('borderBottomColor: colors.border')
    expect(mode).toContain('minHeight: 48')
    expect(mode).toContain('selected ? <Ionicons name="checkmark"')
    expect(mode).toContain('style={styles.selectionMark}')
    expect(mode).not.toContain('radio-button-off')
    expect(mode).not.toContain('selected && { backgroundColor: colors.brandLight }')
    expect(mode).toContain('t(`spaces_agent_mode_${option}`)')
    expect(mode).toContain('style={styles.options} accessibilityRole="radiogroup"')
    expect(mode).toContain('<RoomAgentStatusLabel participation={displayedParticipation}')
    expect(mode).toContain('options: [...MODES.map(value =>')
    expect(mode).not.toContain('<RoomAgentStatusLabel participation={roomActivationModeToParticipation(option)}')
  })
  it('does not authorize stale data or other owners and rejects mismatched Sessions', () => {
    const content = read('../features/rooms/components/RoomAgentParticipation.tsx')
    const data = read('../features/rooms/useRoomAgentSettings.ts')
    expect(content.replace(/\s+/g, ' ')).toContain('data && !failed && data.member.ownerUserId === accountId')
    expect(data).toContain('session.id !==')
    expect(data).toContain('item.ownerUserId === accountId')
    expect(data).toContain('isRoomAccountForbidden(error) || isRoomAccountNotFound(error)')
  })
})
