// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/room-action-client.test.ts

import {
  isAvailableAgentType,
  parseManagedAgentPermissionPolicy,
  type ManagedAgentPermissionConfirmation,
  type RoomActivationMode,
  type RoomMessageView,
} from '@shennian/wire'
import path from 'node:path'

import {
  RoomActionHttpError,
  type BindingTarget,
  type FetchLike,
  type RemoteOperatorRoomCreateResult,
  type RemoteRoomAgentStatus,
  type RemoteRoomAttachmentCapability,
  type RemoteRoomAttachmentUpload,
  type RemoteRoomCreateResult,
  type RemoteRoomJoinResult,
} from './room-action-client-types.js'
export * from './room-action-client-types.js'

export class HttpRoomActionClient {
  private readonly baseUrl: string

  constructor(
    serverUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    this.baseUrl = serverUrl.replace(/\/+$/, '')
  }

  async createOperatorRoom(input: {
    machineToken: string
    name: string
  }): Promise<RemoteOperatorRoomCreateResult> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/rooms/actions/operator/create`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${input.machineToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: input.name }),
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      throw new RoomActionHttpError(
        'room_action_server_unavailable',
        'Shennian Room service is unavailable.',
      )
    }
    const value = await readResponse(response)
    if (!response.ok) throw serverError(response.status, value)
    return validateOperatorCreateResult(value, input, this.baseUrl)
  }

  async resolveNativeSession(input: {
    machineToken: string
    runtimeAdapter: 'codex' | 'claude_code' | 'workbuddy'
    sourceSessionKey: string
  }): Promise<{ nianSessionId: string; created: boolean }> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/rooms/actions/resolve-session`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${input.machineToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          runtimeAdapter: input.runtimeAdapter,
          sourceSessionKey: input.sourceSessionKey,
        }),
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      throw new RoomActionHttpError(
        'room_action_server_unavailable',
        'Shennian Room service is unavailable.',
      )
    }
    const value = await readResponse(response)
    if (!response.ok) throw serverError(response.status, value)
    if (!value || typeof value !== 'object') invalidResponse()
    const object = value as Record<string, unknown>
    if (
      typeof object.nianSessionId !== 'string' ||
      !/^[A-Za-z0-9_.:@/-]{1,512}$/.test(object.nianSessionId) ||
      typeof object.created !== 'boolean'
    ) {
      invalidResponse()
    }
    return object as { nianSessionId: string; created: boolean }
  }

  async createRoom(input: {
    machineToken: string
    bindingIntentId: string
    nianSessionId: string
    runtimeAdapter: 'codex' | 'claude_code' | 'workbuddy'
    sessionRegistryKey: string
    name: string
    agentAlias: string
    agentDescription?: string
    activationCapability: 'managed' | 'idle_resume' | 'notify_only'
    activationMode: RoomActivationMode
  }): Promise<RemoteRoomCreateResult> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/rooms/actions/create`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${input.machineToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          bindingIntentId: input.bindingIntentId,
          nianSessionId: input.nianSessionId,
          runtimeAdapter: input.runtimeAdapter,
          sessionRegistryKey: input.sessionRegistryKey,
          name: input.name,
          agentAlias: input.agentAlias,
          agentDescription: input.agentDescription,
          activationCapability: input.activationCapability,
          activationMode: input.activationMode,
        }),
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      throw new RoomActionHttpError(
        'room_action_server_unavailable',
        'Shennian Room service is unavailable.',
      )
    }
    const value = await readResponse(response)
    if (!response.ok) throw serverError(response.status, value)
    return validateCreateResult(value, input, this.baseUrl)
  }

  async joinRoom(input: {
    machineToken: string
    bindingIntentId: string
    nianSessionId: string
    runtimeAdapter: 'codex' | 'claude_code' | 'workbuddy'
    sessionRegistryKey: string
    inviteToken: string
    message?: string
    agentAlias: string
    agentDescription?: string
    activationCapability: 'managed' | 'idle_resume' | 'notify_only'
    activationMode: RoomActivationMode
  }): Promise<RemoteRoomJoinResult> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/rooms/actions/join`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${input.machineToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          bindingIntentId: input.bindingIntentId,
          nianSessionId: input.nianSessionId,
          runtimeAdapter: input.runtimeAdapter,
          sessionRegistryKey: input.sessionRegistryKey,
          inviteToken: input.inviteToken,
          message: input.message,
          agentAlias: input.agentAlias,
          agentDescription: input.agentDescription,
          activationCapability: input.activationCapability,
          activationMode: input.activationMode,
        }),
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      throw new RoomActionHttpError(
        'room_action_server_unavailable',
        'Shennian Room service is unavailable.',
      )
    }
    const value = await readResponse(response)
    if (!response.ok) throw serverError(response.status, value)
    return validateJoinResult(value, input, this.baseUrl)
  }

  async status(target: BindingTarget & { scheduleAuthorization?: boolean; causeMessageId?: string }): Promise<RemoteRoomAgentStatus> {
    const query = target.scheduleAuthorization ? `?scheduleAuthorization=1${target.causeMessageId ? `&causeMessageId=${encodeURIComponent(target.causeMessageId)}` : ''}` : ''
    const value = await this.request(target, `status${query}`)
    return validateStatus(value, target)
  }

  async getAttachmentCapability(
    target: BindingTarget & { attachmentId: string },
  ): Promise<RemoteRoomAttachmentCapability> {
    const value = await this.request(
      target,
      `attachments/${encodeURIComponent(target.attachmentId)}/download-capability`,
    )
    if (!value || typeof value !== 'object') invalidResponse()
    const object = value as Record<string, unknown>
    if (
      object.attachmentId !== target.attachmentId ||
      object.roomId !== target.roomId ||
      typeof object.safeName !== 'string' ||
      !isSafeFileName(object.safeName) ||
      typeof object.mimeType !== 'string' ||
      object.mimeType.length < 1 ||
      object.mimeType.length > 191 ||
      typeof object.byteSize !== 'string' ||
      !isSequence(object.byteSize) ||
      typeof object.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(object.sha256) ||
      !isSafeDownloadUrl(object.downloadUrl) ||
      typeof object.expiresAt !== 'string' ||
      !Number.isFinite(Date.parse(object.expiresAt))
    ) {
      invalidResponse()
    }
    return object as RemoteRoomAttachmentCapability
  }

  async initializeAttachment(
    target: BindingTarget & {
      clientUploadId: string
      name: string
      mediaKind: 'image' | 'audio' | 'file'
      mimeType: string
      byteSize: number
      sha256: string
    },
  ): Promise<RemoteRoomAttachmentUpload> {
    const value = await this.request(target, 'attachments/init', {
      method: 'POST',
      body: JSON.stringify({
        clientUploadId: target.clientUploadId,
        name: target.name,
        mediaKind: target.mediaKind,
        mimeType: target.mimeType,
        byteSize: target.byteSize,
        sha256: target.sha256,
      }),
    })
    if (!value || typeof value !== 'object') invalidResponse()
    const object = value as Partial<RemoteRoomAttachmentUpload>
    const attachment = object.attachment
    const upload = object.upload
    if (
      !attachment ||
      typeof attachment.id !== 'string' ||
      attachment.roomId !== target.roomId ||
      typeof attachment.name !== 'string' ||
      !isSafeFileName(attachment.name) ||
      attachment.mimeType !== target.mimeType ||
      attachment.byteSize !== String(target.byteSize) ||
      attachment.sha256 !== target.sha256 ||
      (attachment.status !== 'pending' && attachment.status !== 'uploaded') ||
      !upload ||
      upload.method !== 'PUT' ||
      !isSafeDownloadUrl(upload.url) ||
      !upload.headers ||
      typeof upload.headers !== 'object' ||
      upload.headers['content-type'] !== target.mimeType ||
      upload.headers['x-oss-meta-sha256'] !== target.sha256 ||
      typeof upload.expiresAt !== 'string' ||
      !Number.isFinite(Date.parse(upload.expiresAt)) ||
      Date.parse(upload.expiresAt) <= Date.now() ||
      typeof object.idempotent !== 'boolean'
    )
      invalidResponse()
    return object as RemoteRoomAttachmentUpload
  }

  async completeAttachment(target: BindingTarget & { attachmentId: string }): Promise<{
    attachment: {
      attachmentId: string
      mediaKind: 'image' | 'audio' | 'file'
      name: string
      mimeType: string
      byteSize: string
      sha256: string
      status: 'ready'
    }
    idempotent: boolean
  }> {
    const value = await this.request(
      target,
      `attachments/${encodeURIComponent(target.attachmentId)}/complete`,
      { method: 'POST' },
    )
    if (!value || typeof value !== 'object') invalidResponse()
    const object = value as { attachment?: Record<string, unknown>; idempotent?: unknown }
    if (typeof object.idempotent !== 'boolean') invalidResponse()
    const attachment = object.attachment
    if (
      !attachment ||
      attachment.attachmentId !== target.attachmentId ||
      (attachment.mediaKind !== 'image' &&
        attachment.mediaKind !== 'audio' &&
        attachment.mediaKind !== 'file') ||
      typeof attachment.name !== 'string' ||
      typeof attachment.mimeType !== 'string' ||
      typeof attachment.byteSize !== 'string' ||
      !isSequence(attachment.byteSize) ||
      typeof attachment.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(attachment.sha256) ||
      attachment.status !== 'ready'
    )
      invalidResponse()
    return { attachment: attachment as never, idempotent: object.idempotent }
  }

  async read(target: BindingTarget & { beforeSequence?: string; afterSequence?: string; limit: number }): Promise<{
    messages: RoomMessageView[]
    nextSequence: string
    hasMore: boolean
    historyFromSequence: string
    roomName: string
  }> {
    if (target.beforeSequence && target.afterSequence) {
      throw new RoomActionHttpError('ambiguous_sequence_cursor', 'beforeSequence and afterSequence are mutually exclusive.')
    }
    const query = new URLSearchParams({ limit: String(target.limit) })
    if (target.beforeSequence) query.set('before', target.beforeSequence)
    if (target.afterSequence) query.set('after', target.afterSequence)
    const value = await this.request(target, `messages?${query}`)
    if (!value || typeof value !== 'object') invalidResponse()
    const object = value as Record<string, unknown>
    if (
      !Array.isArray(object.messages) ||
      typeof object.nextSequence !== 'string' ||
      !isSequence(object.nextSequence) ||
      typeof object.hasMore !== 'boolean' ||
      typeof object.historyFromSequence !== 'string' ||
      !isSequence(object.historyFromSequence) ||
      typeof object.roomName !== 'string'
    ) {
      invalidResponse()
    }
    const messages = object.messages.map((message) => validateMessage(message, target.roomId))
    return {
      messages,
      nextSequence: object.nextSequence,
      hasMore: object.hasMore,
      historyFromSequence: object.historyFromSequence,
      roomName: object.roomName,
    }
  }

  async send(
    target: BindingTarget & {
      clientMessageId: string
      text: string
      mentionMembershipIds?: string[]
      replyToMessageId?: string
      activationCauseMessageId?: string
      activeRunId?: string
      attachmentIds?: string[]
    },
  ): Promise<{ message: RoomMessageView; idempotent: boolean }> {
    const value = await this.request(target, 'messages', {
      method: 'POST',
      body: JSON.stringify({
        clientMessageId: target.clientMessageId,
        text: target.text,
        mentionMembershipIds: target.mentionMembershipIds,
        replyToMessageId: target.replyToMessageId,
        activationCauseMessageId: target.activationCauseMessageId,
        activeRunId: target.activeRunId,
        attachmentIds: target.attachmentIds,
      }),
    })
    if (!value || typeof value !== 'object') invalidResponse()
    const object = value as Record<string, unknown>
    if (typeof object.idempotent !== 'boolean') invalidResponse()
    return {
      message: validateMessage(object.message, target.roomId),
      idempotent: object.idempotent,
    }
  }

  async mode(target: BindingTarget & { activationMode: RoomActivationMode }): Promise<{
    bindingId: string
    roomId: string
    status: 'active' | 'paused'
    activationMode: RoomActivationMode
    idempotent: boolean
  }> {
    const value = await this.request(target, 'mode', {
      method: 'PATCH',
      body: JSON.stringify({ activationMode: target.activationMode }),
    })
    if (!value || typeof value !== 'object') invalidResponse()
    const object = value as Record<string, unknown>
    if (
      object.bindingId !== target.bindingId ||
      object.roomId !== target.roomId ||
      (object.status !== 'active' && object.status !== 'paused') ||
      !isMode(object.activationMode) ||
      object.activationMode !== target.activationMode ||
      typeof object.idempotent !== 'boolean'
    ) {
      invalidResponse()
    }
    return object as Awaited<ReturnType<HttpRoomActionClient['mode']>>
  }

  async pause(target: BindingTarget & { reason: string }): Promise<{
    bindingId: string
    roomId: string
    status: 'paused'
    activationMode: 'paused'
    message: RoomMessageView
    idempotent: boolean
  }> {
    const value = await this.request(target, 'pause', {
      method: 'POST',
      body: JSON.stringify({ reason: target.reason }),
    })
    if (!value || typeof value !== 'object') invalidResponse()
    const object = value as Record<string, unknown>
    if (
      object.bindingId !== target.bindingId ||
      object.roomId !== target.roomId ||
      object.status !== 'paused' ||
      object.activationMode !== 'paused' ||
      typeof object.idempotent !== 'boolean'
    ) invalidResponse()
    return {
      ...(object as Omit<Awaited<ReturnType<HttpRoomActionClient['pause']>>, 'message'>),
      message: validateMessage(object.message, target.roomId),
    }
  }

  private async request(target: BindingTarget, suffix: string, init: RequestInit = {}) {
    let response: Response
    const requestSignal = createAbortableTimeout(target.signal, 10_000)
    try {
      response = await this.fetchImpl(
        `${this.baseUrl}/api/rooms/${encodeURIComponent(target.roomId)}/bindings/${encodeURIComponent(target.bindingId)}/${suffix}`,
        {
          ...init,
          headers: {
            authorization: `Bearer ${target.machineToken}`,
            ...(init.body ? { 'content-type': 'application/json' } : {}),
          },
          signal: requestSignal.signal,
        },
      )
    } catch {
      if (target.signal?.aborted) {
        throw new RoomActionHttpError(
          'managed_room_context_revoked',
          'Managed Room context was revoked.',
        )
      }
      throw new RoomActionHttpError(
        'room_action_server_unavailable',
        'Shennian Room service is unavailable.',
      )
    } finally {
      requestSignal.dispose()
    }
    if (!response.ok) {
      let code = `room_action_http_${response.status}`
      try {
        const body = (await response.json()) as { error?: unknown }
        if (typeof body.error === 'string' && /^[a-z0-9_-]{1,80}$/.test(body.error)) {
          code = body.error
        }
      } catch {}
      throw new RoomActionHttpError(code, 'Shennian Room action failed.')
    }
    try {
      return await response.json()
    } catch {
      invalidResponse()
    }
  }
}

function createAbortableTimeout(
  source: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const abortFromSource = () => controller.abort()
  if (source?.aborted) controller.abort()
  else source?.addEventListener('abort', abortFromSource, { once: true })
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer)
      source?.removeEventListener('abort', abortFromSource)
    },
  }
}

function validateStatus(value: unknown, target: BindingTarget): RemoteRoomAgentStatus {
  if (!value || typeof value !== 'object') invalidResponse()
  const object = value as Record<string, unknown>
  const room = object.room
  const agent = object.agent
  if (
    (object.nianSessionId !== undefined && object.nianSessionId !== null &&
      (typeof object.nianSessionId !== 'string' || !object.nianSessionId)) ||
    (object.sessionRegistryKey !== undefined &&
      (typeof object.sessionRegistryKey !== 'string' || !/^[a-f0-9]{64}$/.test(object.sessionRegistryKey))) ||
    object.bindingId !== target.bindingId ||
    object.roomId !== target.roomId ||
    typeof object.agentIdentityId !== 'string' ||
    (object.agentMembershipId !== null && typeof object.agentMembershipId !== 'string') ||
    (object.status !== 'pending_approval' &&
      object.status !== 'active' &&
      object.status !== 'paused' &&
      object.status !== 'detached') ||
    !isMode(object.activationMode) ||
    (object.activationCapability !== undefined &&
      object.activationCapability !== 'managed' &&
      object.activationCapability !== 'idle_resume' &&
      object.activationCapability !== 'notify_only') ||
    (object.managedWorkspacePath !== undefined &&
      object.managedWorkspacePath !== null &&
      (typeof object.managedWorkspacePath !== 'string' ||
        object.managedWorkspacePath.length > 4096 ||
        !path.isAbsolute(object.managedWorkspacePath))) ||
    typeof object.lastDeliveredSequence !== 'string' ||
    !isSequence(object.lastDeliveredSequence) ||
    typeof object.lastActivatedSequence !== 'string' ||
    !isSequence(object.lastActivatedSequence) ||
    (object.appliedConfigurationVersion !== undefined &&
      (!Number.isSafeInteger(object.appliedConfigurationVersion) ||
        Number(object.appliedConfigurationVersion) < 1)) ||
    (object.pendingConfigurationVersion !== undefined &&
      object.pendingConfigurationVersion !== null &&
      (!Number.isSafeInteger(object.pendingConfigurationVersion) ||
        Number(object.pendingConfigurationVersion) < 1)) ||
    !room ||
    typeof room !== 'object' ||
    (agent !== undefined && (!agent || typeof agent !== 'object'))
  ) {
    invalidResponse()
  }
  if (
    (object.status === 'pending_approval' && object.agentMembershipId !== null) ||
    ((object.status === 'active' || object.status === 'paused') &&
      typeof object.agentMembershipId !== 'string')
  ) {
    invalidResponse()
  }
  const roomObject = room as Record<string, unknown>
  const agentObject = agent as Record<string, unknown> | undefined
  const permissionPolicy = agentObject
    ? parseManagedAgentPermissionPolicy(agentObject.permissionPolicy)
    : null
  const permissionConfirmation = agentObject
    ? parseManagedAgentPermissionConfirmation(agentObject.permissionConfirmation)
    : null
  const hasPermissionConfirmation = agentObject
    ? Object.prototype.hasOwnProperty.call(agentObject, 'permissionConfirmation')
    : false
  const members = roomObject.members
  if (
    (agentObject !== undefined &&
      (typeof agentObject.displayName !== 'string' ||
        !agentObject.displayName.trim() ||
        typeof agentObject.description !== 'string' ||
        (agentObject.sessionMode !== 'standard' && agentObject.sessionMode !== 'manager') ||
        (agentObject.configurationVersion !== undefined &&
          (!Number.isSafeInteger(agentObject.configurationVersion) ||
            Number(agentObject.configurationVersion) < 1)) ||
        (agentObject.configurationPending !== undefined &&
          typeof agentObject.configurationPending !== 'boolean') ||
        !permissionPolicy ||
        !hasPermissionConfirmation ||
        (agentObject.permissionConfirmation !== null && !permissionConfirmation))) ||
    typeof roomObject.name !== 'string' ||
    typeof roomObject.status !== 'string' ||
    (roomObject.memberCount !== undefined &&
      (typeof roomObject.memberCount !== 'number' ||
        !Number.isInteger(roomObject.memberCount) ||
        roomObject.memberCount < 0)) ||
    typeof roomObject.lastSequence !== 'string' ||
    !isSequence(roomObject.lastSequence) ||
    (members !== undefined &&
      (!Array.isArray(members) ||
        members.some((member) => {
          if (!member || typeof member !== 'object') return true
          const item = member as Record<string, unknown>
          return (
            typeof item.displayName !== 'string' ||
            (item.principalType !== 'human' && item.principalType !== 'agent')
          )
        })))
  ) {
    invalidResponse()
  }
  return {
    ...object,
    ...(agentObject && permissionPolicy
      ? {
          agent: {
            ...agentObject,
            permissionPolicy,
            permissionConfirmation,
          },
        }
      : {}),
  } as RemoteRoomAgentStatus
}

function parseManagedAgentPermissionConfirmation(
  value: unknown,
): ManagedAgentPermissionConfirmation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const confirmation = value as Record<string, unknown>
  if (
    !Number.isSafeInteger(confirmation.policyVersion) ||
    Number(confirmation.policyVersion) < 1 ||
    typeof confirmation.runtimeAdapter !== 'string' ||
    !isAvailableAgentType(confirmation.runtimeAdapter) ||
    typeof confirmation.runtimeVersion !== 'string' ||
    !confirmation.runtimeVersion.trim() ||
    typeof confirmation.platform !== 'string' ||
    !confirmation.platform.trim() ||
    typeof confirmation.executableFingerprint !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(confirmation.executableFingerprint) ||
    typeof confirmation.hostFullAccess !== 'boolean' ||
    typeof confirmation.limitedProtection !== 'boolean' ||
    typeof confirmation.confirmedAt !== 'string' ||
    !Number.isFinite(Date.parse(confirmation.confirmedAt))
  ) {
    return null
  }
  return {
    policyVersion: Number(confirmation.policyVersion),
    runtimeAdapter: confirmation.runtimeAdapter,
    runtimeVersion: confirmation.runtimeVersion,
    platform: confirmation.platform,
    executableFingerprint: confirmation.executableFingerprint,
    executionMode: confirmation.executionMode === 'native-full' ? 'native-full' : 'restricted',
    hostFullAccess: confirmation.hostFullAccess,
    limitedProtection: confirmation.limitedProtection,
    confirmedAt: confirmation.confirmedAt,
  }
}

function validateMessage(value: unknown, roomId: string): RoomMessageView {
  if (!value || typeof value !== 'object') invalidResponse()
  const message = value as Partial<RoomMessageView>
  if (
    typeof message.id !== 'string' ||
    message.roomId !== roomId ||
    typeof message.sequence !== 'string' ||
    !isSequence(message.sequence) ||
    !message.author ||
    typeof message.author.membershipId !== 'string' ||
    !Array.isArray(message.attachments) ||
    typeof message.createdAt !== 'string'
  ) {
    invalidResponse()
  }
  if (message.activationCause != null) {
    const cause = message.activationCause
    if (
      typeof cause.causeMessageId !== 'string' ||
      typeof cause.rootCauseMessageId !== 'string' ||
      !Number.isInteger(cause.hopCount) ||
      cause.hopCount < 1 ||
      cause.hopCount > 32
    )
      invalidResponse()
  }
  validateSystemEvent(message.systemEvent)
  return message as RoomMessageView
}

function validateSystemEvent(value: RoomMessageView['systemEvent']): void {
  if (value == null) return
  const allowed = new Set([
    'membership_joined',
    'membership_left',
    'membership_removed',
    'room_renamed',
    'binding_mode_changed',
    'agent_unavailable',
  ])
  if (
    typeof value !== 'object' ||
    !allowed.has(value.type) ||
    (value.subjectMembershipId !== undefined && typeof value.subjectMembershipId !== 'string') ||
    (value.subjectPrincipalType !== undefined &&
      value.subjectPrincipalType !== 'human' &&
      value.subjectPrincipalType !== 'agent')
  ) invalidResponse()
}

function validateCreateResult(
  value: unknown,
  input: { name: string; agentAlias: string; activationMode: RoomActivationMode },
  serverUrl: string,
): RemoteRoomCreateResult {
  if (!value || typeof value !== 'object') invalidResponse()
  const object = value as Partial<RemoteRoomCreateResult>
  const room = object.room
  const identity = object.agentIdentity
  const binding = object.binding
  if (
    object.outcome !== 'created' ||
    !room ||
    typeof room.id !== 'string' ||
    room.name !== input.name ||
    room.visibility !== 'private' ||
    room.joinPolicy !== 'open' ||
    !isTrustedRoomUrl(room.canonicalUrl, serverUrl, `/spaces/${room.id}`) ||
    !isTrustedInviteUrl(room.inviteUrl, serverUrl, room.id) ||
    !identity ||
    typeof identity.id !== 'string' ||
    identity.displayName !== input.agentAlias ||
    !binding ||
    typeof binding.id !== 'string' ||
    binding.roomId !== room.id ||
    binding.agentIdentityId !== identity.id ||
    typeof binding.agentMembershipId !== 'string' ||
    (binding.status !== 'active' && binding.status !== 'paused') ||
    binding.activationMode !== input.activationMode ||
    typeof object.idempotent !== 'boolean'
  ) {
    invalidResponse()
  }
  return object as RemoteRoomCreateResult
}

function validateOperatorCreateResult(
  value: unknown,
  input: { name: string },
  serverUrl: string,
): RemoteOperatorRoomCreateResult {
  if (!value || typeof value !== 'object') invalidResponse()
  const object = value as Partial<RemoteOperatorRoomCreateResult>
  const room = object.room
  if (
    object.outcome !== 'created' ||
    !room ||
    typeof room.id !== 'string' ||
    room.name !== input.name ||
    room.visibility !== 'private' ||
    room.joinPolicy !== 'open' ||
    !isTrustedRoomUrl(room.canonicalUrl, serverUrl, `/spaces/${room.id}`)
  ) {
    invalidResponse()
  }
  return object as RemoteOperatorRoomCreateResult
}

function validateJoinResult(
  value: unknown,
  input: { agentAlias: string; activationMode: RoomActivationMode },
  serverUrl: string,
): RemoteRoomJoinResult {
  if (!value || typeof value !== 'object') invalidResponse()
  const object = value as Partial<RemoteRoomJoinResult>
  const room = object.room
  const identity = object.agentIdentity
  const binding = object.binding
  if (
    (object.outcome !== 'joined' && object.outcome !== 'pending_approval') ||
    !room ||
    typeof room.id !== 'string' ||
    typeof room.name !== 'string' ||
    !isTrustedRoomUrl(room.canonicalUrl, serverUrl, `/spaces/${room.id}`) ||
    !identity ||
    typeof identity.id !== 'string' ||
    identity.displayName !== input.agentAlias ||
    !binding ||
    typeof binding.id !== 'string' ||
    binding.roomId !== room.id ||
    binding.agentIdentityId !== identity.id ||
    binding.activationMode !== input.activationMode ||
    typeof object.idempotent !== 'boolean'
  ) {
    invalidResponse()
  }
  if (
    (object.outcome === 'pending_approval' &&
      (binding.status !== 'pending_approval' ||
        binding.agentMembershipId !== null ||
        typeof object.joinRequestId !== 'string')) ||
    (object.outcome === 'joined' &&
      ((binding.status !== 'active' && binding.status !== 'paused') ||
        typeof binding.agentMembershipId !== 'string' ||
        object.joinRequestId !== undefined))
  ) {
    invalidResponse()
  }
  return object as RemoteRoomJoinResult
}

function isSequence(value: string): boolean {
  return /^(0|[1-9]\d{0,19})$/.test(value)
}

function isSafeFileName(value: string): boolean {
  return (
    value.length <= 255 &&
    value === value.trim() &&
    value !== '.' &&
    value !== '..' &&
    !/[\\/\0-\x1f\x7f]/.test(value)
  )
}

function isSafeDownloadUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash
  } catch {
    return false
  }
}

function isMode(value: unknown): value is RoomActivationMode {
  return value === 'auto_follow' || value === 'mention_only' || value === 'paused'
}

function invalidResponse(): never {
  throw new RoomActionHttpError('invalid_room_action_response', 'Invalid Room action response.')
}

async function readResponse(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    invalidResponse()
  }
}

function serverError(status: number, value: unknown): RoomActionHttpError {
  let code = `room_action_http_${status}`
  if (value && typeof value === 'object') {
    const candidate = (value as { error?: unknown }).error
    if (typeof candidate === 'string' && /^[a-z0-9_-]{1,80}$/.test(candidate)) code = candidate
  }
  return new RoomActionHttpError(code, 'Shennian Room action failed.')
}

function isTrustedRoomUrl(value: unknown, serverUrl: string, pathname: string): boolean {
  return isTrustedUrl(value, serverUrl, (url) => url.pathname === pathname)
}

function isTrustedInviteUrl(value: unknown, serverUrl: string, roomId: string): boolean {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    if (!isTrustedUrl(`${url.origin}${url.pathname}`, serverUrl, (candidate) =>
      candidate.pathname === `/spaces/${roomId}`,
    )) return false
    return (
      url.searchParams.size === 1 &&
      /^[A-Za-z0-9_-]{32,256}$/.test(url.searchParams.get('invite') ?? '') &&
      !url.hash &&
      !url.username &&
      !url.password
    )
  } catch {
    return false
  }
}

function isTrustedUrl(
  value: unknown,
  serverUrl: string,
  matchPath: (url: URL) => boolean,
): boolean {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    const server = new URL(serverUrl)
    const sameActionOrigin = url.origin === server.origin
    const sameLocalHost =
      server.protocol === 'http:' && url.protocol === 'http:' && url.hostname === server.hostname
    const officialWebOrigin =
      url.protocol === 'https:' &&
      url.port === '' &&
      url.hostname === 'app.shennian.net'
    return (
      (sameActionOrigin || sameLocalHost || officialWebOrigin) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      matchPath(url)
    )
  } catch {
    return false
  }
}
