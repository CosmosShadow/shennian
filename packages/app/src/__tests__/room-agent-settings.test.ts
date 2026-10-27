// @covers src/features/rooms/restartRoomAgentSession.ts
// @covers src/features/rooms/RoomAgentSettingsScreen.tsx
// @covers src/features/rooms/useRoomAgentSettings.ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { NianSession } from '@shennian/wire'
import { restartRoomAgentSession } from '../features/rooms/restartRoomAgentSession'
import { stopRoomAgentTask } from '../features/rooms/stopRoomAgentTask'

const oldSession = { id: 'old', agentType: 'codex' } as NianSession
const replacement = { id: 'new', agentType: 'codex' } as NianSession
const target = { roomId: 'room', bindingId: 'binding', agentIdentityId: 'agent', session: oldSession }
const dependencies = () => ({
  create: vi.fn(async (_id: string, _intent: string) => replacement), persist: vi.fn(async () => {}),
  restart: vi.fn(async () => ({ ok: true })), remove: vi.fn(async () => {}),
})
const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf8')

describe('Room Agent settings', () => {
  it('stops only the currently active managed Turn through the existing abort contract', async () => {
    const session = {
      id: 'managed-session', machineId: 'machine-1', agentType: 'codex',
      agentSessionId: 'native-thread', workDir: '/workspace',
      activity: {
        sessionId: 'managed-session', runId: 'run-1', runPhase: 'tool_running',
        startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      },
    } as NianSession
    const request = vi.fn(async () => ({ type: 'res' as const, id: 'stop', ok: true }))
    await stopRoomAgentTask(session, 'daemon-1', request)
    expect(request).toHaveBeenCalledWith('machine-1', 'chat.abort', expect.objectContaining({
      sessionId: 'managed-session', daemonInstallationId: 'daemon-1',
      agentSessionId: 'native-thread', workDir: '/workspace',
    }))
    await expect(stopRoomAgentTask({ ...session, activity: null }, 'daemon-1', request))
      .rejects.toThrow('room_agent_no_active_task')
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('replaces the binding before retiring the original session, without navigation', async () => {
    const deps = dependencies()
    expect(await restartRoomAgentSession(target, deps)).toBe(replacement)
    expect(deps.restart).toHaveBeenCalledWith(replacement, expect.objectContaining({
      roomId: 'room', bindingId: 'binding', agentIdentityId: 'agent',
      previousNianSessionId: 'old', nianSessionId: 'new', agentType: 'codex',
      assignmentIntentId: deps.create.mock.calls[0][1],
    }))
    expect(deps.remove).toHaveBeenCalledExactlyOnceWith('old')
    expect(deps.restart.mock.invocationCallOrder[0]).toBeLessThan(deps.remove.mock.invocationCallOrder[0])
  })
  it('rolls back only the replacement when the daemon refuses the restart', async () => {
    const deps = dependencies()
    deps.restart.mockResolvedValue({ ok: false })
    await expect(restartRoomAgentSession(target, deps)).rejects.toThrow('managed_agent_restart_failed')
    expect(deps.remove).toHaveBeenCalledExactlyOnceWith('new')
  })
  it('rolls back a replacement when local persistence fails', async () => {
    const deps = dependencies()
    deps.persist.mockRejectedValue(new Error('disk'))
    await expect(restartRoomAgentSession(target, deps)).rejects.toThrow('disk')
    expect(deps.restart).not.toHaveBeenCalled()
    expect(deps.remove).toHaveBeenCalledExactlyOnceWith('new')
  })
  it('does not delete anything when creation fails', async () => {
    const deps = dependencies()
    deps.create.mockRejectedValue(new Error('offline'))
    await expect(restartRoomAgentSession(target, deps)).rejects.toThrow('offline')
    expect(deps.remove).not.toHaveBeenCalled()
  })
  it('never rolls back an accepted binding because old-session cleanup fails', async () => {
    const deps = dependencies()
    deps.remove.mockRejectedValue(new Error('cleanup'))
    expect(await restartRoomAgentSession(target, deps)).toBe(replacement)
    expect(deps.remove).toHaveBeenCalledExactlyOnceWith('old')
  })
  it('uses shared full-page participation controls and retains legacy routes without nesting', () => {
    const screen = read('../features/rooms/RoomAgentSettingsScreen.tsx')
    const workspace = read('../features/rooms/RoomWorkspaceScreen.tsx')
    const actions = read('../features/rooms/useRoomAgentParticipationActions.ts')
    const layout = read('../../app/(main)/_layout.tsx')
    expect(workspace).toContain('<RoomAgentParticipationEntry')
    expect(workspace).not.toContain("pathname: '/(main)/spaces/agent-settings'")
    expect(layout).toContain('name="spaces/agent-settings"')
    expect(layout).toContain('name="spaces/agent-settings-mode"')
    expect(screen).toContain('selectRoomParticipationAgent')
    expect(screen).toContain("pathname: '/(main)/agents/[agentId]'")
    expect(screen).not.toContain('<Modal')
    expect(actions).not.toMatch(/router\.(back|replace|push)|onClose\(/)
    expect(actions).toContain("publishRoomReplicaRevision(target.room.id, ['members'])")
    expect(workspace).toContain('selectedAgentIdentityRef.current')
  })
  it('suspends read acknowledgments while the retained Agent conversation is covered', () => {
    const history = read('../features/chat/hooks/useChatSessionHistory.ts')
    expect(history).toContain('!focusedRef.current')
    expect(history).toContain('useIsFocused()')
    expect(history).toContain('useContext(RoomWorkspaceActivityContext)')
    expect(history).toContain('isChatScreenActive(')
  })
})
