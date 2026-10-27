// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/room-binding-client.test.ts

import type {
  RoomActivationCapability,
  RoomActivationMode,
  RoomBindingStatus,
  RoomRuntimeAdapter,
} from '@shennian/wire'
import { HttpRoomActionClient } from './room-action-client.js'

type FetchLike = typeof fetch

export type CreateRemoteRoomBindingInput = {
  machineToken: string
  bindingIntentId: string
  roomId: string
  agentIdentityId: string
  nianSessionId: string
  runtimeAdapter: RoomRuntimeAdapter
  sessionRegistryKey: string
  activationCapability: RoomActivationCapability
  activationMode: RoomActivationMode
}

export type RestartRemoteRoomBindingInput = Omit<
  CreateRemoteRoomBindingInput,
  'bindingIntentId' | 'activationCapability' | 'activationMode'
> & {
  bindingId: string
  previousNianSessionId: string
}

export type RemoteRoomBinding = {
  id: string
  roomId: string
  agentIdentityId: string
  agentMembershipId: string
  nianSessionId: string
  runtimeAdapter: RoomRuntimeAdapter
  activationCapability: RoomActivationCapability
  activationMode: RoomActivationMode
  status: RoomBindingStatus
}

export class RoomBindingHttpError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'RoomBindingHttpError'
  }
}

export class HttpRoomBindingClient {
  private readonly baseUrl: string
  private readonly actionClient: HttpRoomActionClient

  constructor(
    serverUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    this.baseUrl = serverUrl.replace(/\/+$/, '')
    this.actionClient = new HttpRoomActionClient(serverUrl, fetchImpl)
  }

  status: HttpRoomActionClient['status'] = (target) => this.actionClient.status(target)
  getAttachmentCapability: HttpRoomActionClient['getAttachmentCapability'] = (target) =>
    this.actionClient.getAttachmentCapability(target)
  initializeAttachment: HttpRoomActionClient['initializeAttachment'] = (target) =>
    this.actionClient.initializeAttachment(target)
  completeAttachment: HttpRoomActionClient['completeAttachment'] = (target) =>
    this.actionClient.completeAttachment(target)
  createRoom: HttpRoomActionClient['createRoom'] = (input) => this.actionClient.createRoom(input)
  createOperatorRoom: HttpRoomActionClient['createOperatorRoom'] = (input) =>
    this.actionClient.createOperatorRoom(input)
  resolveNativeSession: HttpRoomActionClient['resolveNativeSession'] = (input) =>
    this.actionClient.resolveNativeSession(input)
  joinRoom: HttpRoomActionClient['joinRoom'] = (input) => this.actionClient.joinRoom(input)
  read: HttpRoomActionClient['read'] = (target) => this.actionClient.read(target)
  send: HttpRoomActionClient['send'] = (target) => this.actionClient.send(target)
  mode: HttpRoomActionClient['mode'] = (target) => this.actionClient.mode(target)
  pause: HttpRoomActionClient['pause'] = (target) => this.actionClient.pause(target)

  async create(
    input: CreateRemoteRoomBindingInput,
  ): Promise<{ binding: RemoteRoomBinding; resumeSequence: string; idempotent: boolean }> {
    let response: Response
    try {
      response = await this.fetchImpl(
        `${this.baseUrl}/api/rooms/${encodeURIComponent(input.roomId)}/bindings`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${input.machineToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            bindingIntentId: input.bindingIntentId,
            agentIdentityId: input.agentIdentityId,
            nianSessionId: input.nianSessionId,
            runtimeAdapter: input.runtimeAdapter,
            sessionRegistryKey: input.sessionRegistryKey,
            activationCapability: input.activationCapability,
            activationMode: input.activationMode,
          }),
          signal: AbortSignal.timeout(10_000),
        },
      )
    } catch {
      throw new RoomBindingHttpError(
        'room_binding_server_unavailable',
        'Shennian Room service is unavailable.',
      )
    }
    if (!response.ok) {
      let code = `room_binding_http_${response.status}`
      try {
        const body = (await response.json()) as { error?: unknown }
        if (typeof body.error === 'string' && /^[a-z0-9_-]{1,80}$/.test(body.error))
          code = body.error
      } catch {}
      throw new RoomBindingHttpError(code, 'Shennian Room binding request failed.')
    }
    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new RoomBindingHttpError(
        'invalid_room_binding_response',
        'Invalid Room binding response.',
      )
    }
    return validateResponse(body, input)
  }

  async restart(input: RestartRemoteRoomBindingInput): Promise<{
    binding: RemoteRoomBinding
    resumeSequence: string
    idempotent: boolean
  }> {
    let response: Response
    try {
      response = await this.fetchImpl(
        `${this.baseUrl}/api/rooms/${encodeURIComponent(input.roomId)}/bindings/${encodeURIComponent(input.bindingId)}/session`,
        {
          method: 'PATCH',
          headers: {
            authorization: `Bearer ${input.machineToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            agentIdentityId: input.agentIdentityId,
            previousNianSessionId: input.previousNianSessionId,
            nianSessionId: input.nianSessionId,
            runtimeAdapter: input.runtimeAdapter,
            sessionRegistryKey: input.sessionRegistryKey,
          }),
          signal: AbortSignal.timeout(10_000),
        },
      )
    } catch {
      throw new RoomBindingHttpError(
        'room_binding_server_unavailable',
        'Shennian Room service is unavailable.',
      )
    }
    const body = await response.json().catch(() => null)
    if (!response.ok) {
      const code =
        body && typeof body.error === 'string' && /^[a-z0-9_-]{1,80}$/.test(body.error)
          ? body.error
          : `room_binding_http_${response.status}`
      throw new RoomBindingHttpError(code, 'Shennian Room restart request failed.')
    }
    const result = body as {
      binding?: Partial<RemoteRoomBinding>
      resumeSequence?: unknown
      idempotent?: unknown
    }
    if (
      !result?.binding ||
      result.binding.id !== input.bindingId ||
      result.binding.roomId !== input.roomId ||
      result.binding.agentIdentityId !== input.agentIdentityId ||
      result.binding.nianSessionId !== input.nianSessionId ||
      result.binding.runtimeAdapter !== input.runtimeAdapter ||
      typeof result.binding.agentMembershipId !== 'string' ||
      typeof result.resumeSequence !== 'string' ||
      !/^(0|[1-9]\d{0,19})$/.test(result.resumeSequence) ||
      typeof result.idempotent !== 'boolean'
    ) {
      throw new RoomBindingHttpError(
        'invalid_room_binding_response',
        'Invalid Room restart response.',
      )
    }
    return {
      binding: result.binding as RemoteRoomBinding,
      resumeSequence: result.resumeSequence,
      idempotent: result.idempotent,
    }
  }
}

function validateResponse(value: unknown, input: CreateRemoteRoomBindingInput) {
  if (!value || typeof value !== 'object') {
    throw new RoomBindingHttpError(
      'invalid_room_binding_response',
      'Invalid Room binding response.',
    )
  }
  const object = value as {
    binding?: Partial<RemoteRoomBinding>
    resumeSequence?: unknown
    idempotent?: unknown
  }
  const binding = object.binding
  if (
    !binding ||
    typeof binding.id !== 'string' ||
    typeof binding.agentMembershipId !== 'string' ||
    binding.roomId !== input.roomId ||
    binding.agentIdentityId !== input.agentIdentityId ||
    binding.nianSessionId !== input.nianSessionId ||
    binding.runtimeAdapter !== input.runtimeAdapter ||
    binding.activationCapability !== input.activationCapability ||
    !matchesRequestedActivationMode(binding.activationMode, input) ||
    !['pending_approval', 'active', 'paused', 'detached'].includes(binding.status ?? '') ||
    typeof object.resumeSequence !== 'string' ||
    !/^(0|[1-9]\d{0,19})$/.test(object.resumeSequence) ||
    typeof object.idempotent !== 'boolean'
  ) {
    throw new RoomBindingHttpError(
      'invalid_room_binding_response',
      'Room binding response does not match the request.',
    )
  }
  return {
    binding: binding as RemoteRoomBinding,
    resumeSequence: object.resumeSequence,
    idempotent: object.idempotent,
  }
}

function matchesRequestedActivationMode(
  responseMode: RoomActivationMode | undefined,
  input: CreateRemoteRoomBindingInput,
): boolean {
  return responseMode === input.activationMode
}
