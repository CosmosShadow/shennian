// @covers open-source/packages/cli/src/room/session-registry.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RoomSessionRegistry } from '../room/session-registry.js'
import { resolveRoomStateFile } from '../room/runtime-state-path.js'

const roots: string[] = []
const capabilities = {
  canIdentifySession: true,
  canBindAutomatically: true,
  canOpenEmbeddedRoomPage: false,
  canResumeIdleSession: true,
  canActivateWhileHostOpen: true,
}

function createRegistry(): RoomSessionRegistry {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-room-session-registry-'))
  roots.push(root)
  return new RoomSessionRegistry(path.join(root, 'runtime', 'room-session-registry.json'))
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('Room Agent session registry', () => {
  it('keeps Docker Room state outside disposable runtime and migrates a live registration', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-docker-room-state-'))
    roots.push(root)
    const runtime = path.join(root, 'runtime')
    fs.mkdirSync(runtime)
    const legacy = path.join(runtime, 'room-session-registry.json')
    fs.writeFileSync(legacy, 'legacy-state', { mode: 0o600 })
    const durable = resolveRoomStateFile('room-session-registry.json', { stateDir: root, supervisor: 'docker' })
    expect(durable).toBe(path.join(root, 'room-state', 'room-session-registry.json'))
    expect(fs.readFileSync(durable, 'utf8')).toBe('legacy-state')
    fs.rmSync(runtime, { recursive: true })
    expect(resolveRoomStateFile('room-session-registry.json', { stateDir: root, supervisor: 'docker' }))
      .toBe(durable)
    expect(fs.readFileSync(durable, 'utf8')).toBe('legacy-state')
    expect(resolveRoomStateFile('room-host-session-observations.json', { stateDir: root, supervisor: 'docker' }))
      .toBe(path.join(root, 'room-state', 'room-host-session-observations.json'))
    expect(resolveRoomStateFile('room-session-registry.json', { stateDir: root, supervisor: 'systemd' }))
      .toBe(legacy)
  })

  it('rejects symlinked legacy Docker Room state', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-docker-room-symlink-'))
    roots.push(root)
    const runtime = path.join(root, 'runtime')
    fs.mkdirSync(runtime)
    fs.symlinkSync(path.join(root, 'elsewhere'), path.join(runtime, 'room-session-registry.json'))
    expect(() => resolveRoomStateFile('room-session-registry.json', { stateDir: root, supervisor: 'docker' }))
      .toThrow('unsafe_legacy_room_state')
  })

  it('atomically replaces the only live owner and never reopens the retired registration', () => {
    const registry = createRegistry()
    const register = (id: string) => registry.register({
      machineId: 'machine_1', runtimeAdapter: 'codex', sourceSessionKey: id,
      nianSessionId: id, hostProcessIdentity: 'daemon:one', capabilities,
    })
    const old = register('old')
    const next = register('next')
    const binding = { bindingId: 'binding_one', roomId: 'room_one',
      agentIdentityId: 'agent_one', agentMembershipId: 'member_one', status: 'active' as const }
    registry.setBinding({ ...binding, registryKey: old.registryKey })
    expect(() => registry.setBinding({ ...binding, registryKey: next.registryKey }))
      .toThrow('A Room binding can have only one live session.')
    registry.setBinding({ ...binding, registryKey: next.registryKey, replaceOwner: true, initialSequence: '135' })
    const restored = new RoomSessionRegistry(registry.filePath)
    expect(restored.list().filter((record) => record.binding?.status === 'active')).toHaveLength(1)
    expect(restored.getByRegistryKey(old.registryKey)).toMatchObject({
      lifecycleState: 'closed', registrationEpoch: old.registrationEpoch + 1,
      binding: { status: 'detached', activationQueue: [], activeActivation: null },
    })
    expect(restored.getByNianSessionId('next')?.binding).toMatchObject({
      lastDeliveredSequence: '135', lastActivatedSequence: '135',
    })
    expect(() => register('old')).toThrow('retired session')
    expect(() => registry.setBinding({ ...binding, registryKey: old.registryKey })).toThrow('retired session')
    registry.advanceCursor({ registryKey: next.registryKey, cursor: 'delivered', sequence: '140' })
    registry.setBinding({ ...binding, registryKey: next.registryKey, replaceOwner: true, initialSequence: '150' })
    expect(registry.getByRegistryKey(next.registryKey)?.binding?.lastDeliveredSequence).toBe('140')
  })

  it('counts a retried Room cause only once across process restarts', () => {
    const registry = createRegistry()
    const record = registry.register({ machineId: 'machine_1', runtimeAdapter: 'codex',
      sourceSessionKey: 'native', nianSessionId: 'nian', hostProcessIdentity: 'daemon:one', capabilities })
    registry.setBinding({ registryKey: record.registryKey, bindingId: 'binding_one', roomId: 'room_one',
      agentIdentityId: 'agent_one', agentMembershipId: 'member_one', status: 'active' })
    const claim = { registryKey: record.registryKey, causeMessageId: 'same-message',
      windowMs: 60_000, maxActivations: 1, pauseMs: 60_000 }
    expect(registry.claimActivation(claim).allowed).toBe(true)
    const restored = new RoomSessionRegistry(registry.filePath)
    for (let attempt = 0; attempt < 10; attempt++) expect(restored.claimActivation(claim).allowed).toBe(true)
    expect(restored.getByRegistryKey(record.registryKey)?.binding?.loopBreaker.activationCount).toBe(1)
    expect(restored.claimActivation({ ...claim, causeMessageId: 'different-message' }).allowed).toBe(false)
  })

  it('isolates identical native session ids across Codex, Claude Code and WorkBuddy', () => {
    const registry = createRegistry()
    const records = (['codex', 'claude_code', 'workbuddy'] as const).map((runtimeAdapter, index) =>
      registry.register({
        machineId: 'machine_1',
        runtimeAdapter,
        sourceSessionKey: 'same-native-id',
        nianSessionId: `nian_${index + 1}`,
        hostProcessIdentity: `${runtimeAdapter}:pid-${index + 1}:start-1`,
        capabilities,
      }),
    )
    expect(new Set(records.map((record) => record.registryKey)).size).toBe(3)
    expect(registry.list()).toHaveLength(3)
  })

  it('keeps Binding, queue and cursors independent when three Agents share one Room', () => {
    const registry = createRegistry()
    const records = (['codex', 'claude_code', 'workbuddy'] as const).map(
      (runtimeAdapter, index) => {
        const record = registry.register({
          machineId: 'machine_1',
          runtimeAdapter,
          sourceSessionKey: `${runtimeAdapter}-session`,
          nianSessionId: `nian_${index + 1}`,
          hostProcessIdentity: `${runtimeAdapter}:pid-${index + 1}:start-1`,
          capabilities,
        })
        return registry.setBinding({
          registryKey: record.registryKey,
          bindingId: `binding_${index + 1}`,
          roomId: 'room_shared',
          agentIdentityId: `agent_${index + 1}`,
          agentMembershipId: `membership_${index + 1}`,
          status: 'active',
        })
      },
    )
    registry.advanceCursor({
      registryKey: records[0]!.registryKey,
      cursor: 'delivered',
      sequence: '12',
    })
    registry.enqueueActivation(records[1]!.registryKey, {
      causeMessageId: 'message_12',
      rootCauseMessageId: 'message_12',
      sequence: '12',
      hopCount: 0,
      enqueuedAt: new Date().toISOString(),
      attempts: 0,
    })

    expect(registry.getByNianSessionId('nian_1')?.binding).toMatchObject({
      bindingId: 'binding_1',
      lastDeliveredSequence: '12',
      activationQueue: [],
    })
    expect(registry.getByNianSessionId('nian_2')?.binding).toMatchObject({
      bindingId: 'binding_2',
      lastDeliveredSequence: '0',
      activationQueue: [expect.objectContaining({ causeMessageId: 'message_12' })],
    })
    expect(registry.getByNianSessionId('nian_3')?.binding).toMatchObject({
      bindingId: 'binding_3',
      lastDeliveredSequence: '0',
      activationQueue: [],
    })
  })

  it('restores exact bindings after restart without relying on registration order', () => {
    const registry = createRegistry()
    const claude = registry.register({
      machineId: 'machine_1',
      runtimeAdapter: 'claude_code',
      sourceSessionKey: 'claude-session',
      nianSessionId: 'nian_claude',
      hostProcessIdentity: 'claude:pid-1:start-1',
      capabilities,
    })
    registry.setBinding({
      registryKey: claude.registryKey,
      bindingId: 'binding_claude',
      roomId: 'room_1',
      agentIdentityId: 'agent_claude',
      agentMembershipId: 'membership_claude',
      status: 'active',
    })

    const restarted = new RoomSessionRegistry(registry.filePath)
    const restored = restarted.getBySource({
      machineId: 'machine_1',
      runtimeAdapter: 'claude_code',
      sourceSessionKey: 'claude-session',
    })
    expect(restored).toMatchObject({
      nianSessionId: 'nian_claude',
      panelContextKey: 'nian_claude',
      binding: { bindingId: 'binding_claude', roomId: 'room_1' },
    })
    if (process.platform !== 'win32') {
      expect(fs.statSync(path.dirname(registry.filePath)).mode & 0o777).toBe(0o700)
      expect(fs.statSync(registry.filePath).mode & 0o777).toBe(0o600)
    }
  })

  it('clears deferred mention context when the activation mode changes', () => {
    const registry = createRegistry()
    const record = registry.register({
      machineId: 'machine_1',
      runtimeAdapter: 'codex',
      sourceSessionKey: 'codex-mode-session',
      nianSessionId: 'nian_mode',
      hostProcessIdentity: 'codex:pid-mode:start-1',
      capabilities,
    })
    const binding = {
      registryKey: record.registryKey,
      bindingId: 'binding_mode',
      roomId: 'room_1',
      agentIdentityId: 'agent_mode',
      agentMembershipId: 'membership_mode',
      status: 'active' as const,
    }
    registry.setBinding({ ...binding, activationMode: 'mention_only' })
    registry.appendMentionContext(record.registryKey, {
      sequence: '1',
      deliveryText: '[群消息] <User>\nold context',
    })

    registry.setBinding({ ...binding, activationMode: 'auto_follow' })
    expect(registry.getByRegistryKey(record.registryKey)?.binding?.mentionContext).toEqual([])

    registry.setBinding({ ...binding, activationMode: 'mention_only' })
    expect(registry.getByRegistryKey(record.registryKey)?.binding?.mentionContext).toEqual([])
  })

  it('increments registration epoch for a restarted host process while preserving exact Binding', () => {
    const registry = createRegistry()
    const first = registry.register({
      machineId: 'machine_1',
      runtimeAdapter: 'workbuddy',
      sourceSessionKey: 'workbuddy-session',
      nianSessionId: 'nian_workbuddy',
      hostProcessIdentity: 'workbuddy:pid-1:start-1',
      capabilities,
    })
    registry.setBinding({
      registryKey: first.registryKey,
      bindingId: 'binding_workbuddy',
      roomId: 'room_1',
      agentIdentityId: 'agent_workbuddy',
      agentMembershipId: 'membership_workbuddy',
      status: 'active',
    })
    const restarted = registry.register({
      machineId: 'machine_1',
      runtimeAdapter: 'workbuddy',
      sourceSessionKey: 'workbuddy-session',
      nianSessionId: 'nian_workbuddy',
      hostProcessIdentity: 'workbuddy:pid-2:start-2',
      capabilities,
    })
    expect(restarted.registrationEpoch).toBe(2)
    expect(restarted.binding?.bindingId).toBe('binding_workbuddy')
  })

  it('refuses a second active Room instead of guessing or silently replacing Binding', () => {
    const registry = createRegistry()
    const record = registry.register({
      machineId: 'machine_1',
      runtimeAdapter: 'codex',
      sourceSessionKey: 'codex-session',
      nianSessionId: 'nian_codex',
      hostProcessIdentity: 'codex:pid-1:start-1',
      capabilities,
    })
    registry.setBinding({
      registryKey: record.registryKey,
      bindingId: 'binding_1',
      roomId: 'room_1',
      agentIdentityId: 'agent_1',
      agentMembershipId: 'membership_1',
      status: 'active',
    })
    expect(() =>
      registry.setBinding({
        registryKey: record.registryKey,
        bindingId: 'binding_2',
        roomId: 'room_2',
        agentIdentityId: 'agent_2',
        agentMembershipId: 'membership_2',
        status: 'active',
      }),
    ).toThrowError(expect.objectContaining({ code: 'session_already_bound' }))
  })

  it('prevents the same Shennian conversation from being attached to two native Sessions', () => {
    const registry = createRegistry()
    registry.register({
      machineId: 'machine_1',
      runtimeAdapter: 'codex',
      sourceSessionKey: 'codex-session',
      nianSessionId: 'nian_shared',
      hostProcessIdentity: 'codex:pid-1:start-1',
      capabilities,
    })
    expect(() =>
      registry.register({
        machineId: 'machine_1',
        runtimeAdapter: 'claude_code',
        sourceSessionKey: 'claude-session',
        nianSessionId: 'nian_shared',
        hostProcessIdentity: 'claude:pid-2:start-1',
        capabilities,
      }),
    ).toThrowError(expect.objectContaining({ code: 'nian_session_already_registered' }))
  })

  it('serializes work within one Session while allowing other Sessions to progress independently', async () => {
    const registry = createRegistry()
    const first = registry.register({
      machineId: 'machine_1',
      runtimeAdapter: 'codex',
      sourceSessionKey: 'codex-session',
      nianSessionId: 'nian_1',
      hostProcessIdentity: 'codex:pid-1:start-1',
      capabilities,
    })
    const second = registry.register({
      machineId: 'machine_1',
      runtimeAdapter: 'claude_code',
      sourceSessionKey: 'claude-session',
      nianSessionId: 'nian_2',
      hostProcessIdentity: 'claude:pid-2:start-1',
      capabilities,
    })
    const order: string[] = []
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const firstRun = registry.runExclusive(first.registryKey, async () => {
      order.push('first:start')
      await firstGate
      order.push('first:end')
    })
    const queuedSameSession = registry.runExclusive(first.registryKey, async () => {
      order.push('same-session')
    })
    const parallelOtherSession = registry.runExclusive(second.registryKey, async () => {
      order.push('other-session')
    })
    await parallelOtherSession
    expect(order).toEqual(['first:start', 'other-session'])
    releaseFirst()
    await Promise.all([firstRun, queuedSameSession])
    expect(order).toEqual(['first:start', 'other-session', 'first:end', 'same-session'])
  })

  it('rate-limits each Binding independently and persists the temporary pause', () => {
    const registry = createRegistry()
    const record = registry.register({
      machineId: 'machine_1',
      runtimeAdapter: 'codex',
      sourceSessionKey: 'codex-rate',
      nianSessionId: 'nian_rate',
      hostProcessIdentity: 'codex:rate',
      capabilities,
    })
    registry.setBinding({
      registryKey: record.registryKey,
      bindingId: 'binding_rate',
      roomId: 'room_rate',
      agentIdentityId: 'agent_rate',
      agentMembershipId: 'membership_rate',
      status: 'active',
    })
    const now = new Date('2026-08-23T00:00:00.000Z')
    for (let index = 0; index < 2; index += 1) {
      expect(
        registry.claimActivation({
          registryKey: record.registryKey,
          windowMs: 60_000,
          maxActivations: 2,
          pauseMs: 300_000,
          now,
        }).allowed,
      ).toBe(true)
    }
    expect(
      registry.claimActivation({
        registryKey: record.registryKey,
        windowMs: 60_000,
        maxActivations: 2,
        pauseMs: 300_000,
        now,
      }),
    ).toEqual({
      allowed: false,
      pausedUntil: '2026-08-23T00:05:00.000Z',
      newlyPaused: true,
    })
    expect(
      new RoomSessionRegistry(registry.filePath).getByRegistryKey(record.registryKey)?.binding
        ?.loopBreaker.pausedUntil,
    ).toBe('2026-08-23T00:05:00.000Z')
  })

  it('marks a persisted dispatch interrupted without requeueing it on restart', () => {
    const registry = createRegistry()
    const record = registry.register({
      machineId: 'machine_1',
      runtimeAdapter: 'codex',
      sourceSessionKey: 'codex-idempotent',
      nianSessionId: 'nian_idempotent',
      hostProcessIdentity: 'codex:idempotent',
      capabilities,
    })
    registry.setBinding({
      registryKey: record.registryKey,
      bindingId: 'binding_idempotent',
      roomId: 'room_1',
      agentIdentityId: 'agent_1',
      agentMembershipId: 'member_1',
      status: 'active',
    })
    registry.enqueueActivation(record.registryKey, {
      causeMessageId: 'message_1',
      rootCauseMessageId: 'message_1',
      sequence: '1',
      hopCount: 0,
      enqueuedAt: new Date().toISOString(),
      attempts: 0,
    })
    registry.markActivationDispatching(record.registryKey, 'message_1')
    const restarted = new RoomSessionRegistry(
      registry.filePath,
      new Date('2026-08-28T01:02:03.000Z'),
    )
    expect(restarted.getByRegistryKey(record.registryKey)?.binding).toMatchObject({
      activationQueue: [],
      activeActivation: {
        causeMessageId: 'message_1',
        attempts: 0,
        dispatchState: 'interrupted',
        interruptedAt: '2026-08-28T01:02:03.000Z',
      },
    })
    expect(() =>
      restarted.retryActiveActivation({
        registryKey: record.registryKey,
        maxAttempts: 3,
        pauseMs: 300_000,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'activation_interrupted_requires_explicit_retry',
      }),
    )
    expect(
      new RoomSessionRegistry(
        registry.filePath,
        new Date('2026-08-28T02:03:04.000Z'),
      ).getByRegistryKey(record.registryKey)?.binding,
    ).toMatchObject({
      activationQueue: [],
      activeActivation: {
        causeMessageId: 'message_1',
        interruptedAt: '2026-08-28T01:02:03.000Z',
      },
    })
  })
})
