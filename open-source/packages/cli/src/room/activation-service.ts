// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/room-activation-service.test.ts

import {
  isAvailableBuiltinAgentType,
  managedAgentExecutionMode,
  type AgentType,
  type BuiltinAgentType,
  type CustomAgentType,
  type ManagedAgentPermissionConfirmation,
  type ManagedAgentPermissionPolicy,
  type ManagedAgentRuntimeProtection,
  type RoomMessageView,
  type SessionMode,
} from '@shennian/wire'
import { getBuiltinAgentVersion, resolveBuiltinCommand } from '../agents/command-spec.js'
import {
  registerCustomRuntimeSecurity,
  resolveCustomRuntimeExecutableFingerprint,
} from '../agents/custom-managed-runtime.js'
import { loadConfig } from '../config/index.js'
import { resolveManagedAgentExecutableIdentity } from '../security/managed-agent-executable.js'
import {
  compileManagedAgentPolicy,
  type CompiledManagedAgentPolicy,
} from '../security/managed-agent-policy.js'
import { resolveManagedAgentRuntimeProtection } from '../security/managed-agent-runtime.js'
import type { ManagedRoomAction } from './managed-context.js'
import type { ManagedWorkerRoomOrigin } from '../manager/registry.js'
import type {
  ManagedRoomEnqueueParams,
  ManagedRoomQueueContext,
  PreparedManagedRoomTurn,
} from '../session/queue.js'
import { selectRoomActivationTargets } from './activation-policy.js'
import type { RoomHostSessionObservationStore } from './host-session-observations.js'
import {
  type RoomMentionContextItem,
  type RoomSessionRegistration,
  type RoomSessionRegistry,
} from './session-registry.js'
import type { RoomActivationAudit, RoomActivationAuditEvent } from './activation-audit.js'
import { buildManagedAgentPermissionPrompt, composeManagedRoomPrompt } from './managed-prompt-composer.js'
import { isCurrentRegistration } from './registration-authority.js'
import type { DetectedAgent } from '../agents/detect.js'

const MAX_HOPS = 4
const ACTIVATION_WINDOW_MS = 60_000
const MAX_ACTIVATIONS_PER_WINDOW = 6
const RATE_PAUSE_MS = 5 * 60_000

export type RoomConversationQueueInput = {
  params: ManagedRoomEnqueueParams
  context: ManagedRoomQueueContext
}

export type RoomActivationContext = {
  roomName: string
  memberCount?: number
  members?: Array<{
    displayName: string
    principalType: 'human' | 'agent'
    description?: string
    ownerDisplayName?: string | null
  }>
  agentsByIdentityId?: Record<string, {
    displayName: string
    description: string
    sessionMode: SessionMode
    managerConfig?: import('@shennian/wire').ManagerConfig | null
    permissionPolicy: ManagedAgentPermissionPolicy
    permissionConfirmation: ManagedAgentPermissionConfirmation | null
    configurationVersion?: number
    configurationPending?: boolean
  }>
  agentSystemPromptsByIdentityId?: Record<string, string>
  /** Per Session (not per Agent): conversations may override their Agent model. */
  effectiveModelsBySessionId?: Record<string, string | null>
  /** @deprecated ignored; retained only for registry/test compatibility during migration */
  localHistoryPath?: string
}

export class RoomActivationService {
  private readonly latestContexts = new Map<string, RoomActivationContext>()

  constructor(
    private readonly deps: {
      registry: RoomSessionRegistry
      observations: RoomHostSessionObservationStore
      issueManagedRoomContext: (
        registryKey: string,
        activationCauseMessageId?: string,
        allowedActions?: ManagedRoomAction[],
        propagateWorkerRoomOrigin?: boolean,
      ) => string
      now?: () => Date
      audit?: Pick<RoomActivationAudit, 'record'>
      enqueueConversationBatch: (inputs: RoomConversationQueueInput[]) => Promise<void>
      prepareUnboundDirectTurn?: (sessionId: string) => Promise<PreparedManagedRoomTurn | null>
      loadContext?: (registration: RoomSessionRegistration) => Promise<RoomActivationContext>
      resolveManagedAgentPolicy?: (input: {
        registration: RoomSessionRegistration
        permissionPolicy: ManagedAgentPermissionPolicy
        permissionConfirmation: ManagedAgentPermissionConfirmation | null
        workDir: string
      }) => Promise<CompiledManagedAgentPolicy>
    },
  ) {}

  async processMessages(
    roomId: string,
    messages: RoomMessageView[],
    registrations: RoomSessionRegistration[],
    context: RoomActivationContext = { roomName: '当前群聊' },
  ): Promise<void> {
    const queued: Array<{ input: RoomConversationQueueInput; registration: RoomSessionRegistration }> = []
    const cursorAdvances: Array<{ registryKey: string; sequence: string }> = []
    const mentionContexts = new Map<string, RoomMentionContextItem[]>()
    const legacyStateToRetire = new Set<string>()
    const ordered = [...messages].sort((a, b) => compareSequence(a.sequence, b.sequence))

    for (const snapshot of registrations) {
      const current = this.deps.registry.getByRegistryKey(snapshot.registryKey)
      if (!current?.binding || !isCurrentRegistration(this.deps.registry, snapshot) || current.binding.roomId !== roomId) continue
      if (
        current.binding.status !== 'active' &&
        current.binding.status !== 'paused' &&
        current.binding.activationQueue.length === 0
      ) continue
    }

    // One-way upgrade bridge: old daemons persisted Room-specific pending items.
    // Move only items that were never dispatched into the Session queue, and
    // clear every legacy active marker after the durable batch commit.
    for (const snapshot of registrations) {
      const current = this.deps.registry.getByRegistryKey(snapshot.registryKey)
      if (!current?.binding || !isCurrentRegistration(this.deps.registry, snapshot) || current.binding.roomId !== roomId) continue
      if (current.binding.activationQueue.length === 0 && !current.binding.activeActivation) continue
      legacyStateToRetire.add(current.registryKey)
      if (current.binding.status !== 'active' || current.binding.activationMode === 'paused') continue
      if (current.binding.activationQueue.length === 0) continue
      const observation = this.deps.observations.getBySource(current)
      if (!observation?.workspacePath || observation.lifecycleState === 'closed') {
        throw new Error('managed_room_workspace_unavailable')
      }
      this.latestContexts.set(current.registryKey, context)
      for (const item of current.binding.activationQueue) {
        queued.push({
          registration: current,
          input: {
            params: {
              sessionId: current.nianSessionId,
              text: item.deliveryText ?? '群聊中有一条待处理消息，请结合当前群聊上下文处理。',
              agentType: toAgentType(current.runtimeAdapter),
              sessionMode:
                context.agentsByIdentityId?.[current.binding.agentIdentityId]?.sessionMode ?? 'standard',
              managerConfig: context.agentsByIdentityId?.[current.binding.agentIdentityId]?.managerConfig ?? null,
              managerDefaultWorkerAgentType:
                context.agentsByIdentityId?.[current.binding.agentIdentityId]?.managerConfig?.defaultWorkerAgentType ?? null,
              managerDefaultWorkerModelId:
                context.agentsByIdentityId?.[current.binding.agentIdentityId]?.managerConfig?.defaultWorkerModelId ?? null,
              workDir: observation.workspacePath,
              agentSessionId: current.sourceSessionKey,
              queueMessageId: `room-activation-${current.binding.bindingId}-${item.causeMessageId}`,
              clientMessageId: `room-activation-${current.binding.bindingId}-${item.causeMessageId}`,
            },
            context: {
              registryKey: current.registryKey,
              causeMessageId: item.causeMessageId,
              rootCauseMessageId: item.rootCauseMessageId,
              sequence: item.sequence,
              hopCount: item.hopCount,
            },
          },
        })
      }
    }

    for (const message of ordered) {
      const targets = new Set(
        selectRoomActivationTargets(message, registrations).map(
          (target) => target.registration.registryKey,
        ),
      )
      for (const snapshot of registrations) {
        const current = this.deps.registry.getByRegistryKey(snapshot.registryKey)
        if (!current?.binding || !isCurrentRegistration(this.deps.registry, snapshot) || current.binding.roomId !== roomId) continue
        if (current.binding.status !== 'active' && current.binding.status !== 'paused') continue
        if (
          context.agentsByIdentityId?.[current.binding.agentIdentityId]?.configurationPending
        ) {
          // Do not consume or enqueue Room messages against the old native
          // session while an atomic configuration swap is pending.
          continue
        }
        if (BigInt(message.sequence) <= BigInt(current.binding.lastActivatedSequence)) continue
        const mentionContext = mentionContexts.get(current.registryKey)
          ?? [...(current.binding.mentionContext ?? [])]
        mentionContexts.set(current.registryKey, mentionContext)

        if (targets.has(current.registryKey)) {
          const hopCount =
            (message.activationCause?.hopCount ?? 0) +
            (message.author.principalType === 'agent' ? 1 : 0)
          const rootCauseMessageId = message.activationCause?.rootCauseMessageId ?? message.id
          if (hopCount > MAX_HOPS) {
            this.audit(current, message.id, rootCauseMessageId, hopCount, 'suppressed', 'max_hops')
          } else {
            const claim = this.deps.registry.claimActivation({
              registryKey: current.registryKey,
              causeMessageId: message.id,
              windowMs: ACTIVATION_WINDOW_MS,
              maxActivations: MAX_ACTIVATIONS_PER_WINDOW,
              pauseMs: RATE_PAUSE_MS,
              now: this.deps.now?.(),
            })
            if (!claim.allowed) {
              if (claim.newlyPaused) {
                this.audit(
                  current,
                  message.id,
                  rootCauseMessageId,
                  hopCount,
                  'suppressed',
                  'rate_limited',
                )
              }
              cursorAdvances.push({ registryKey: current.registryKey, sequence: message.sequence })
              continue
            }
            const observation = this.deps.observations.getBySource(current)
            if (!observation?.workspacePath || observation.lifecycleState === 'closed') {
              throw new Error('managed_room_workspace_unavailable')
            }
            const currentDelivery = buildDeliveryText([message])
            const deliveryText = current.binding.activationMode === 'mention_only'
              ? mergeDeliveryTexts([
                  ...mentionContext.map((item) => item.deliveryText),
                  currentDelivery,
                ])
              : currentDelivery
            this.latestContexts.set(current.registryKey, context)
            queued.push({
              registration: current,
              input: {
                params: {
                  sessionId: current.nianSessionId,
                  text: deliveryText,
                  agentType: toAgentType(current.runtimeAdapter),
                  sessionMode:
                    context.agentsByIdentityId?.[current.binding.agentIdentityId]?.sessionMode ?? 'standard',
                  managerConfig: context.agentsByIdentityId?.[current.binding.agentIdentityId]?.managerConfig ?? null,
                  managerDefaultWorkerAgentType:
                    context.agentsByIdentityId?.[current.binding.agentIdentityId]?.managerConfig?.defaultWorkerAgentType ?? null,
                  managerDefaultWorkerModelId:
                    context.agentsByIdentityId?.[current.binding.agentIdentityId]?.managerConfig?.defaultWorkerModelId ?? null,
                  workDir: observation.workspacePath,
                  agentSessionId: current.sourceSessionKey,
                  queueMessageId: `room-activation-${current.binding.bindingId}-${message.id}`,
                  clientMessageId: `room-activation-${current.binding.bindingId}-${message.id}`,
                  roomMessageCreatedAt: message.createdAt,
                },
                context: {
                  registryKey: current.registryKey,
                  causeMessageId: message.id,
                  rootCauseMessageId,
                  sequence: message.sequence,
                  hopCount,
                },
              },
            })
            if (current.binding.activationMode === 'mention_only') {
              mentionContexts.set(current.registryKey, [])
            }
          }
        } else if (
          current.binding.activationMode === 'mention_only' &&
          message.kind !== 'system' &&
          message.author.membershipId !== current.binding.agentMembershipId
        ) {
          if (!mentionContext.some((item) => item.sequence === message.sequence)) {
            mentionContext.push({ sequence: message.sequence, deliveryText: buildDeliveryText([message]) })
          }
        }
        cursorAdvances.push({ registryKey: current.registryKey, sequence: message.sequence })
      }
    }

    await this.deps.enqueueConversationBatch(queued.map((entry) => entry.input))
    for (const registryKey of legacyStateToRetire) {
      this.deps.registry.retireLegacyActivationState(
        registryKey,
        this.deps.now?.() ?? new Date(),
      )
    }
    for (const [registryKey, items] of mentionContexts) {
      if (this.deps.registry.getByRegistryKey(registryKey)?.lifecycleState === 'closed') continue
      this.deps.registry.replaceMentionContext(registryKey, items, this.deps.now?.() ?? new Date())
    }
    for (const entry of queued) {
      this.audit(
        entry.registration,
        entry.input.context.causeMessageId,
        entry.input.context.rootCauseMessageId,
        entry.input.context.hopCount,
        'queued',
        'conversation_queue',
      )
    }
    for (const advance of cursorAdvances) {
      if (this.deps.registry.getByRegistryKey(advance.registryKey)?.lifecycleState === 'closed') continue
      this.deps.registry.advanceCursor({
        registryKey: advance.registryKey,
        cursor: 'activated',
        sequence: advance.sequence,
      })
    }
  }

  async prepareConversationTurn(
    contexts: ManagedRoomQueueContext[],
  ): Promise<PreparedManagedRoomTurn> {
    const currentContext = contexts.at(-1)
    if (!currentContext) throw new Error('managed_room_queue_context_missing')
    const registration = this.deps.registry.getByRegistryKey(currentContext.registryKey)
    if (!registration) throw new Error('managed_room_binding_unavailable')
    const prepared = await this.prepareManagedTurn(registration, currentContext.causeMessageId)
    this.audit(
      registration,
      currentContext.causeMessageId,
      currentContext.rootCauseMessageId,
      currentContext.hopCount,
      'activated',
      'conversation_queue_dispatch',
    )
    return prepared
  }

  async prepareDirectConversationTurn(
    sessionId: string,
    options: {
      roomOrigin?: ManagedWorkerRoomOrigin
      allowedRoomActions?: ManagedRoomAction[]
      propagateWorkerRoomOrigin?: boolean
      managerEvent?: boolean
      scheduledTask?: boolean
    } = {},
  ): Promise<PreparedManagedRoomTurn | null> {
    const registration = options.roomOrigin
      ? this.deps.registry.getByRegistryKey(options.roomOrigin.registryKey)
      : this.deps.registry.getByNianSessionId(sessionId)
    if (!registration?.binding) {
      // A native session may already be registered without belonging to a Room.
      // Never turn a missing/stale Room origin into a standalone authority.
      if (options.roomOrigin || options.scheduledTask) return null
      return this.deps.prepareUnboundDirectTurn?.(sessionId) ?? null
    }
    if (registration.nianSessionId !== sessionId) return null
    if (options.roomOrigin && (
      registration.registrationEpoch !== options.roomOrigin.registrationEpoch ||
      registration.binding?.bindingId !== options.roomOrigin.bindingId ||
      registration.binding.roomId !== options.roomOrigin.roomId
    )) return null
    return this.prepareManagedTurn(registration, undefined, options)
  }

  private async prepareManagedTurn(
    registration: RoomSessionRegistration,
    activationCauseMessageId?: string,
    privateOptions?: {
      allowedRoomActions?: ManagedRoomAction[]
      propagateWorkerRoomOrigin?: boolean
      managerEvent?: boolean
      scheduledTask?: boolean
    },
  ): Promise<PreparedManagedRoomTurn> {
    if (!isCurrentRegistration(this.deps.registry, registration) || !registration.binding || registration.binding.status !== 'active') {
      throw new Error('managed_room_binding_unavailable')
    }
    const roomContext = this.deps.loadContext
      ? await this.deps.loadContext(registration)
      : this.latestContexts.get(registration.registryKey)
    if (!roomContext) throw new Error('managed_room_prompt_context_unavailable')
    const identity = roomContext.agentsByIdentityId?.[registration.binding.agentIdentityId]
    if (identity?.configurationPending) throw new Error('managed_agent_configuration_pending')
    if (!identity?.permissionPolicy) throw new Error('managed_agent_policy_missing')
    const sessionMode = identity.sessionMode === 'manager' ? 'manager' : 'standard'
    const managerConfig = sessionMode === 'manager'
      ? {
          ...identity.managerConfig,
          defaultWorkerAgentType:
            identity.managerConfig?.defaultWorkerAgentType ?? toAgentType(registration.runtimeAdapter),
          defaultWorkerModelId: identity.managerConfig?.defaultWorkerModelId ?? null,
        }
      : null
    const observation = this.deps.observations.getBySource(registration)
    if (!observation?.workspacePath || observation.lifecycleState === 'closed') {
      throw new Error('managed_room_workspace_unavailable')
    }
    const managedAgentPolicy = this.deps.resolveManagedAgentPolicy
      ? await this.deps.resolveManagedAgentPolicy({
          registration,
          permissionPolicy: identity.permissionPolicy,
          permissionConfirmation: identity.permissionConfirmation,
          workDir: observation.workspacePath,
        })
      : await resolveManagedAgentPolicy({
          registration,
          permissionPolicy: identity.permissionPolicy,
          permissionConfirmation: identity.permissionConfirmation,
          workDir: observation.workspacePath,
        })
    if (!isCurrentRegistration(this.deps.registry, registration)) {
      throw new Error('managed_room_binding_unavailable')
    }
    const prompt = buildRoomSystemPrompt(roomContext, registration, managedAgentPolicy)
    const token = this.deps.issueManagedRoomContext(
      registration.registryKey,
      activationCauseMessageId,
      privateOptions?.allowedRoomActions,
      privateOptions?.propagateWorkerRoomOrigin,
    )
    if (!/^mrc_[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new Error('managed_room_context_unavailable')
    }
    return {
      agentType: toAgentType(registration.runtimeAdapter),
      effectiveModelId: roomContext.effectiveModelsBySessionId?.[registration.nianSessionId],
      workDir: managedAgentPolicy.adapterPolicy.workDir,
      agentSessionId: registration.sourceSessionKey,
      systemPrompt: privateOptions
        ? buildPrivateManagerSystemPrompt({
            managerEvent: privateOptions.managerEvent === true,
            scheduledTask: privateOptions.scheduledTask === true,
            roomSendAllowed: privateOptions.allowedRoomActions?.includes('send') === true,
            agentSystemPrompt:
              roomContext.agentSystemPromptsByIdentityId?.[registration.binding.agentIdentityId],
            managedAgentPolicy,
            runtimeAdapter: toAgentType(registration.runtimeAdapter),
          })
        : prompt.systemPrompt,
      sessionMode,
      managerConfig,
      managerDefaultWorkerAgentType: managerConfig?.defaultWorkerAgentType ?? null,
      managerDefaultWorkerModelId: managerConfig?.defaultWorkerModelId ?? null,
      roomContextRegistryKey: registration.registryKey,
      managedRoomContextToken: token,
      managedAgentPolicy,
      managedRoomPromptSnapshot: prompt.snapshot,
    }
  }

  private audit(
    registration: RoomSessionRegistration,
    causeMessageId: string,
    rootCauseMessageId: string,
    hopCount: number,
    outcome: RoomActivationAuditEvent['outcome'],
    reason: string,
  ): void {
    if (!registration.binding) return
    this.deps.audit?.record({
      roomId: registration.binding.roomId,
      bindingId: registration.binding.bindingId,
      causeMessageId,
      rootCauseMessageId,
      hopCount,
      outcome,
      reason,
      at: this.deps.now?.(),
    })
  }
}

function buildDeliveryText(messages: RoomMessageView[]): string {
  if (messages.length === 1 && messages[0]!.kind === 'system') {
    return `[群事件]\n${messages[0]!.text?.trim() || '群聊状态发生变化。'}`
  }
  const blocks = messages.map((message) => {
    const text = message.text?.trim() || '发送了一条消息'
    const attachments =
      message.attachments.length > 0
        ? `\n${message.attachments.map(formatDeliveryAttachment).join('\n')}`
        : ''
    return { speaker: message.author.displayName, body: `${text}${attachments}` }
  })
  return formatDeliveryBlocks(blocks)
}

function formatDeliveryAttachment(attachment: RoomMessageView['attachments'][number]): string {
  const label = `${escapeMarkdownLabel(attachment.name)} · ${formatByteSize(attachment.byteSize)}`
  return `附件：${label}｜${attachment.mimeType}｜attachmentId=${attachment.attachmentId}`
}

function escapeMarkdownLabel(value: string): string {
  return String(value || '附件').replace(/[[\]\\]/g, '\\$&').replace(/[\r\n]+/g, ' ')
}

function formatByteSize(value: string): string {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 0) return `${value} B`
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let size = bytes
  let unit = -1
  do {
    size /= 1024
    unit += 1
  } while (size >= 1024 && unit < units.length - 1)
  const digits = size >= 100 ? 0 : size >= 10 ? 1 : 2
  return `${size.toFixed(digits).replace(/\.0+$|(?<=\.[0-9])0+$/, '')} ${units[unit]}`
}

function mergeDeliveryTexts(deliveryTexts: string[]): string {
  return formatDeliveryBlocks(deliveryTexts.map(parseDeliveryText))
}

function parseDeliveryText(deliveryText: string): { speaker: string; body: string } {
  const compact = deliveryText.match(/^\[群消息\][ \t]+<([^>\n]+)>\n([\s\S]*)$/)
  if (compact) return { speaker: compact[1]!, body: compact[2]! }

  // Registries written by earlier local daemons used a three-line header.
  const legacy = deliveryText.match(/^\[群消息\]\n<([^>\n]+)>\n([\s\S]*)$/)
  if (legacy) return { speaker: legacy[1]!, body: legacy[2]! }

  // A short-lived format used an unbracketed source label before the speaker.
  const labeledLegacy = deliveryText.match(/^群消息\n([^\n]+)\n([\s\S]*)$/)
  if (labeledLegacy) return { speaker: labeledLegacy[1]!, body: labeledLegacy[2]! }

  // The first natural Room format used an unadorned speaker on the first line.
  const natural = deliveryText.match(/^([^\n]+)\n([\s\S]*)$/)
  if (natural) return { speaker: natural[1]!, body: natural[2]! }

  return { speaker: '群成员', body: deliveryText.trim() }
}

function formatDeliveryBlocks(blocks: Array<{ speaker: string; body: string }>): string {
  if (blocks.length === 1) {
    const [block] = blocks
    return `[群消息] <${block!.speaker}>\n${block!.body}`
  }
  return `[群消息]\n${blocks.map((block) => `<${block.speaker}>\n${block.body}`).join('\n\n')}`
}

function buildPrivateManagerSystemPrompt(input: {
  managerEvent: boolean
  scheduledTask: boolean
  roomSendAllowed: boolean
  agentSystemPrompt?: string
  managedAgentPolicy: CompiledManagedAgentPolicy
  runtimeAdapter: AgentType
}): string {
  const policy = buildManagedAgentPermissionPrompt({
    requestedPolicy: input.managedAgentPolicy.requestedPolicy,
    enforcement: input.managedAgentPolicy.enforcement,
    resolvedWorkDir: input.managedAgentPolicy.adapterPolicy.workDir,
  })
  const boundary = input.scheduledTask
    ? `这是服务器已保存的定时任务现在触发，不是要求你创建或修改定时任务。立即执行本轮收到的工作内容；其中的周期和时间只是原安排背景，不要再次调用定时任务创建工具。需要向当前绑定群聊汇报时，必须显式使用${input.runtimeAdapter === 'codex' ? ' shennian_room_send 工具' : ' shennian room send 命令'}；只在内部对话回复不会发布到群聊。只能向当前绑定群聊发送，不能读取群历史或操作其他群聊。若执行或发送失败，如实报告，不得声称已播报。`
    : input.managerEvent && input.roomSendAllowed
    ? `这是由当前群聊任务创建的 Worker 触发的私有 Manager 续轮。先使用 Manager 工具读取并核验 Worker 结果。只把面向用户的最终进展或结论发送到该任务原始群聊，不发送 Worker 原始活动、工具日志、内部标识或调度细节。需要发布时必须显式使用${input.runtimeAdapter === 'codex' ? ' shennian_room_send 工具' : ' shennian room send 命令'}；只在当前内部对话中生成文字不会发送到群聊。`
    : !input.managerEvent && input.roomSendAllowed
      ? `这是 Owner 与 Manager 的私有对话。你仍可代表当前绑定的智能体，按 Owner 明确要求将进展或结论显式发送到它所属的 Room；需要发布时必须使用${input.runtimeAdapter === 'codex' ? ' shennian_room_send 工具' : ' shennian room send 命令'}。你不能读取 Room 历史或向其他 Room 发送。`
    : input.managerEvent
      ? '这是 Worker 触发的私有 Manager 续轮。可以使用 Manager 工具读取并核验 Worker 结果，但不得读取、发送或回复任何 Room 内容。'
      : '这是 Owner 与 Manager 的私有对话。可以使用 Manager 工具管理 Worker，但当前没有 Room 发布权限。'
  const privatePrompt = input.agentSystemPrompt?.trim()
  return [
    `[神念受管私有续轮规则]\n${boundary}\n不得猜测或展示 Room、Agent、Session、Binding、Membership、Machine 标识或任何凭据。`,
    policy,
    privatePrompt ? `[智能体私有系统提示词]\n${privatePrompt}` : '',
  ].filter(Boolean).join('\n\n')
}

function buildRoomSystemPrompt(
  context: RoomActivationContext,
  registration: RoomSessionRegistration,
  managedAgentPolicy: CompiledManagedAgentPolicy,
): ReturnType<typeof composeManagedRoomPrompt> {
  const identity = registration.binding
    ? context.agentsByIdentityId?.[registration.binding.agentIdentityId]
    : undefined
  if (!registration.binding || !identity) throw new Error('managed_room_prompt_incomplete')
  return composeManagedRoomPrompt({
    runtimeAdapter: toAgentType(registration.runtimeAdapter),
    agent: {
      displayName: identity.displayName,
      description: identity.description,
      systemPrompt: context.agentSystemPromptsByIdentityId?.[registration.binding.agentIdentityId],
      configurationVersion: identity.configurationVersion,
    },
    room: {
      name: context.roomName,
      activationMode: registration.binding.activationMode,
      members: context.members,
    },
    runtimePermissions: {
      requestedPolicy: managedAgentPolicy.requestedPolicy,
      enforcement: managedAgentPolicy.enforcement,
      resolvedWorkDir: managedAgentPolicy.adapterPolicy.workDir,
    },
  })
}

export async function resolveManagedAgentPolicy(input: {
  registration: Pick<RoomSessionRegistration, 'runtimeAdapter'>
  permissionPolicy: ManagedAgentPermissionPolicy
  permissionConfirmation: ManagedAgentPermissionConfirmation | null
  workDir: string
  runtime?: Pick<
    DetectedAgent,
    'version' | 'runtimePlatform' | 'runtimeIsWsl' | 'executableFingerprint'
  >
}): Promise<CompiledManagedAgentPolicy> {
  const agentType = toAgentType(input.registration.runtimeAdapter)
  const command = isAvailableBuiltinAgentType(agentType)
    ? resolveBuiltinCommand(agentType)
    : null
  const customEntry = agentType.startsWith('custom:')
    ? loadConfig().customAgents?.[agentType.slice('custom:'.length)]
    : undefined
  if (customEntry) registerCustomRuntimeSecurity(agentType as CustomAgentType, customEntry)
  const runtimeVersion = input.runtime?.version ?? (command
    ? getBuiltinAgentVersion(agentType as BuiltinAgentType, command)
    : customEntry?.caps.version)
  const executableIdentity = input.runtime
    ? {
        platform: input.runtime.runtimePlatform ?? process.platform,
        isWsl: input.runtime.runtimeIsWsl ?? false,
        executableFingerprint: input.runtime.executableFingerprint,
      }
    : command
    ? resolveManagedAgentExecutableIdentity(command)
    : {
        platform: process.platform,
        isWsl:
          process.platform === 'linux' &&
          Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP),
        executableFingerprint: customEntry
          ? resolveCustomRuntimeExecutableFingerprint(customEntry)
          : undefined,
      }
  const runtimeInput = {
    agentType,
    runtimeVersion,
    platform: executableIdentity.platform,
    isWsl: executableIdentity.isWsl,
    executableFingerprint: executableIdentity.executableFingerprint,
    requireExecutableFingerprint: true,
  } as const
  const protection = resolveManagedAgentRuntimeProtection(runtimeInput)
  // An upgrade in one environment is not a Windows/WSL migration. Do not
  // rebuild a managed thread in another home merely because discovery changed.
  if (agentType === 'codex' && input.permissionConfirmation &&
      ((input.permissionConfirmation.platform === 'win32' && protection.platform === 'wsl') ||
       (input.permissionConfirmation.platform === 'wsl' && protection.platform === 'win32'))) {
    throw new Error('managed_agent_runtime_changed')
  }
  const confirmationMatches = managedAgentPermissionConfirmationMatches({
    confirmation: input.permissionConfirmation,
    policy: input.permissionPolicy,
    runtimeAdapter: agentType,
    protection,
  })
  const result = await compileManagedAgentPolicy({
    ...runtimeInput,
    policy: input.permissionPolicy,
    workDir: input.workDir,
    hostFullAccessConfirmed: confirmationMatches && input.permissionConfirmation?.hostFullAccess,
    limitedProtectionConfirmed:
      confirmationMatches && input.permissionConfirmation?.limitedProtection,
  })
  if (!result.ok) {
    const unsupported = result.unsupportedCapabilities?.length
      ? `:${result.unsupportedCapabilities.join(',')}`
      : ''
    throw new Error(`${result.errorCode}${unsupported}`)
  }
  return result.value
}

export function managedAgentPermissionConfirmationMatches(input: {
  confirmation: ManagedAgentPermissionConfirmation | null
  policy: ManagedAgentPermissionPolicy
  runtimeAdapter: AgentType
  protection: ManagedAgentRuntimeProtection
}): boolean {
  // Runtime details are evidence captured when the owner saves the policy, not
  // an authorization key. Normal upgrades and reinstalls on the same configured
  // machine/Agent must not disable an already-authorized managed Agent.
  const { confirmation, policy, runtimeAdapter } = input
  const executionMode = managedAgentExecutionMode(policy)
  return Boolean(
    confirmation &&
      confirmation.policyVersion === policy.version &&
      confirmation.runtimeAdapter === runtimeAdapter &&
      (confirmation.executionMode ?? 'restricted') === executionMode &&
      confirmation.hostFullAccess ===
        (executionMode === 'native-full' || policy.fileAccess === 'host-full'),
  )
}

function toAgentType(runtime: RoomSessionRegistration['runtimeAdapter']): AgentType {
  if (runtime === 'claude_code') return 'claude'
  return runtime
}

function compareSequence(left: string, right: string): number {
  const a = BigInt(left)
  const b = BigInt(right)
  return a < b ? -1 : a > b ? 1 : 0
}
