// @covers open-source/packages/cli/src/room/room-binding-client.ts

import { describe, expect, it, vi } from 'vitest'
import { HttpRoomBindingClient } from '../room/room-binding-client.js'

const input = {
  machineToken: 'machine-secret-token',
  bindingIntentId: 'room-bind:intent_1',
  roomId: 'room_1',
  agentIdentityId: 'agent_1',
  nianSessionId: 'nian_1',
  runtimeAdapter: 'codex' as const,
  sessionRegistryKey: 'a'.repeat(64),
  activationCapability: 'idle_resume' as const,
  activationMode: 'auto_follow' as const,
}

const responseBody = {
  binding: {
    id: 'binding_1',
    roomId: 'room_1',
    agentIdentityId: 'agent_1',
    agentMembershipId: 'agent_member_1',
    nianSessionId: 'nian_1',
    runtimeAdapter: 'codex',
    activationCapability: 'idle_resume',
    activationMode: 'auto_follow',
    status: 'active',
  },
  resumeSequence: '12',
  idempotent: false,
}

describe('Room Binding HTTP client', () => {
  it('keeps machine credentials in the header and sends no invocation or native Session token', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify(responseBody), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const client = new HttpRoomBindingClient('https://shennian.net/', fetchImpl as typeof fetch)

    await expect(client.create(input)).resolves.toEqual(responseBody)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://shennian.net/api/rooms/room_1/bindings')
    expect(init.headers).toMatchObject({ authorization: 'Bearer machine-secret-token' })
    expect(init.body).not.toContain('machine-secret-token')
    expect(init.body).not.toContain('invocationToken')
    expect(init.body).not.toContain('native-session')
  })

  it('rejects a mismatched server identity instead of accepting a cross-Session response', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ...responseBody,
            binding: { ...responseBody.binding, nianSessionId: 'nian_attacker' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    )
    const client = new HttpRoomBindingClient('https://shennian.net', fetchImpl as typeof fetch)

    await expect(client.create(input)).rejects.toMatchObject({
      code: 'invalid_room_binding_response',
    })
  })

  it('rejects a server response that silently changes the selected managed mode', async () => {
    const managedInput = {
      ...input,
      activationCapability: 'managed' as const,
    }
    const normalizedResponse = {
      ...responseBody,
      binding: {
        ...responseBody.binding,
        activationCapability: 'managed',
        activationMode: 'mention_only',
      },
    }
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify(normalizedResponse), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const client = new HttpRoomBindingClient('https://shennian.net', fetchImpl as typeof fetch)

    await expect(client.create(managedInput)).rejects.toMatchObject({
      code: 'invalid_room_binding_response',
    })
  })

  it('rejects mention-only normalization for a non-managed binding', async () => {
    const normalizedResponse = {
      ...responseBody,
      binding: { ...responseBody.binding, activationMode: 'mention_only' },
    }
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify(normalizedResponse), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const client = new HttpRoomBindingClient('https://shennian.net', fetchImpl as typeof fetch)

    await expect(client.create(input)).rejects.toMatchObject({
      code: 'invalid_room_binding_response',
    })
  })

  it('keeps an explicitly requested managed mode strict', async () => {
    const managedMentionInput = {
      ...input,
      activationCapability: 'managed' as const,
      activationMode: 'mention_only' as const,
    }
    const widenedResponse = {
      ...responseBody,
      binding: {
        ...responseBody.binding,
        activationCapability: 'managed',
        activationMode: 'auto_follow',
      },
    }
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify(widenedResponse), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const client = new HttpRoomBindingClient('https://shennian.net', fetchImpl as typeof fetch)

    await expect(client.create(managedMentionInput)).rejects.toMatchObject({
      code: 'invalid_room_binding_response',
    })
  })

  it('returns only a safe server error code', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: 'room_binding_conflict',
            message: 'sensitive database detail',
          }),
          { status: 409, headers: { 'content-type': 'application/json' } },
        ),
    )
    const client = new HttpRoomBindingClient('https://shennian.net', fetchImpl as typeof fetch)

    await expect(client.create(input)).rejects.toMatchObject({
      code: 'room_binding_conflict',
      message: 'Shennian Room binding request failed.',
    })
  })
})
