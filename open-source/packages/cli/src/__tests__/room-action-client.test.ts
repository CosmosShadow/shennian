// @covers open-source/packages/cli/src/room/room-action-client.ts

import { describe, expect, it, vi } from 'vitest'
import { HttpRoomActionClient } from '../room/room-action-client.js'

const target = {
  machineToken: 'machine-secret',
  roomId: 'room_1',
  bindingId: 'binding_1',
}
const message = {
  id: 'message_1',
  roomId: 'room_1',
  sequence: '3',
  kind: 'text',
  author: {
    membershipId: 'agent_member_1',
    principalType: 'agent',
    ownerUserId: 'user_1',
    displayName: 'Codex',
  },
  text: '完成了',
  attachments: [],
  createdAt: '2026-08-23T10:00:00.000Z',
}

describe('Room action HTTP client', () => {
  it.each([
    {}, { nianSessionId: 'new-session', sessionRegistryKey: 'a'.repeat(64) },
    { nianSessionId: null, sessionRegistryKey: 'a'.repeat(64) },
  ])('accepts legacy or authoritative status identity without inventing an owner', async (identity) => {
    const body = { bindingId: 'binding_1', roomId: 'room_1', agentIdentityId: 'agent_1',
      agentMembershipId: 'member_1', status: 'active', activationMode: 'auto_follow',
      lastDeliveredSequence: '0', lastActivatedSequence: '0',
      room: { name: 'Room', status: 'active', lastSequence: '0' }, ...identity }
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body)))
    const result = await new HttpRoomActionClient('https://shennian.net', fetchImpl as typeof fetch).status(target)
    expect(result.nianSessionId).toBe(identity.nianSessionId)
    expect(result.sessionRegistryKey).toBe(identity.sessionRegistryKey)
  })

  it.each([{ nianSessionId: 123 }, { sessionRegistryKey: 'invalid' }])(
    'rejects malformed authoritative identity', async (identity) => {
      const body = { bindingId: 'binding_1', roomId: 'room_1', agentIdentityId: 'agent_1',
        agentMembershipId: 'member_1', status: 'active', activationMode: 'auto_follow',
        lastDeliveredSequence: '0', lastActivatedSequence: '0',
        room: { name: 'Room', status: 'active', lastSequence: '0' }, ...identity }
      const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body)))
      await expect(new HttpRoomActionClient('https://shennian.net', fetchImpl as typeof fetch).status(target))
        .rejects.toThrow()
    },
  )

  it.each([
    null,
    {
      policyVersion: 4,
      runtimeAdapter: 'codex',
      runtimeVersion: '0.152.1',
      platform: 'darwin',
      executableFingerprint: `sha256:${'a'.repeat(64)}`,
      hostFullAccess: false,
      limitedProtection: false,
      confirmedAt: '2026-09-05T00:00:00.000Z',
    },
  ])('normalizes older status payloads to restricted execution without broadening permissions', async (permissionConfirmation) => {
    const body = {
      bindingId: 'binding_1',
      roomId: 'room_1',
      agentIdentityId: 'agent_1',
      agentMembershipId: 'agent_member_1',
      status: 'active',
      activationCapability: 'managed',
      activationMode: 'auto_follow',
      managedWorkspacePath: '/code/shennian',
      lastDeliveredSequence: '3',
      lastActivatedSequence: '3',
      agent: {
        displayName: 'Support',
        description: 'Answer support questions',
        sessionMode: 'standard',
        permissionPolicy: {
          version: 4,
          fileAccess: 'workspace-write',
          externalCapabilities: {
            commandNetwork: false,
            webSearch: false,
            browser: false,
            computerUse: false,
            mcp: false,
          },
        },
        permissionConfirmation,
      },
      room: { name: '研发协作', status: 'active', lastSequence: '3' },
    }
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body)))

    await expect(
      new HttpRoomActionClient('https://shennian.net', fetchImpl as typeof fetch).status(target),
    ).resolves.toEqual({
      ...body,
      agent: {
        ...body.agent,
        permissionPolicy: { ...body.agent.permissionPolicy, executionMode: 'restricted' },
        permissionConfirmation: permissionConfirmation
          ? { ...permissionConfirmation, executionMode: 'restricted' }
          : null,
      },
    })
  })

  it.each([
    undefined,
    {
      version: 1,
      fileAccess: 'workspace-write',
      externalCapabilities: { commandNetwork: false },
    },
  ])('rejects a missing or incomplete managed Agent policy from status', async (permissionPolicy) => {
    const body = {
      bindingId: 'binding_1',
      roomId: 'room_1',
      agentIdentityId: 'agent_1',
      agentMembershipId: 'agent_member_1',
      status: 'active',
      activationCapability: 'managed',
      activationMode: 'auto_follow',
      managedWorkspacePath: '/code/shennian',
      lastDeliveredSequence: '3',
      lastActivatedSequence: '3',
      agent: {
        displayName: 'Support',
        description: 'Answer support questions',
        sessionMode: 'standard',
        ...(permissionPolicy === undefined ? {} : { permissionPolicy }),
        permissionConfirmation: null,
      },
      room: { name: '研发协作', status: 'active', lastSequence: '3' },
    }
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body)))

    await expect(
      new HttpRoomActionClient('https://shennian.net', fetchImpl as typeof fetch).status(target),
    ).rejects.toMatchObject({ code: 'invalid_room_action_response' })
  })

  it.each([
    undefined,
    {
      policyVersion: 4,
      runtimeAdapter: 'codex',
      runtimeVersion: '0.152.1',
      platform: 'darwin',
      executableFingerprint: 'not-a-digest',
      hostFullAccess: false,
      limitedProtection: false,
      confirmedAt: '2026-09-05T00:00:00.000Z',
    },
  ])('rejects a missing or malformed permission confirmation field', async (permissionConfirmation) => {
    const body = {
      bindingId: 'binding_1',
      roomId: 'room_1',
      agentIdentityId: 'agent_1',
      agentMembershipId: 'agent_member_1',
      status: 'active',
      activationCapability: 'managed',
      activationMode: 'auto_follow',
      managedWorkspacePath: '/code/shennian',
      lastDeliveredSequence: '3',
      lastActivatedSequence: '3',
      agent: {
        displayName: 'Support',
        description: 'Answer support questions',
        sessionMode: 'standard',
        permissionPolicy: {
          version: 4,
          fileAccess: 'workspace-write',
          externalCapabilities: {
            commandNetwork: false,
            webSearch: false,
            browser: false,
            computerUse: false,
            mcp: false,
          },
        },
        ...(permissionConfirmation === undefined ? {} : { permissionConfirmation }),
      },
      room: { name: '研发协作', status: 'active', lastSequence: '3' },
    }
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body)))

    await expect(
      new HttpRoomActionClient('https://shennian.net', fetchImpl as typeof fetch).status(target),
    ).rejects.toMatchObject({ code: 'invalid_room_action_response' })
  })

  it('creates an owner-only private approval Room through the operator endpoint', async () => {
    const body = {
      outcome: 'created',
      room: {
        id: 'room_1',
        name: '研发协作',
        visibility: 'private',
        joinPolicy: 'open',
        canonicalUrl: 'https://app.shennian.net/spaces/room_1',
      },
    }
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status: 201 }))
    const client = new HttpRoomActionClient('https://shennian.net', fetchImpl as typeof fetch)

    await expect(
      client.createOperatorRoom({ machineToken: 'machine-secret', name: '研发协作' }),
    ).resolves.toEqual(body)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://shennian.net/api/rooms/actions/operator/create')
    expect(init.headers).toMatchObject({ authorization: 'Bearer machine-secret' })
    expect(JSON.parse(String(init.body))).toEqual({ name: '研发协作' })
    expect(String(init.body)).not.toContain('machine-secret')
  })

  it('resolves a native Session with machine auth without putting its identity in the URL', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            nianSessionId: 'nian_1',
            created: true,
          }),
        ),
    )
    const client = new HttpRoomActionClient('https://shennian.net', fetchImpl as typeof fetch)
    await expect(
      client.resolveNativeSession({
        machineToken: 'machine-secret',
        runtimeAdapter: 'claude_code',
        sourceSessionKey: 'private-claude-session',
      }),
    ).resolves.toEqual({ nianSessionId: 'nian_1', created: true })

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://shennian.net/api/rooms/actions/resolve-session')
    expect(url).not.toContain('private-claude-session')
    expect(init.headers).toMatchObject({ authorization: 'Bearer machine-secret' })
    expect(String(init.body)).toContain('private-claude-session')
    expect(String(init.body)).not.toContain('machine-secret')
  })

  it('creates a private approval Room and validates official navigation URLs', async () => {
    const body = {
      outcome: 'created',
      room: {
        id: 'room_1',
        name: '研发协作',
        visibility: 'private',
        joinPolicy: 'open',
        canonicalUrl: 'https://app.shennian.net/spaces/room_1',
        inviteUrl: `https://app.shennian.net/spaces/room_1?invite=${'a'.repeat(43)}`,
      },
      agentIdentity: { id: 'agent_1', displayName: '我的 Codex' },
      binding: {
        id: 'binding_1',
        roomId: 'room_1',
        agentIdentityId: 'agent_1',
        agentMembershipId: 'agent_member_1',
        status: 'active',
        activationMode: 'auto_follow',
      },
      idempotent: false,
    }
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status: 201 }))
    const client = new HttpRoomActionClient('https://shennian.net', fetchImpl as typeof fetch)
    const input = {
      machineToken: 'machine-secret',
      bindingIntentId: 'room-create:intent_1',
      nianSessionId: 'nian_1',
      runtimeAdapter: 'codex' as const,
      sessionRegistryKey: 'a'.repeat(64),
      name: '研发协作',
      agentAlias: '我的 Codex',
      agentDescription: '负责研发协作',
      activationCapability: 'idle_resume' as const,
      activationMode: 'auto_follow' as const,
    }

    await expect(client.createRoom(input)).resolves.toEqual(body)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://shennian.net/api/rooms/actions/create')
    expect(init.headers).toMatchObject({ authorization: 'Bearer machine-secret' })
    expect(String(init.body)).not.toContain('machine-secret')
  })

  it('accepts official HTTPS navigation when a local API returns its production URLs', async () => {
    const body = {
      outcome: 'created',
      room: {
        id: 'room_1',
        name: '本地联调',
        visibility: 'private',
        joinPolicy: 'open',
        canonicalUrl: 'https://app.shennian.net/spaces/room_1',
        inviteUrl: `https://app.shennian.net/spaces/room_1?invite=${'a'.repeat(43)}`,
      },
      agentIdentity: { id: 'agent_1', displayName: '我的 Codex' },
      binding: {
        id: 'binding_1',
        roomId: 'room_1',
        agentIdentityId: 'agent_1',
        agentMembershipId: 'agent_member_1',
        status: 'active',
        activationMode: 'mention_only',
      },
      idempotent: false,
    }
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status: 201 }))
    const client = new HttpRoomActionClient('http://127.0.0.1:3000', fetchImpl as typeof fetch)

    await expect(
      client.createRoom({
        machineToken: 'machine-secret',
        bindingIntentId: 'room-create:intent_1',
        nianSessionId: 'nian_1',
        runtimeAdapter: 'codex',
        sessionRegistryKey: 'a'.repeat(64),
        name: '本地联调',
        agentAlias: '我的 Codex',
        activationCapability: 'idle_resume',
        activationMode: 'mention_only',
      }),
    ).resolves.toEqual(body)
  })

  it('rejects navigation URLs from unrelated or non-default HTTPS origins', async () => {
    const base = {
      outcome: 'created',
      room: {
        id: 'room_1',
        name: '安全验证',
        visibility: 'private',
        joinPolicy: 'open',
        canonicalUrl: 'https://evil.example/spaces/room_1',
        inviteUrl: `https://app.shennian.net/spaces/room_1?invite=${'a'.repeat(43)}`,
      },
      agentIdentity: { id: 'agent_1', displayName: '我的 Codex' },
      binding: {
        id: 'binding_1',
        roomId: 'room_1',
        agentIdentityId: 'agent_1',
        agentMembershipId: 'agent_member_1',
        status: 'active',
        activationMode: 'auto_follow',
      },
      idempotent: false,
    }
    const input = {
      machineToken: 'machine-secret',
      bindingIntentId: 'room-create:intent_1',
      nianSessionId: 'nian_1',
      runtimeAdapter: 'codex' as const,
      sessionRegistryKey: 'a'.repeat(64),
      name: '安全验证',
      agentAlias: '我的 Codex',
      activationCapability: 'idle_resume' as const,
      activationMode: 'auto_follow' as const,
    }
    const unrelated = vi.fn(async () => new Response(JSON.stringify(base), { status: 201 }))
    await expect(
      new HttpRoomActionClient('http://127.0.0.1:3000', unrelated as typeof fetch).createRoom(
        input,
      ),
    ).rejects.toMatchObject({ code: 'invalid_room_action_response' })

    const nonDefaultPort = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ...base,
            room: { ...base.room, canonicalUrl: 'https://shennian.net:444/spaces/room_1' },
          }),
          { status: 201 },
        ),
    )
    await expect(
      new HttpRoomActionClient('http://127.0.0.1:3000', nonDefaultPort as typeof fetch).createRoom(
        input,
      ),
    ).rejects.toMatchObject({ code: 'invalid_room_action_response' })
  })

  it('keeps machine credentials only in the header and validates read responses', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            messages: [message],
            nextSequence: '3',
            hasMore: false,
            historyFromSequence: '1',
            roomName: '研发协作',
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
    )
    const client = new HttpRoomActionClient('https://shennian.net/', fetchImpl as typeof fetch)

    await expect(client.read({ ...target, afterSequence: '0', limit: 50 })).resolves.toMatchObject({
      nextSequence: '3',
      messages: [{ id: 'message_1' }],
    })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    const requestUrl = new URL(url)
    expect(`${requestUrl.origin}${requestUrl.pathname}`).toBe(
      'https://shennian.net/api/rooms/room_1/bindings/binding_1/messages',
    )
    expect(Object.fromEntries(requestUrl.searchParams)).toEqual({ limit: '50', after: '0' })
    expect(init.headers).toMatchObject({ authorization: 'Bearer machine-secret' })
    expect(url).not.toContain('machine-secret')
  })

  it('validates a short HTTPS attachment download capability', async () => {
    const body = {
      attachmentId: 'attachment_1',
      roomId: 'room_1',
      safeName: 'diagram.png',
      mimeType: 'image/png',
      byteSize: '3',
      sha256: 'a'.repeat(64),
      downloadUrl: 'https://room-files.example/diagram.png?signature=short',
      expiresAt: '2026-08-23T10:01:00.000Z',
    }
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body)))
    const client = new HttpRoomActionClient('https://shennian.net', fetchImpl as typeof fetch)

    await expect(
      client.getAttachmentCapability({ ...target, attachmentId: 'attachment_1' }),
    ).resolves.toEqual(body)
    const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(
      'https://shennian.net/api/rooms/room_1/bindings/binding_1/attachments/attachment_1/download-capability',
    )

    body.downloadUrl = 'http://127.0.0.1/secret'
    await expect(
      client.getAttachmentCapability({ ...target, attachmentId: 'attachment_1' }),
    ).rejects.toMatchObject({ code: 'invalid_room_action_response' })
  })

  it('aborts a managed Room request as soon as its Turn capability is revoked', async () => {
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true },
        )
      }),
    )
    const controller = new AbortController()
    const client = new HttpRoomActionClient('https://shennian.net', fetchImpl as typeof fetch)
    const pending = client.read({ ...target, limit: 1, signal: controller.signal })

    controller.abort()

    await expect(pending).rejects.toMatchObject({ code: 'managed_room_context_revoked' })
  })

  it('joins an approval Room while keeping the invitation capability out of the URL', async () => {
    const inviteToken = 'i'.repeat(43)
    const body = {
      outcome: 'pending_approval',
      room: {
        id: 'room_2',
        name: '外部协作',
        canonicalUrl: 'https://app.shennian.net/spaces/room_2',
      },
      agentIdentity: { id: 'agent_2', displayName: '我的 Codex' },
      binding: {
        id: 'binding_2',
        roomId: 'room_2',
        agentIdentityId: 'agent_2',
        agentMembershipId: null,
        status: 'pending_approval',
        activationMode: 'auto_follow',
      },
      joinRequestId: 'request_1',
      idempotent: false,
    }
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status: 202 }))
    const client = new HttpRoomActionClient('https://shennian.net', fetchImpl as typeof fetch)

    await expect(
      client.joinRoom({
        machineToken: 'machine-secret',
        bindingIntentId: 'room-join:intent_1',
        nianSessionId: 'nian_1',
        runtimeAdapter: 'codex',
        sessionRegistryKey: 'a'.repeat(64),
        inviteToken,
        agentAlias: '我的 Codex',
        agentDescription: '负责外部协作',
        activationCapability: 'idle_resume',
        activationMode: 'auto_follow',
      }),
    ).resolves.toEqual(body)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://shennian.net/api/rooms/actions/join')
    expect(url).not.toContain(inviteToken)
    expect(init.headers).toMatchObject({ authorization: 'Bearer machine-secret' })
  })

  it('validates the attachment init response before exposing the signed upload target', async () => {
    const sha256 = 'a'.repeat(64)
    const valid = {
      attachment: {
        id: 'attachment_1', roomId: 'room_1', name: 'note.txt', mimeType: 'text/plain',
        byteSize: '5', sha256, status: 'pending',
      },
      upload: {
        method: 'PUT', url: 'https://room-files.example/upload?private-signature',
        headers: { 'content-type': 'text/plain', 'x-oss-meta-sha256': sha256 },
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      idempotent: false,
    }
    const client = new HttpRoomActionClient(
      'https://shennian.net',
      vi.fn(async () => new Response(JSON.stringify(valid), { status: 201 })) as typeof fetch,
    )

    await expect(client.initializeAttachment({
      ...target, clientUploadId: 'upload_1', name: 'note.txt', mediaKind: 'file',
      mimeType: 'text/plain', byteSize: 5, sha256,
    })).resolves.toEqual(valid)

    const malformed = { ...valid, attachment: { ...valid.attachment, name: undefined } }
    const malformedClient = new HttpRoomActionClient(
      'https://shennian.net',
      vi.fn(async () => new Response(JSON.stringify(malformed), { status: 201 })) as typeof fetch,
    )
    await expect(malformedClient.initializeAttachment({
      ...target, clientUploadId: 'upload_2', name: 'note.txt', mediaKind: 'file',
      mimeType: 'text/plain', byteSize: 5, sha256,
    })).rejects.toMatchObject({ code: 'invalid_room_action_response' })
  })

  it('rejects cross-Room messages and does not expose server error details', async () => {
    const mismatched = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            messages: [{ ...message, roomId: 'room_attacker' }],
            nextSequence: '3',
            hasMore: false,
            historyFromSequence: '1',
            roomName: '研发协作',
          }),
          { status: 200 },
        ),
    )
    await expect(
      new HttpRoomActionClient('https://shennian.net', mismatched as typeof fetch).read({
        ...target,
        afterSequence: '0',
        limit: 50,
      }),
    ).rejects.toMatchObject({ code: 'invalid_room_action_response' })

    const denied = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'room_binding_unavailable', message: 'database' }), {
          status: 403,
        }),
    )
    await expect(
      new HttpRoomActionClient('https://shennian.net', denied as typeof fetch).status(target),
    ).rejects.toMatchObject({
      code: 'room_binding_unavailable',
      message: 'Shennian Room action failed.',
    })
  })

  it('sends only public action fields and validates the exact Binding mode response', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message, idempotent: false }), { status: 201 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            bindingId: 'binding_1',
            roomId: 'room_1',
            status: 'paused',
            activationMode: 'paused',
            idempotent: false,
          }),
          { status: 200 },
        ),
      )
    const client = new HttpRoomActionClient('https://shennian.net', fetchImpl as typeof fetch)

    await client.send({ ...target, clientMessageId: 'client_1', text: '完成了' })
    await client.mode({ ...target, activationMode: 'paused' })
    const sendBody = String((fetchImpl.mock.calls[0]![1] as RequestInit).body)
    expect(sendBody).toContain('client_1')
    expect(sendBody).not.toContain('machine-secret')
  })
})
