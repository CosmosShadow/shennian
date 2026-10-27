// @covers src/room/activation-service.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  ManagedAgentPermissionPolicy,
  RoomActivationMode,
  RoomMessageView,
  RoomRuntimeAdapter,
} from '@shennian/wire'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RoomActivationService,
  type RoomActivationContext,
  type RoomConversationQueueInput,
} from '../room/activation-service.js'
import type { RoomActivationAuditEvent } from '../room/activation-audit.js'
import { RoomHostSessionObservationStore } from '../room/host-session-observations.js'
import { RoomSessionRegistry } from '../room/session-registry.js'
import {
  compileManagedAgentPolicy,
  type CompiledManagedAgentPolicy,
} from '../security/managed-agent-policy.js'
import { CODEX_MANAGED_RUNTIME_SECURITY } from '../agents/codex-managed-permissions.js'
import { testPermissionPolicy } from './room-activation-test-fixtures.js'
import { OWNER_DIRECT_TURN_OPTIONS, SCHEDULED_ROOM_TURN_OPTIONS } from '../session/queue-helpers.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('RoomActivationService', () => {
  let registry: RoomSessionRegistry
  let observations: RoomHostSessionObservationStore
  let enqueueConversationBatch: ReturnType<
    typeof vi.fn<(inputs: RoomConversationQueueInput[]) => Promise<void>>
  >
  let audit: { record: ReturnType<typeof vi.fn<(event: RoomActivationAuditEvent) => void>> }
  let service: RoomActivationService

  beforeEach(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-room-activation-'))
    roots.push(root)
    registry = new RoomSessionRegistry(path.join(root, 'registry.json'))
    observations = new RoomHostSessionObservationStore(path.join(root, 'observations.json'))
    enqueueConversationBatch = vi.fn(async (_inputs: RoomConversationQueueInput[]) => {})
    audit = { record: vi.fn((_event: RoomActivationAuditEvent) => {}) }
    service = new RoomActivationService({
      registry,
      observations,
      enqueueConversationBatch,
      issueManagedRoomContext: () => `mrc_${'a'.repeat(43)}`,
      resolveManagedAgentPolicy: async ({ workDir, permissionPolicy }) =>
        compiledPolicy(workDir, permissionPolicy),
      audit,
    })
  })

  it('resolves an unbound owner session without issuing any Room capability', async () => {
    const prepareUnboundDirectTurn = vi.fn(async () => null)
    const issueManagedRoomContext = vi.fn(() => 'must-not-be-issued')
    service = new RoomActivationService({ registry, observations, enqueueConversationBatch,
      prepareUnboundDirectTurn, issueManagedRoomContext })
    expect(await service.prepareDirectConversationTurn('unbound', OWNER_DIRECT_TURN_OPTIONS)).toBeNull()
    expect(prepareUnboundDirectTurn).toHaveBeenCalledWith('unbound')
    prepareUnboundDirectTurn.mockClear()
    expect(await service.prepareDirectConversationTurn('unbound', SCHEDULED_ROOM_TURN_OPTIONS)).toBeNull()
    expect(await service.prepareDirectConversationTurn('unbound', {
      roomOrigin: { registryKey: 'a'.repeat(64), registrationEpoch: 1, bindingId: 'binding', roomId: 'room' },
    })).toBeNull()
    expect(prepareUnboundDirectTurn).not.toHaveBeenCalled()
    expect(issueManagedRoomContext).not.toHaveBeenCalled()
  })

  it('also resolves a native registration with no Room binding through standalone authority', async () => {
    const registration = register('codex', 'native-unbound', 'nian-unbound', 'member-unbound', 'auto_follow')
    const lookup = vi.spyOn(registry, 'getByNianSessionId').mockReturnValue({ ...registration, binding: null })
    const prepareUnboundDirectTurn = vi.fn(async () => null)
    service = new RoomActivationService({ registry, observations, enqueueConversationBatch,
      prepareUnboundDirectTurn, issueManagedRoomContext: () => 'must-not-be-issued' })
    expect(await service.prepareDirectConversationTurn('nian-unbound', OWNER_DIRECT_TURN_OPTIONS)).toBeNull()
    expect(prepareUnboundDirectTurn).toHaveBeenCalledWith('nian-unbound')
    lookup.mockRestore()
  })

  it('only enqueues Room input and does not create or wait on Room turn state', async () => {
    const registration = register(
      'codex',
      'native-queue',
      'nian-queue',
      'member-queue',
      'auto_follow',
    )
    observe(registration, 'active')

    await service.processMessages(
      'room_1',
      [
        message({ id: 'message_1', sequence: '1', text: 'first' }),
        message({ id: 'message_2', sequence: '2', text: 'second' }),
      ],
      registry.list(),
      testContext(registry.list()),
    )

    expect(enqueueConversationBatch).toHaveBeenCalledTimes(1)
    const queued = enqueueConversationBatch.mock.calls[0]![0]
    expect(queued).toHaveLength(2)
    expect(queued.map((item) => item.params.text)).toEqual([
      '[群消息] <User>\nfirst',
      '[群消息] <User>\nsecond',
    ])
    expect(queued.map((item) => item.params.sessionMode)).toEqual(['standard', 'standard'])
    expect(queued.map((item) => item.params.clientMessageId)).toEqual([
      'room-activation-binding-member-queue-message_1',
      'room-activation-binding-member-queue-message_2',
    ])
    expect(queued.map((item) => item.context.causeMessageId)).toEqual(['message_1', 'message_2'])
    expect(registry.getByRegistryKey(registration.registryKey)?.binding).toMatchObject({
      lastActivatedSequence: '2',
      activationQueue: [],
      activeActivation: null,
    })
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        causeMessageId: 'message_2',
        outcome: 'queued',
        reason: 'conversation_queue',
      }),
    )
  })

  it('enqueues a structured Room event directly without adding response instructions', async () => {
    const registration = register(
      'codex',
      'native-event',
      'nian-event',
      'member-event',
      'auto_follow',
    )
    observe(registration, 'active')

    await service.processMessages(
      'room_1',
      [message({
        id: 'event_1',
        sequence: '1',
        kind: 'system',
        text: '笠夏 joined the Room.',
        systemEvent: {
          type: 'membership_joined',
          subjectMembershipId: 'human_new',
          subjectPrincipalType: 'human',
        },
      })],
      registry.list(),
      testContext(registry.list()),
    )

    const queued = enqueueConversationBatch.mock.calls[0]![0]
    expect(queued).toHaveLength(1)
    expect(queued[0]!.params.text).toBe('[群事件]\n笠夏 joined the Room.')
    expect(queued[0]!.params.text).not.toContain('判断是否需要回应')
  })

  it('leaves Room messages unconsumed while a next-turn configuration swap is pending', async () => {
    const registration = register(
      'codex',
      'native-pending-config',
      'nian-pending-config',
      'member-pending-config',
      'auto_follow',
    )
    observe(registration, 'active')
    const context = testContext(registry.list())
    context.agentsByIdentityId[registration.binding!.agentIdentityId]!.configurationPending = true

    await service.processMessages('room_1', [message({ sequence: '1' })], registry.list(), context)

    expect(enqueueConversationBatch).toHaveBeenCalledWith([])
    expect(registry.getByRegistryKey(registration.registryKey)?.binding).toMatchObject({
      lastActivatedSequence: '0',
    })
  })

  it('prepares the current trusted prompt and per-turn send capability when the session dequeues', async () => {
    const registration = register(
      'codex',
      'native-prompt',
      'nian-prompt',
      'member-prompt',
      'auto_follow',
    )
    observe(registration, 'idle')
    const issueManagedRoomContext = vi.fn(() => `mrc_${'b'.repeat(43)}`)
    const resolveManagedAgentPolicy = vi.fn(async ({ workDir, permissionPolicy }) =>
      compiledPolicy(workDir, permissionPolicy),
    )
    service = new RoomActivationService({
      registry,
      observations,
      enqueueConversationBatch,
      issueManagedRoomContext,
      resolveManagedAgentPolicy,
      audit,
    })
    await service.processMessages(
      'room_1',
      [message({ text: 'private room text' })],
      registry.list(),
      testContext(registry.list()),
    )
    const queued = enqueueConversationBatch.mock.calls[0]![0]

    const prepared = await service.prepareConversationTurn(queued.map((item) => item.context))

    expect(prepared).toMatchObject({
      roomContextRegistryKey: registration.registryKey,
      managedRoomContextToken: `mrc_${'b'.repeat(43)}`,
      systemPrompt: expect.stringContaining('[智能体身份]'),
    })
    expect(prepared.systemPrompt).toContain('名称：Support')
    expect(prepared.systemPrompt).toContain('公开职责：Answer support questions')
    expect(prepared.systemPrompt).toContain('[神念运行权限]')
    expect(prepared.managedAgentPolicy.adapterPolicy.fileAccess).toBe('workspace-write')
    expect(prepared.managedRoomPromptSnapshot).toMatchObject({
      agentConfigurationVersion: 7,
      enforcementLevel: 'hard',
      runtimePermissionPolicyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      resolvedWorkDirHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(prepared.systemPrompt).not.toContain('message_1')
    expect(issueManagedRoomContext).toHaveBeenCalledWith(
      registration.registryKey,
      'message_1',
      undefined,
      undefined,
    )
    expect(resolveManagedAgentPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionPolicy: testPermissionPolicy(),
        permissionConfirmation: null,
      }),
    )
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'activated',
        reason: 'conversation_queue_dispatch',
      }),
    )
  })

  it.each(['provider/deepseek-flash', null, undefined])('uses the latest per-session effective model %s at the turn boundary', async (effectiveModelId) => {
    const registration = register('codex', 'native-model', 'nian-model', 'member-model', 'auto_follow')
    observe(registration, 'idle')
    const loadContext = vi.fn(async () => ({
      ...testContext(registry.list()),
      effectiveModelsBySessionId: effectiveModelId !== undefined
        ? { 'nian-model': effectiveModelId, 'another-session': 'wrong/model' }
        : undefined,
    }))
    service = new RoomActivationService({
      registry, observations, enqueueConversationBatch, loadContext,
      issueManagedRoomContext: () => `mrc_${'c'.repeat(43)}`,
      resolveManagedAgentPolicy: async ({ workDir, permissionPolicy }) => compiledPolicy(workDir, permissionPolicy),
    })
    await service.processMessages('room_1', [message()], registry.list(), testContext(registry.list()))
    const queued = enqueueConversationBatch.mock.calls[0]![0]
    const prepared = await service.prepareConversationTurn(queued.map((item) => item.context))
    expect(prepared.effectiveModelId).toBe(effectiveModelId)
    const direct = await service.prepareDirectConversationTurn('nian-model', OWNER_DIRECT_TURN_OPTIONS)
    expect(direct?.effectiveModelId).toBe(effectiveModelId)
    expect(loadContext).toHaveBeenCalledTimes(2)
  })

  it('prepares owner-entered text from the same managed binding and policy', async () => {
    const registration = register(
      'codex',
      'native-direct',
      'nian-direct',
      'member-direct',
      'auto_follow',
    )
    observe(registration, 'idle')
    const issueManagedRoomContext = vi.fn(() => `mrc_${'c'.repeat(43)}`)
    service = new RoomActivationService({
      registry,
      observations,
      enqueueConversationBatch,
      issueManagedRoomContext,
      loadContext: async () => testContext(registry.list()),
      resolveManagedAgentPolicy: async ({ workDir, permissionPolicy }) =>
        compiledPolicy(workDir, permissionPolicy),
      audit,
    })

    const prepared = await service.prepareDirectConversationTurn('nian-direct', OWNER_DIRECT_TURN_OPTIONS)

    expect(prepared).toMatchObject({
      agentType: 'codex',
      workDir: '/tmp/project-codex',
      agentSessionId: 'native-direct',
      roomContextRegistryKey: registration.registryKey,
      managedRoomContextToken: `mrc_${'c'.repeat(43)}`,
      systemPrompt: expect.stringContaining('Owner 与 Manager 的私有对话'),
    })
    expect(prepared?.systemPrompt).not.toContain('[受管群聊]')
    expect(prepared?.systemPrompt).not.toContain('[当前群聊]')
    expect(prepared?.systemPrompt).toContain('[神念运行权限]')
    expect(prepared?.systemPrompt).toContain('[智能体私有系统提示词]\nBe concise.')
    expect(prepared?.systemPrompt).toContain('显式发送到它所属的 Room')
    expect(prepared?.systemPrompt).toContain('不能读取 Room 历史')
    expect(issueManagedRoomContext).toHaveBeenCalledWith(registration.registryKey, undefined, ['send'], false)
    const scheduled = await service.prepareDirectConversationTurn('nian-direct', SCHEDULED_ROOM_TURN_OPTIONS)
    expect(scheduled?.systemPrompt).toContain('定时任务现在触发')
    expect(scheduled?.systemPrompt).toContain('不要再次调用定时任务创建工具')
    expect(scheduled?.systemPrompt).toContain('shennian_room_send 工具')
    expect(scheduled?.systemPrompt).not.toContain('Owner 与 Manager 的私有对话')
    expect(issueManagedRoomContext).toHaveBeenLastCalledWith(registration.registryKey, undefined, ['send'], false)
    expect(audit.record).not.toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'conversation_queue_dispatch' }),
    )

    const origin = {
      registryKey: registration.registryKey,
      registrationEpoch: registration.registrationEpoch,
      bindingId: registration.binding!.bindingId,
      roomId: registration.binding!.roomId,
    }
    expect(
      await service.prepareDirectConversationTurn('nian-direct', {
        roomOrigin: origin,
        allowedRoomActions: ['send'],
        managerEvent: true,
      }),
    ).not.toBeNull()
    registry.detachBinding(registration.registryKey)
    registry.setBinding({
      registryKey: registration.registryKey,
      bindingId: 'binding-rebound',
      roomId: 'room_2',
      agentIdentityId: 'identity-rebound',
      agentMembershipId: 'member-rebound',
      status: 'active',
      activationMode: 'auto_follow',
    })
    expect(
      await service.prepareDirectConversationTurn('nian-direct', {
        roomOrigin: origin,
        allowedRoomActions: ['send'],
        managerEvent: true,
      }),
    ).toBeNull()
  })

  it('rebuilds the prompt from the current Binding after daemon restart', async () => {
    const registration = register(
      'codex',
      'native-restart',
      'nian-restart',
      'member-restart',
      'auto_follow',
    )
    observe(registration, 'idle')
    await service.processMessages(
      'room_1',
      [message({})],
      registry.list(),
      testContext(registry.list()),
    )
    const queued = enqueueConversationBatch.mock.calls[0]![0]
    const loadContext = vi.fn(async () => testContext(registry.list()))
    const restarted = new RoomActivationService({
      registry,
      observations,
      enqueueConversationBatch,
      issueManagedRoomContext: () => `mrc_${'a'.repeat(43)}`,
      loadContext,
      resolveManagedAgentPolicy: async ({ workDir, permissionPolicy }) =>
        compiledPolicy(workDir, permissionPolicy),
    })

    const prepared = await restarted.prepareConversationTurn(queued.map((item) => item.context))

    expect(loadContext).toHaveBeenCalledWith(
      expect.objectContaining({
        registryKey: registration.registryKey,
      }),
    )
    expect(prepared.systemPrompt).toContain('名称：Support')
  })

  it('fails closed when the trusted Room status omits the Agent policy', async () => {
    const registration = register(
      'codex',
      'native-policy-missing',
      'nian-policy-missing',
      'member-policy-missing',
      'auto_follow',
    )
    observe(registration, 'idle')
    const context = testContext(registry.list()) as RoomActivationContext
    const identity = context.agentsByIdentityId?.[registration.binding!.agentIdentityId]
    if (identity) delete (identity as Partial<typeof identity>).permissionPolicy
    await service.processMessages('room_1', [message({})], registry.list(), context)
    const queued = enqueueConversationBatch.mock.calls[0]![0]

    await expect(
      service.prepareConversationTurn(queued.map((item) => item.context)),
    ).rejects.toThrow('managed_agent_policy_missing')
  })

  it('queues an active managed Agent in Manager mode', async () => {
    const registration = register(
      'codex',
      'native-manager-activation',
      'nian-manager-activation',
      'member-manager-activation',
      'auto_follow',
    )
    observe(registration, 'idle')
    const context = testContext(registry.list()) as RoomActivationContext
    const identity = context.agentsByIdentityId?.[registration.binding!.agentIdentityId]
    if (identity) identity.sessionMode = 'manager'

    await service.processMessages('room_1', [message({})], registry.list(), context)
    expect(enqueueConversationBatch).toHaveBeenCalledWith([
      expect.objectContaining({ params: expect.objectContaining({ sessionMode: 'manager' }) }),
    ])
  })

  it('prepares a queued Room turn in Manager mode', async () => {
    const registration = register(
      'codex',
      'native-manager-prepare',
      'nian-manager-prepare',
      'member-manager-prepare',
      'auto_follow',
    )
    observe(registration, 'idle')
    await service.processMessages(
      'room_1',
      [message({})],
      registry.list(),
      testContext(registry.list()),
    )
    const queued = enqueueConversationBatch.mock.calls[0]![0]
    const managerContext = testContext(registry.list()) as RoomActivationContext
    const identity = managerContext.agentsByIdentityId?.[registration.binding!.agentIdentityId]
    if (identity) {
      identity.sessionMode = 'manager'
      identity.managerConfig = null
    }
    const preparing = new RoomActivationService({
      registry,
      observations,
      enqueueConversationBatch,
      issueManagedRoomContext: () => `mrc_${'a'.repeat(43)}`,
      loadContext: async () => managerContext,
      resolveManagedAgentPolicy: async ({ workDir, permissionPolicy }) =>
        compiledPolicy(workDir, permissionPolicy),
    })

    await expect(
      preparing.prepareConversationTurn(queued.map((item) => item.context)),
    ).resolves.toMatchObject({
      sessionMode: 'manager',
      managerConfig: {
        defaultWorkerAgentType: 'codex',
        defaultWorkerModelId: null,
      },
      managerDefaultWorkerAgentType: 'codex',
      managerDefaultWorkerModelId: null,
      managedRoomPromptSnapshot: { managedRoomPolicyVersion: 'managed-room-surface-v9' },
    })
  })

  it('fails closed when the Agent policy version is missing', async () => {
    const registration = register(
      'codex',
      'native-policy-version',
      'nian-policy-version',
      'member-policy-version',
      'auto_follow',
    )
    observe(registration, 'idle')
    const context = testContext(registry.list()) as RoomActivationContext
    const identity = context.agentsByIdentityId?.[registration.binding!.agentIdentityId]
    if (identity)
      identity.permissionPolicy = {
        ...testPermissionPolicy(),
        version: undefined,
      } as unknown as typeof identity.permissionPolicy
    const strict = new RoomActivationService({
      registry,
      observations,
      enqueueConversationBatch,
      issueManagedRoomContext: () => `mrc_${'a'.repeat(43)}`,
      resolveManagedAgentPolicy: strictTestPolicyResolver,
    })
    await strict.processMessages('room_1', [message({})], registry.list(), context)
    const queued = enqueueConversationBatch.mock.calls[0]![0]

    await expect(
      strict.prepareConversationTurn(queued.map((item) => item.context)),
    ).rejects.toThrow('managed_agent_policy_invalid')
  })

  it('fails closed when the managed workspace cannot be resolved to a real directory', async () => {
    const registration = register(
      'codex',
      'native-realpath-missing',
      'nian-realpath-missing',
      'member-realpath-missing',
      'auto_follow',
    )
    observe(registration, 'idle', path.join(roots[0]!, 'missing-workspace'))
    const context = testContext(registry.list())
    const strict = new RoomActivationService({
      registry,
      observations,
      enqueueConversationBatch,
      issueManagedRoomContext: () => `mrc_${'a'.repeat(43)}`,
      resolveManagedAgentPolicy: strictTestPolicyResolver,
    })
    await strict.processMessages('room_1', [message({})], registry.list(), context)
    const queued = enqueueConversationBatch.mock.calls[0]![0]

    await expect(
      strict.prepareConversationTurn(queued.map((item) => item.context)),
    ).rejects.toThrow('managed_agent_workdir_unavailable')
  })

  it('moves legacy pending Room items into the Session queue and retires old turn state', async () => {
    const registration = register(
      'codex',
      'native-legacy',
      'nian-legacy',
      'member-legacy',
      'auto_follow',
    )
    observe(registration, 'idle')
    registry.enqueueActivation(registration.registryKey, {
      causeMessageId: 'message_active',
      rootCauseMessageId: 'message_active',
      sequence: '1',
      hopCount: 0,
      enqueuedAt: '2026-09-01T00:00:00.000Z',
      attempts: 0,
      deliveryText: '[群消息] <User>\nalready dispatched',
    })
    registry.markActivationDispatching(registration.registryKey, 'message_active')
    registry.enqueueActivation(registration.registryKey, {
      causeMessageId: 'message_pending',
      rootCauseMessageId: 'message_pending',
      sequence: '2',
      hopCount: 0,
      enqueuedAt: '2026-09-01T00:00:01.000Z',
      attempts: 0,
      deliveryText: '[群消息] <User>\nstill pending',
    })

    await service.processMessages('room_1', [], registry.list(), testContext(registry.list()))

    expect(enqueueConversationBatch.mock.calls[0]![0]).toEqual([
      expect.objectContaining({
        params: expect.objectContaining({
          text: '[群消息] <User>\nstill pending',
          clientMessageId: 'room-activation-binding-member-legacy-message_pending',
        }),
        context: expect.objectContaining({ causeMessageId: 'message_pending' }),
      }),
    ])
    expect(registry.getByRegistryKey(registration.registryKey)?.binding).toMatchObject({
      activationQueue: [],
      activeActivation: null,
    })
  })

  it('retires rather than forwards legacy pending items after the Binding pauses', async () => {
    const registration = register(
      'codex',
      'native-paused-legacy',
      'nian-paused-legacy',
      'member-paused-legacy',
      'auto_follow',
    )
    observe(registration, 'idle')
    registry.enqueueActivation(registration.registryKey, {
      causeMessageId: 'message_before_pause',
      rootCauseMessageId: 'message_before_pause',
      sequence: '1',
      hopCount: 0,
      enqueuedAt: '2026-09-01T00:00:00.000Z',
      attempts: 0,
      deliveryText: '[群消息] <User>\nshould never be forwarded',
    })
    registry.setBinding({
      registryKey: registration.registryKey,
      bindingId: registration.binding!.bindingId,
      roomId: registration.binding!.roomId,
      agentIdentityId: registration.binding!.agentIdentityId,
      agentMembershipId: registration.binding!.agentMembershipId,
      status: 'paused',
      activationMode: 'paused',
    })

    await service.processMessages('room_1', [], registry.list(), testContext(registry.list()))

    expect(enqueueConversationBatch).toHaveBeenCalledWith([])
    expect(registry.getByRegistryKey(registration.registryKey)?.binding).toMatchObject({
      status: 'paused',
      activationMode: 'paused',
      activationQueue: [],
      activeActivation: null,
    })
  })

  it('delivers attachment metadata without downloading files or exposing URLs', async () => {
    const registration = register(
      'codex',
      'native-attachments',
      'nian-attachments',
      'member-attachments',
      'auto_follow',
    )
    observe(registration, 'idle')

    await service.processMessages(
      'room_1',
      [
        message({
          text: '请按需查看',
          attachments: [
            {
              attachmentId: 'attachment_1',
              mediaKind: 'image',
              name: 'IMG_[8438].jpg',
              mimeType: 'image/jpeg',
              byteSize: String(5 * 1024 * 1024),
              sha256: 'a'.repeat(64),
              status: 'ready',
              downloadRef: 'shennian-room-attachment:attachment_1',
              downloadUrl: 'https://shennian.net/a/private-capability',
            },
          ],
        }),
      ],
      registry.list(),
      testContext(registry.list()),
    )

    const text = enqueueConversationBatch.mock.calls[0]![0][0]!.params.text
    expect(text).toContain('附件：IMG_\\[8438\\].jpg · 5 MB｜image/jpeg｜attachmentId=attachment_1')
    expect(text).not.toContain('private-capability')
    expect(text).not.toContain('sha256')
  })

  it('does not enqueue paused or unmentioned mention-only Sessions', async () => {
    const paused = register('codex', 'native-paused', 'nian-paused', 'member-paused', 'paused')
    const mentionOnly = register('workbuddy', 'native-wb', 'nian-wb', 'member-wb', 'mention_only')
    observe(paused, 'idle')
    observe(mentionOnly, 'idle')

    await service.processMessages(
      'room_1',
      [message({})],
      registry.list(),
      testContext(registry.list()),
    )

    expect(enqueueConversationBatch).toHaveBeenCalledWith([])
    expect(registry.list().map((item) => item.binding?.lastActivatedSequence)).toEqual(['1', '1'])
  })

  it('includes recent context once when a mention-only Agent is mentioned', async () => {
    const registration = register(
      'codex',
      'native-mention',
      'nian-mention',
      'member-mention',
      'mention_only',
    )
    observe(registration, 'idle')
    await service.processMessages(
      'room_1',
      [message({ text: 'first context' })],
      registry.list(),
      testContext(registry.list()),
    )
    expect(registry.getByRegistryKey(registration.registryKey)?.binding?.mentionContext).toEqual([
      { sequence: '1', deliveryText: '[群消息] <User>\nfirst context' },
    ])
    enqueueConversationBatch.mockClear()
    const trigger = {
      ...message({
        id: 'message_2',
        sequence: '2',
        text: '@Support please summarize',
        displayName: 'Manager',
      }),
      mentions: [
        { membershipId: 'member-mention', principalType: 'agent', displayName: 'Support' },
      ],
    } as RoomMessageView

    await service.processMessages(
      'room_1',
      [trigger],
      registry.list(),
      testContext(registry.list()),
    )

    expect(enqueueConversationBatch.mock.calls[0]![0][0]!.params.text).toBe(
      '[群消息]\n<User>\nfirst context\n\n<Manager>\n@Support please summarize',
    )
    expect(registry.getByRegistryKey(registration.registryKey)?.binding?.mentionContext).toEqual([])
  })

  it('does not consume mention context or advance cursors when durable enqueue fails', async () => {
    const registration = register(
      'codex',
      'native-failure',
      'nian-failure',
      'member-failure',
      'mention_only',
    )
    observe(registration, 'idle')
    registry.appendMentionContext(registration.registryKey, {
      sequence: '1',
      deliveryText: '[群消息] <User>\ncontext to keep',
    })
    registry.advanceCursor({
      registryKey: registration.registryKey,
      cursor: 'activated',
      sequence: '1',
    })
    const failing = new RoomActivationService({
      registry,
      observations,
      enqueueConversationBatch: vi.fn(async () => {
        throw new Error('disk full')
      }),
      issueManagedRoomContext: () => `mrc_${'a'.repeat(43)}`,
    })
    const trigger = {
      ...message({ id: 'message_2', sequence: '2', text: '@Support help' }),
      mentions: [
        { membershipId: 'member-failure', principalType: 'agent', displayName: 'Support' },
      ],
    } as RoomMessageView

    await expect(
      failing.processMessages('room_1', [trigger], registry.list(), testContext(registry.list())),
    ).rejects.toThrow('disk full')

    expect(registry.getByRegistryKey(registration.registryKey)?.binding).toMatchObject({
      lastActivatedSequence: '1',
      mentionContext: [{ sequence: '1', deliveryText: '[群消息] <User>\ncontext to keep' }],
    })
  })

  it('suppresses an Agent cascade beyond the maximum hop and audits it', async () => {
    const registration = register(
      'workbuddy',
      'native-loop',
      'nian-loop',
      'member-loop',
      'mention_only',
    )
    observe(registration, 'idle')
    const cascading = {
      ...message({ id: 'message_5', sequence: '5', principalType: 'agent' }),
      mentions: [{ membershipId: 'member-loop', principalType: 'agent', displayName: 'WB' }],
      activationCause: {
        causeMessageId: 'message_4',
        rootCauseMessageId: 'message_1',
        hopCount: 4,
      },
    } as RoomMessageView

    await service.processMessages(
      'room_1',
      [cascading],
      registry.list(),
      testContext(registry.list()),
    )

    expect(enqueueConversationBatch).toHaveBeenCalledWith([])
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'suppressed',
        reason: 'max_hops',
        rootCauseMessageId: 'message_1',
        hopCount: 5,
      }),
    )
  })

  it('rate-limits Room enqueue without creating a second turn scheduler', async () => {
    const registration = register('codex', 'native-rate', 'nian-rate', 'member-rate', 'auto_follow')
    observe(registration, 'idle')
    const messages = Array.from({ length: 7 }, (_, index) =>
      message({
        id: `message_${index + 1}`,
        sequence: String(index + 1),
        text: `message ${index + 1}`,
      }),
    )

    await service.processMessages('room_1', messages, registry.list(), testContext(registry.list()))

    expect(enqueueConversationBatch.mock.calls[0]![0]).toHaveLength(6)
    expect(registry.getByRegistryKey(registration.registryKey)?.binding).toMatchObject({
      lastActivatedSequence: '7',
      activationQueue: [],
      activeActivation: null,
    })
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        causeMessageId: 'message_7',
        outcome: 'suppressed',
        reason: 'rate_limited',
      }),
    )
  })

  function register(
    runtimeAdapter: RoomRuntimeAdapter,
    sourceSessionKey: string,
    nianSessionId: string,
    membershipId: string,
    activationMode: RoomActivationMode,
  ) {
    const registration = registry.register({
      machineId: 'machine_1',
      runtimeAdapter,
      sourceSessionKey,
      nianSessionId,
      hostProcessIdentity: `${runtimeAdapter}:test`,
      capabilities: {
        canIdentifySession: true,
        canBindAutomatically: true,
        canOpenEmbeddedRoomPage: false,
        canResumeIdleSession: true,
        canActivateWhileHostOpen: false,
      },
    })
    return registry.setBinding({
      registryKey: registration.registryKey,
      bindingId: `binding-${membershipId}`,
      roomId: 'room_1',
      agentIdentityId: `identity-${membershipId}`,
      agentMembershipId: membershipId,
      status: 'active',
      activationMode,
    })
  }

  function observe(
    registration: ReturnType<typeof register>,
    lifecycleState: 'active' | 'idle',
    workspacePath = `/tmp/project-${registration.runtimeAdapter === 'claude_code' ? 'claude' : registration.runtimeAdapter}`,
  ) {
    observations.observe({
      machineId: registration.machineId,
      runtimeAdapter: registration.runtimeAdapter,
      sourceSessionKey: registration.sourceSessionKey,
      hostContextHash: 'a'.repeat(64),
      workspacePath,
      lifecycleState,
      eventName: lifecycleState === 'idle' ? 'Stop' : 'SessionStart',
    })
  }

  function testContext(registrations: ReturnType<RoomSessionRegistry['list']>) {
    return {
      roomName: 'Hello',
      members: [
        { displayName: 'User', principalType: 'human' as const },
        {
          displayName: 'Support',
          principalType: 'agent' as const,
          description: 'Answer support questions',
          ownerDisplayName: 'User',
        },
      ],
      agentsByIdentityId: Object.fromEntries(
        registrations
          .filter((item) => item.binding)
          .map((item) => [
            item.binding!.agentIdentityId,
            {
              displayName: 'Support',
              description: 'Answer support questions',
              sessionMode: 'standard' as const,
              permissionPolicy: testPermissionPolicy(),
              permissionConfirmation: null,
              configurationVersion: 7,
              configurationPending: false,
            },
          ]),
      ),
      agentSystemPromptsByIdentityId: Object.fromEntries(
        registrations
          .filter((item) => item.binding)
          .map((item) => [item.binding!.agentIdentityId, 'Be concise.']),
      ),
    }
  }
})

function message(
  input: {
    text?: string
    id?: string
    sequence?: string
    principalType?: 'human' | 'agent'
    displayName?: string
    attachments?: RoomMessageView['attachments']
    kind?: RoomMessageView['kind']
    systemEvent?: RoomMessageView['systemEvent']
  } = {},
): RoomMessageView {
  return {
    id: input.id ?? 'message_1',
    roomId: 'room_1',
    sequence: input.sequence ?? '1',
    kind: input.kind ?? 'text',
    text: input.text ?? 'hello',
    author: {
      principalType: input.principalType ?? 'human',
      membershipId: 'human_1',
      ownerUserId: 'user_1',
      displayName: input.displayName ?? 'User',
      ownerDisplayName: null,
    },
    mentions: [],
    attachments: input.attachments ?? [],
    replyToMessageId: null,
    createdAt: '2026-08-23T00:00:00.000Z',
    editedAt: null,
    deletedAt: null,
    systemEvent: input.systemEvent ?? null,
  } as RoomMessageView
}

function compiledPolicy(
  workDir: string,
  requestedPolicy: ManagedAgentPermissionPolicy = testPermissionPolicy(),
): CompiledManagedAgentPolicy {
  return {
    requestedPolicy,
    enforcement: {
      level: 'hard',
      effectivePolicy: requestedPolicy,
      unsupportedCapabilities: [],
      runtimeVersion: '0.152.1',
      platform: process.platform,
    },
    adapterPolicy: {
      version: requestedPolicy.version,
      workDir,
      fileAccess: requestedPolicy.fileAccess,
      externalCapabilities: { ...requestedPolicy.externalCapabilities },
      denySensitiveFiles: true,
      failClosed: true,
    },
    environmentPolicy: {
      inheritDaemonEnv: false,
      loadLoginShell: false,
      providerEnvKeys: ['OPENAI_API_KEY'],
      sessionEnvKeys: ['SHENNIAN_MANAGED_ROOM_CONTEXT', 'SHENNIAN_MANAGED_ROOM_IPC_ROOT'],
      shellSubprocess: {
        inherit: 'none',
        allowedEnvKeys: ['PATH', 'SHENNIAN_MANAGED_ROOM_CONTEXT', 'SHENNIAN_MANAGED_ROOM_IPC_ROOT'],
        deniedEnvKeys: ['OPENAI_API_KEY'],
      },
    },
  }
}

async function strictTestPolicyResolver(input: {
  registration: { runtimeAdapter: RoomRuntimeAdapter }
  permissionPolicy: unknown
  workDir: string
}): Promise<CompiledManagedAgentPolicy> {
  const result = await compileManagedAgentPolicy({
    agentType:
      input.registration.runtimeAdapter === 'claude_code'
        ? 'claude'
        : input.registration.runtimeAdapter,
    runtimeVersion: '0.152.1',
    platform: process.platform,
    securityDeclaration: CODEX_MANAGED_RUNTIME_SECURITY,
    policy: input.permissionPolicy,
    workDir: input.workDir,
  })
  if (!result.ok) throw new Error(result.errorCode)
  return result.value
}
