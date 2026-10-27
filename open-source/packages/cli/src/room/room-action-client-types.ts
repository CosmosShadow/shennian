// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/room-action-client.test.ts

import type {
  ManagedAgentPermissionConfirmation,
  ManagedAgentPermissionPolicy,
  RoomActivationMode,
  SessionMode,
} from '@shennian/wire'

export type FetchLike = typeof fetch

export type BindingTarget = {
  machineToken: string
  roomId: string
  bindingId: string
  signal?: AbortSignal
}

export type RemoteRoomAgentStatus = {
  scheduleAuthorized?: boolean
  /** Additive authority fields; absent on older servers. */
  nianSessionId?: string | null
  sessionRegistryKey?: string
  bindingId: string
  roomId: string
  agentIdentityId: string
  agentMembershipId: string | null
  status: 'pending_approval' | 'active' | 'paused' | 'detached'
  activationCapability?: 'managed' | 'idle_resume' | 'notify_only'
  activationMode: RoomActivationMode
  managedWorkspacePath?: string | null
  /** Server-resolved Agent/session model; absent on older servers. Null is authoritative. */
  effectiveModelId?: string | null
  lastDeliveredSequence: string
  lastActivatedSequence: string
  appliedConfigurationVersion?: number
  pendingConfigurationVersion?: number | null
  agent?: {
    displayName: string
    description: string
    systemPrompt?: string
    sessionMode: SessionMode
    managerConfig?: import('@shennian/wire').ManagerConfig | null
    permissionPolicy: ManagedAgentPermissionPolicy
    permissionConfirmation: ManagedAgentPermissionConfirmation | null
    configurationVersion?: number
    configurationPending?: boolean
  }
  room: {
    name: string
    status: string
    lastSequence: string
    memberCount?: number
    members?: Array<{
      displayName: string
      principalType: 'human' | 'agent'
      description?: string
      ownerDisplayName?: string | null
    }>
  }
}

export type RemoteRoomJoinResult = {
  outcome: 'joined' | 'pending_approval'
  room: { id: string; name: string; canonicalUrl: string }
  agentIdentity: { id: string; displayName: string }
  binding: {
    id: string
    roomId: string
    agentIdentityId: string
    agentMembershipId: string | null
    status: 'pending_approval' | 'active' | 'paused'
    activationMode: RoomActivationMode
  }
  joinRequestId?: string
  idempotent: boolean
}

export type RemoteRoomAttachmentCapability = {
  attachmentId: string
  roomId: string
  safeName: string
  mimeType: string
  byteSize: string
  sha256: string
  downloadUrl: string
  expiresAt: string
}

export type RemoteRoomAttachmentUpload = {
  attachment: {
    id: string
    roomId: string
    name: string
    mimeType: string
    byteSize: string
    sha256: string
    status: 'pending' | 'uploaded'
  }
  upload: {
    method: 'PUT'
    url: string
    headers: Record<string, string>
    expiresAt: string
  }
  idempotent: boolean
}

export type RemoteRoomCreateResult = {
  outcome: 'created'
  room: {
    id: string
    name: string
    visibility: 'private'
    joinPolicy: 'open'
    canonicalUrl: string
    inviteUrl: string
  }
  agentIdentity: { id: string; displayName: string }
  binding: {
    id: string
    roomId: string
    agentIdentityId: string
    agentMembershipId: string
    status: 'active' | 'paused'
    activationMode: RoomActivationMode
  }
  idempotent: boolean
}

export type RemoteOperatorRoomCreateResult = {
  outcome: 'created'
  room: {
    id: string
    name: string
    visibility: 'private'
    joinPolicy: 'open'
    canonicalUrl: string
  }
}

export class RoomActionHttpError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'RoomActionHttpError'
  }
}
