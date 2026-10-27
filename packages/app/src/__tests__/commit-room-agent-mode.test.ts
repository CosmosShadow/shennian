// @covers src/features/rooms/commitRoomAgentMode.ts
// @covers src/features/rooms/components/RoomAgentModeControl.tsx
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { commitRoomAgentMode } from '../features/rooms/commitRoomAgentMode'
import type { RoomMemberView } from '../features/rooms/types'

const target = { accountId: 'me', roomId: 'room', memberId: 'member', agentIdentityId: 'agent',
  sessionId: 'session', original: 'mention_only' as const, desired: 'paused' as const }
const member = (): RoomMemberView => ({
  id: 'member', principalType: 'agent', ownerUserId: 'me', agentIdentityId: 'agent',
  displayAlias: 'Agent', role: 'member', joinedAt: '', avatar: null, ownerAvatar: null,
  parentHumanMembershipId: 'human',
  ownBinding: { agentMembershipId: 'member', nianSessionId: 'session', status: 'active',
    activationMode: 'mention_only', availability: 'available', lastMessagePreview: null },
})
const deps = () => ({ accountId: vi.fn(() => 'me'), read: vi.fn(async () => [member()]), update: vi.fn(async (_mode: import('@shennian/wire').RoomActivationMode) => {}) })
describe('Explicit Agent mode application', () => {
  it('saves directly on radio selection without an Apply or draft interface', () => {
    const source = readFileSync(resolve(__dirname, '../features/rooms/components/RoomAgentModeControl.tsx'), 'utf8')
    expect(source).not.toMatch(/setDraft|agent-mode-apply|agent_mode_apply_notice/)
    expect(source).toContain('desired === displayedMode')
    expect(source).toContain('inFlight.current')
    expect(source).toContain("setSavedMode(null); setError(t('agent_mode_conflict'))")
  })
  it('commits each subsequent user selection instead of batching changes until exit', async () => {
    const d = deps(); const m = member()
    d.read.mockImplementation(async () => [m])
    d.update.mockImplementation(async (mode) => { m.ownBinding!.activationMode = mode })
    await commitRoomAgentMode(target, d)
    await commitRoomAgentMode({ ...target, original: 'paused', desired: 'mention_only' }, d)
    expect(d.update.mock.calls).toEqual([['paused'], ['mention_only']])
  })
  it('does not read or mutate when the selected value is unchanged', async () => {
    const d = deps()
    expect(await commitRoomAgentMode({ ...target, desired: target.original }, d)).toBe(false)
    expect(d.read).not.toHaveBeenCalled(); expect(d.update).not.toHaveBeenCalled()
  })
  it('revalidates and applies the final value exactly once', async () => {
    const d = deps()
    expect(await commitRoomAgentMode(target, d)).toBe(true)
    expect(d.read).toHaveBeenCalledTimes(1)
    expect(d.update).toHaveBeenCalledExactlyOnceWith('paused')
    expect(d.read.mock.invocationCallOrder[0]).toBeLessThan(d.update.mock.invocationCallOrder[0])
  })
  it('does not emit a duplicate change when another device already applied it', async () => {
    const d = deps(); const m = member(); m.ownBinding!.activationMode = 'paused'; d.read.mockResolvedValue([m])
    expect(await commitRoomAgentMode(target, d)).toBe(false)
    expect(d.update).not.toHaveBeenCalled()
  })
  it.each(['removed', 'foreign', 'rebound', 'identity', 'detached'] as const)('rejects %s membership before updating', async (kind) => {
    const d = deps(); const m = member()
    if (kind === 'foreign') m.ownerUserId = 'other'
    if (kind === 'rebound') m.ownBinding!.nianSessionId = 'replacement'
    if (kind === 'identity') m.agentIdentityId = 'other'
    if (kind === 'detached') m.ownBinding!.status = 'detached'
    d.read.mockResolvedValue(kind === 'removed' ? [] : [m])
    await expect(commitRoomAgentMode(target, d)).rejects.toThrow('room_agent_binding_unavailable')
    expect(d.update).not.toHaveBeenCalled()
  })
  it('does not overwrite a concurrent mode selection', async () => {
    const d = deps(); const m = member(); m.ownBinding!.activationMode = 'auto_follow'; d.read.mockResolvedValue([m])
    await expect(commitRoomAgentMode(target, d)).rejects.toThrow('agent_mode_conflict')
    expect(d.update).not.toHaveBeenCalled()
  })
  it('fails closed when the account changes during validation', async () => {
    const d = deps(); d.read.mockImplementation(async () => { d.accountId.mockReturnValue('other'); return [member()] })
    await expect(commitRoomAgentMode(target, d)).rejects.toThrow('account_changed')
    expect(d.update).not.toHaveBeenCalled()
  })
  it('propagates update failure instead of reporting a saved draft', async () => {
    const d = deps(); d.update.mockRejectedValue(new Error('offline'))
    await expect(commitRoomAgentMode(target, d)).rejects.toThrow('offline')
  })
})
