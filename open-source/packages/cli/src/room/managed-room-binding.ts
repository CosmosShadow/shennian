// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/managed-room-binding.test.ts

import {
  roomRuntimeAdapterForAgent,
  type AgentType,
  type RoomActivationMode,
  type RoomRuntimeAdapter,
} from '@shennian/wire'
import crypto from 'node:crypto'
import type { HttpRoomBindingClient } from './room-binding-client.js'
import type { RoomHostSessionObservationStore } from './host-session-observations.js'
import type { RoomSessionRegistry } from './session-registry.js'

export type ManagedRoomBindInput = {
  roomId: string
  agentIdentityId: string
  nianSessionId: string
  assignmentIntentId: string
  sourceSessionKey: string
  agentType: AgentType
  activationMode?: RoomActivationMode
}

export type ManagedRoomRestartInput = ManagedRoomBindInput & {
  bindingId: string
  previousNianSessionId: string
}

export type ManagedRoomBinder = {
  bind(input: ManagedRoomBindInput): Promise<{
    binding: {
      id: string
      roomId: string
      agentIdentityId: string
      agentMembershipId: string
      nianSessionId: string
      status: 'pending_approval' | 'active' | 'paused' | 'detached'
      activationMode: 'auto_follow' | 'mention_only' | 'paused'
    }
    resumeSequence: string
    idempotent: boolean
  }>
  restart(input: ManagedRoomRestartInput): Promise<{
    binding: {
      id: string
      roomId: string
      agentIdentityId: string
      agentMembershipId: string
      nianSessionId: string
      status: 'pending_approval' | 'active' | 'paused' | 'detached'
      activationMode: 'auto_follow' | 'mention_only' | 'paused'
    }
    resumeSequence: string
    idempotent: boolean
  }>
}

export class TrustedManagedRoomBinder implements ManagedRoomBinder {
  constructor(
    private readonly deps: {
      registry: RoomSessionRegistry
      observations: RoomHostSessionObservationStore
      bindingClient: Pick<HttpRoomBindingClient, 'create' | 'restart' | 'status'>
      getMachineCredentials: () => { machineId?: string; machineToken?: string }
      hostProcessIdentity: () => string
    },
  ) {}

  async bind(input: ManagedRoomBindInput) {
    const { machineId, machineToken } = this.deps.getMachineCredentials()
    if (!machineId || !machineToken) throw new Error('Machine is not paired with Shennian.')
    const runtimeAdapter = roomRuntimeAdapter(input.agentType)
    const hostProcessIdentity = this.deps.hostProcessIdentity()
    const registration = this.deps.registry.register({
      machineId,
      runtimeAdapter,
      sourceSessionKey: input.sourceSessionKey,
      nianSessionId: input.nianSessionId,
      hostProcessIdentity,
      capabilities: {
        canIdentifySession: true,
        canBindAutomatically: true,
        canOpenEmbeddedRoomPage: false,
        canResumeIdleSession: true,
        canActivateWhileHostOpen: true,
      },
    })
    const result = await this.deps.bindingClient.create({
      machineToken,
      bindingIntentId: input.assignmentIntentId,
      roomId: input.roomId,
      agentIdentityId: input.agentIdentityId,
      nianSessionId: input.nianSessionId,
      runtimeAdapter,
      sessionRegistryKey: registration.registryKey,
      activationCapability: 'managed',
      activationMode: input.activationMode ?? 'auto_follow',
    })
    // The server commit is authoritative and cannot be rolled back if the
    // follow-up workspace lookup fails. Persist the Binding first so the
    // background mirror can finish observation and activation on its next run.
    this.deps.registry.setBinding({
      registryKey: registration.registryKey,
      bindingId: result.binding.id,
      roomId: result.binding.roomId,
      agentIdentityId: result.binding.agentIdentityId,
      agentMembershipId: result.binding.agentMembershipId,
      status: result.binding.status,
      activationMode: result.binding.activationMode,
      replaceOwner: true,
      initialSequence: result.resumeSequence,
    })
    const workspacePath = await this.resolveServerOwnedWorkspace({
      machineToken,
      roomId: result.binding.roomId,
      bindingId: result.binding.id,
      agentIdentityId: input.agentIdentityId,
    })
    this.deps.observations.observe({
      machineId,
      runtimeAdapter,
      sourceSessionKey: input.sourceSessionKey,
      hostContextHash: sha256(hostProcessIdentity),
      workspaceHash: sha256(workspacePath),
      workspacePath,
      lifecycleState: 'active',
      eventName: 'ManagedBind',
    })
    return result
  }

  async restart(input: ManagedRoomRestartInput) {
    const { machineId, machineToken } = this.deps.getMachineCredentials()
    if (!machineId || !machineToken) throw new Error('Machine is not paired with Shennian.')
    const runtimeAdapter = roomRuntimeAdapter(input.agentType)
    const hostProcessIdentity = this.deps.hostProcessIdentity()
    const registration = this.deps.registry.register({
      machineId,
      runtimeAdapter,
      sourceSessionKey: input.sourceSessionKey,
      nianSessionId: input.nianSessionId,
      hostProcessIdentity,
      capabilities: {
        canIdentifySession: true,
        canBindAutomatically: true,
        canOpenEmbeddedRoomPage: false,
        canResumeIdleSession: true,
        canActivateWhileHostOpen: true,
      },
    })
    const result = await this.deps.bindingClient.restart({
      machineToken,
      bindingId: input.bindingId,
      previousNianSessionId: input.previousNianSessionId,
      roomId: input.roomId,
      agentIdentityId: input.agentIdentityId,
      nianSessionId: input.nianSessionId,
      runtimeAdapter,
      sessionRegistryKey: registration.registryKey,
    })
    // Commit the local half immediately after the authoritative server swap.
    // Workspace observation is recoverable enrichment; losing the new Binding
    // here would strand the server on a Session the daemon can never activate.
    this.deps.registry.setBinding({
      registryKey: registration.registryKey,
      bindingId: result.binding.id,
      roomId: result.binding.roomId,
      agentIdentityId: result.binding.agentIdentityId,
      agentMembershipId: result.binding.agentMembershipId,
      status: result.binding.status,
      activationMode: result.binding.activationMode,
      replaceOwner: true,
      initialSequence: result.resumeSequence,
    })
    const workspacePath = await this.resolveServerOwnedWorkspace({
      machineToken,
      roomId: result.binding.roomId,
      bindingId: result.binding.id,
      agentIdentityId: input.agentIdentityId,
    })
    this.deps.observations.observe({
      machineId,
      runtimeAdapter,
      sourceSessionKey: input.sourceSessionKey,
      hostContextHash: sha256(hostProcessIdentity),
      workspaceHash: sha256(workspacePath),
      workspacePath,
      lifecycleState: 'active',
      eventName: 'ManagedRestart',
    })
    return result
  }

  private async resolveServerOwnedWorkspace(input: {
    machineToken: string
    roomId: string
    bindingId: string
    agentIdentityId: string
  }): Promise<string> {
    const status = await this.deps.bindingClient.status(input)
    const workspacePath = status.managedWorkspacePath?.trim()
    const sessionMode = status.agent?.sessionMode
    if (
      status.agentIdentityId !== input.agentIdentityId ||
      (sessionMode !== 'standard' && sessionMode !== 'manager') ||
      !workspacePath
    ) {
      throw new Error('managed_room_workspace_unavailable')
    }
    return workspacePath
  }
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex')
}

function roomRuntimeAdapter(agentType: AgentType): RoomRuntimeAdapter {
  const adapter = roomRuntimeAdapterForAgent(agentType)
  if (adapter) return adapter
  throw new Error(`Agent ${agentType} does not support managed Room binding.`)
}
