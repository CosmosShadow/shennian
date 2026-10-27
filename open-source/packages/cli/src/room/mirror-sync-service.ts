// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/room-mirror-sync-service.test.ts

import { HttpRoomActionClient, RoomActionHttpError } from './room-action-client.js'
import { RoomSessionRegistry, type RoomSessionRegistration } from './session-registry.js'
import type { RoomHostSessionObservationStore } from './host-session-observations.js'
import type { RoomMessageView } from '@shennian/wire'
import type { RoomActivationContext } from './activation-service.js'
import crypto from 'node:crypto'
import { isCurrentRegistration, matchesRoomOwner } from './registration-authority.js'

type Timer = ReturnType<typeof setTimeout>

export class RoomMirrorSyncService {
  private timer: Timer | null = null
  private running = false
  private started = false
  private idleStreak = 0
  private sawActivity = false

  constructor(
    private readonly deps: {
      registry: RoomSessionRegistry
      observations?: RoomHostSessionObservationStore
      actionClient: Pick<HttpRoomActionClient, 'status' | 'read'>
      getMachineCredentials: () => { machineToken?: string }
      /** @deprecated ignored; messages are no longer mirrored to local JSONL. */
      mirrorFactory?: (roomId: string) => unknown
      initialDelayMs?: number
      intervalMs?: number
      /** Idle polls back off from intervalMs up to this cap; Relay delivery is the fast path. */
      maxIntervalMs?: number
      random?: () => number
      maxPagesPerRun?: number
      setTimeout?: (handler: () => void, delayMs: number) => Timer
      clearTimeout?: (timer: Timer) => void
      onMessages?: (
        roomId: string,
        messages: RoomMessageView[],
        registrations: RoomSessionRegistration[],
        context: RoomActivationContext,
      ) => Promise<void>
      isSessionDeleted?: (sessionId: string) => boolean
      onBindingPaused?: (registration: RoomSessionRegistration) => void
    },
  ) {}

  start(): void {
    if (this.started) return
    this.started = true
    this.idleStreak = 0
    this.sawActivity = false
    this.arm(this.deps.initialDelayMs ?? 0)
  }

  stop(): void {
    this.started = false
    if (this.timer) (this.deps.clearTimeout ?? clearTimeout)(this.timer)
    this.timer = null
  }

  /**
   * Fast path for an authoritative Room message delivered over the machine
   * Relay. The message body is already present, so this must not perform the
   * normal status/read HTTP round-trip. The periodic cursor sync remains the
   * compatibility and reconnect repair path for older servers and missed
   * frames.
   */
  async deliverLive(message: RoomMessageView): Promise<{ accepted: boolean; registrationCount: number }> {
    const registrations = this.deps.registry.list().filter((record) => {
      if (
        record.binding?.roomId !== message.roomId ||
        record.binding.status !== 'active' ||
        record.binding.activationMode === 'paused' ||
        !isCurrentRegistration(this.deps.registry, record)
      ) return false
      return BigInt(message.sequence) > BigInt(record.binding.lastDeliveredSequence)
    })
    if (registrations.length === 0) return { accepted: false, registrationCount: 0 }
    this.sawActivity = true
    if (this.deps.onMessages) {
      await this.deps.onMessages(
        message.roomId,
        [message],
        registrations,
        { roomName: '当前群聊' },
      )
    }
    for (const registration of registrations) {
      const current = this.deps.registry.getByRegistryKey(registration.registryKey)
      if (
        current?.binding?.status === 'active' &&
        current.binding.activationMode !== 'paused' &&
        BigInt(message.sequence) > BigInt(current.binding.lastDeliveredSequence)
      ) {
        this.deps.registry.advanceCursor({
          registryKey: current.registryKey,
          cursor: 'delivered',
          sequence: message.sequence,
        })
      }
    }
    return { accepted: true, registrationCount: registrations.length }
  }

  async runOnce(): Promise<void> {
    if (this.running) return
    const machineToken = this.deps.getMachineCredentials().machineToken?.trim()
    if (!machineToken) return
    this.running = true
    try {
      // Recover pre-fix duplicate owners using existing authoritative deletion
      // tombstones, including against servers without the new status fields.
      for (const record of this.deps.registry.list()) {
        if (record.lifecycleState !== 'closed' && this.deps.isSessionDeleted?.(record.nianSessionId)) {
          this.retire(record)
        }
      }
      const groups = groupByRoom(this.deps.registry.list())
      for (const [roomId, registrations] of groups) {
        await this.syncRoom(roomId, registrations, machineToken)
      }
    } finally {
      this.running = false
    }
  }

  private async syncRoom(
    roomId: string,
    registrations: RoomSessionRegistration[],
    machineToken: string,
  ): Promise<void> {
    const candidates = registrations.filter(
      (record) =>
        record.binding &&
        (record.binding.status === 'active' || record.binding.status === 'paused'),
    )
    if (candidates.length === 0) {
      return
    }

    let unavailableCount = 0
    let syncTarget: { machineToken: string; roomId: string; bindingId: string } | null = null
    let roomContext: RoomActivationContext | null = null
    for (const registration of candidates) {
      if (!isCurrentRegistration(this.deps.registry, registration)) continue
      const binding = registration.binding!
      const target = { machineToken, roomId, bindingId: binding.bindingId }
      try {
        const remote = await this.deps.actionClient.status(target)
        if (!isCurrentRegistration(this.deps.registry, registration)) continue
        if (binding.status !== remote.status || binding.activationMode !== remote.activationMode) {
          this.sawActivity = true
        }
        if (!matchesRoomOwner(registration, remote) || this.deps.isSessionDeleted?.(registration.nianSessionId)) {
          this.retire(registration)
          continue
        }
        if (
          remote.activationCapability === 'managed' &&
          remote.managedWorkspacePath &&
          !this.deps.observations?.getBySource(registration)
        ) {
          this.deps.observations?.observe({
            machineId: registration.machineId,
            runtimeAdapter: registration.runtimeAdapter,
            sourceSessionKey: registration.sourceSessionKey,
            hostContextHash: sha256(registration.hostProcessIdentity),
            workspaceHash: sha256(remote.managedWorkspacePath),
            workspacePath: remote.managedWorkspacePath,
            lifecycleState: 'active',
            eventName: 'ManagedSync',
          })
        }
        const updated = this.deps.registry.setBinding({
          registryKey: registration.registryKey,
          bindingId: remote.bindingId,
          roomId: remote.roomId,
          agentIdentityId: remote.agentIdentityId,
          agentMembershipId: remote.agentMembershipId,
          status: remote.status,
          activationMode: remote.activationMode,
        })
        if (remote.status === 'paused' || remote.activationMode === 'paused') {
          this.deps.onBindingPaused?.(updated)
        }
        if (remote.status === 'detached') {
          unavailableCount += 1
          continue
        }
        if (remote.status === 'pending_approval') continue
        syncTarget ??= target
        roomContext ??= {
          roomName: remote.room.name,
          memberCount: remote.room.memberCount,
          members: remote.room.members,
          agentsByIdentityId: {},
          agentSystemPromptsByIdentityId: {},
        }
        if (remote.effectiveModelId !== undefined) {
          roomContext.effectiveModelsBySessionId ??= {}
          roomContext.effectiveModelsBySessionId![registration.nianSessionId] = remote.effectiveModelId
        }
        if (remote.agent) {
          roomContext.agentsByIdentityId![remote.agentIdentityId] = remote.agent
          roomContext.agentSystemPromptsByIdentityId![remote.agentIdentityId] = remote.agent.systemPrompt ?? ''
        }
      } catch (error) {
        if (isBindingUnavailable(error)) {
          // The server is authoritative. Persisting the detached state prevents a
          // revoked Binding from being retried on every background sync interval.
          this.deps.registry.detachBinding(registration.registryKey)
          this.sawActivity = true
          unavailableCount += 1
          continue
        }
        return
      }
    }
    if (syncTarget) {
      const refreshed = registrations.filter((record) =>
        isCurrentRegistration(this.deps.registry, record),
      ).map(
        (registration) =>
          this.deps.registry.getByRegistryKey(registration.registryKey) ?? registration,
      )
      await this.pullPages(syncTarget, roomId, refreshed, roomContext)
      return
    }
    void unavailableCount
  }

  private async pullPages(
    target: { machineToken: string; roomId: string; bindingId: string },
    roomId: string,
    registrations: RoomSessionRegistration[],
    context: RoomActivationContext | null,
  ): Promise<void> {
    if (registrations.length === 0) return
    const maxPages = this.deps.maxPagesPerRun ?? 100
    let cursor = registrations
      .map((registration) => registration.binding?.lastDeliveredSequence ?? '0')
      .reduce((left, right) => BigInt(left) < BigInt(right) ? left : right)
    for (let page = 0; page < maxPages; page += 1) {
      const result = await this.deps.actionClient.read({
        ...target,
        afterSequence: cursor,
        limit: 100,
      })
      if (result.messages.length > 0) this.sawActivity = true
      const live = registrations.filter((record) => isCurrentRegistration(this.deps.registry, record))
      if (live.length === 0) return
      if (this.deps.onMessages) {
        await this.deps.onMessages(
          roomId,
          result.messages,
          live,
          context ?? { roomName: result.roomName },
        )
      }
      for (const registration of live) {
        const current = this.deps.registry.getByRegistryKey(registration.registryKey)
        if (
          current?.binding &&
          (current.binding.status === 'active' || current.binding.status === 'paused') &&
          BigInt(result.nextSequence) > BigInt(current.binding.lastDeliveredSequence)
        ) {
          this.deps.registry.advanceCursor({
            registryKey: registration.registryKey,
            cursor: 'delivered',
            sequence: result.nextSequence,
          })
        }
      }
      if (!result.hasMore) return
      if (result.nextSequence === cursor) {
        throw new RoomActionHttpError(
          'room_sync_no_progress',
          'Room mirror synchronization made no progress.',
        )
      }
      cursor = result.nextSequence
    }
  }

  private retire(record: RoomSessionRegistration): void {
    this.sawActivity = true
    const retired = this.deps.registry.updateLifecycle(record.registryKey, 'closed')
    this.deps.onBindingPaused?.(retired)
  }

  private arm(delayMs: number): void {
    if (!this.started || this.timer) return
    const setTimer = this.deps.setTimeout ?? setTimeout
    this.timer = setTimer(() => {
      this.timer = null
      void this.runOnce()
        .catch(() => { console.warn('[room.sync] delivery failed; retrying on next poll') })
        .finally(() => {
          this.idleStreak = this.sawActivity ? 0 : Math.min(this.idleStreak + 1, 10)
          this.sawActivity = false
          if (this.started) this.arm(this.nextDelayMs())
        })
    }, delayMs)
    this.timer.unref?.()
  }

  private nextDelayMs(): number {
    const base = this.deps.intervalMs ?? 5_000
    const cap = Math.max(base, this.deps.maxIntervalMs ?? 30_000)
    const backedOff = Math.min(cap, base * 2 ** Math.max(0, this.idleStreak - 1))
    // Jitter keeps many daemons from polling the same instant after a shared restart.
    return Math.min(
      cap,
      Math.round(backedOff * (0.8 + 0.4 * (this.deps.random ?? Math.random)())),
    )
  }
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex')
}

function groupByRoom(
  registrations: RoomSessionRegistration[],
): Map<string, RoomSessionRegistration[]> {
  const groups = new Map<string, RoomSessionRegistration[]>()
  for (const registration of registrations) {
    if (!registration.binding || registration.lifecycleState === 'closed') continue
    const group = groups.get(registration.binding.roomId) ?? []
    group.push(registration)
    groups.set(registration.binding.roomId, group)
  }
  return groups
}

function isBindingUnavailable(error: unknown): boolean {
  return (
    error instanceof RoomActionHttpError &&
    (error.code === 'room_binding_unavailable' || error.code === 'room_action_http_403')
  )
}
