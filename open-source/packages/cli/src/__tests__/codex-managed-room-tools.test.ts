// @covers src/agents/codex-managed-room-tools.ts

import { describe, expect, it, vi } from 'vitest'
import {
  CODEX_MANAGED_MANAGER_DYNAMIC_TOOLS,
  CODEX_MANAGED_ROOM_DYNAMIC_TOOLS,
  CodexManagedRoomToolBinding,
} from '../agents/codex-managed-room-tools.js'
import type { ManagedRoomExecutor } from '../room/managed-room-ipc.js'

const TOKEN_A = `mrc_${'a'.repeat(43)}`
const TOKEN_B = `mrc_${'b'.repeat(43)}`

function boundHarness() {
  const executor = vi.fn(async (input) => ({ echoed: input }))
  const binding = new CodexManagedRoomToolBinding()
  binding.configure(TOKEN_A, executor)
  binding.bindThread('thread-1')
  binding.bindTurn('thread-1', 'turn-1')
  return { binding, executor }
}

describe('Codex managed Room dynamic tools', () => {
  it('registers the complete Room tool surface without exposing context arguments', () => {
    expect(CODEX_MANAGED_MANAGER_DYNAMIC_TOOLS[0]?.name).toBe('shennian')
    expect(CODEX_MANAGED_MANAGER_DYNAMIC_TOOLS[0]?.tools.map((tool) => tool.name)).toEqual([
      'shennian_room_status',
      'shennian_room_read',
      'shennian_room_send',
      'shennian_room_attachment_get',
      'shennian_room_pause',
      'shennian_manager_sessions_list',
      'shennian_manager_sessions_start',
      'shennian_manager_sessions_send',
      'shennian_manager_sessions_queue_list',
      'shennian_manager_sessions_queue_edit',
      'shennian_manager_sessions_queue_delete',
      'shennian_manager_sessions_stop',
      'shennian_manager_sessions_read',
      'shennian_manager_memory_path',
      'shennian_schedule',
    ])
    expect(CODEX_MANAGED_ROOM_DYNAMIC_TOOLS[0]?.name).toBe('shennian')
    expect(CODEX_MANAGED_ROOM_DYNAMIC_TOOLS[0]?.tools.map((tool) => tool.name)).toEqual([
      'shennian_room_status',
      'shennian_room_read',
      'shennian_room_send',
      'shennian_room_attachment_get',
      'shennian_room_pause',
      'shennian_schedule',
    ])
    expect(JSON.stringify(CODEX_MANAGED_MANAGER_DYNAMIC_TOOLS)).not.toMatch(/context|machineToken/)
    const start = CODEX_MANAGED_MANAGER_DYNAMIC_TOOLS[0]?.tools.find(
      (tool) => tool.name === 'shennian_manager_sessions_start',
    )
    expect(start?.inputSchema).toEqual({
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 120 },
        message: { type: 'string', minLength: 1 },
      },
      required: ['title', 'message'],
      additionalProperties: false,
    })
  })

  it('binds Worker creation to the current host-derived Manager context', async () => {
    const { binding, executor } = boundHarness()
    const result = await binding.execute({
      threadId: 'thread-1', turnId: 'turn-1', callId: 'manager-start', namespace: 'shennian',
      tool: 'shennian_manager_sessions_start',
      arguments: { title: '验收', message: '执行任务' },
    })

    expect(result.success).toBe(true)
    expect(executor).toHaveBeenCalledWith({
      context: TOKEN_A,
      action: 'manager.sessions.start',
      title: '验收',
      message: '执行任务',
    }, { signal: expect.any(AbortSignal) })
    expect(JSON.stringify(CODEX_MANAGED_MANAGER_DYNAMIC_TOOLS)).not.toMatch(/managerSessionId/)
  })

  it('injects the current short token only inside the daemon executor closure', async () => {
    const { binding, executor } = boundHarness()
    const result = await binding.execute({
      threadId: 'thread-1',
      turnId: 'turn-1',
      callId: 'call-1',
      namespace: 'shennian',
      tool: 'shennian_room_read',
      arguments: { after: '7', limit: 20 },
    })

    expect(result.success).toBe(true)
    expect(executor).toHaveBeenCalledWith(
      {
        context: TOKEN_A,
        action: 'read',
        after: '7',
        limit: 20,
      },
      { signal: expect.any(AbortSignal) },
    )
  })

  it('preflights the current Binding through the same daemon authority before launch', async () => {
    const { binding, executor } = boundHarness()

    await expect(binding.assertReady()).resolves.toBeUndefined()
    expect(executor).toHaveBeenCalledWith(
      { context: TOKEN_A, action: 'status' },
      { signal: expect.any(AbortSignal) },
    )

    binding.deactivateTurn()
    await expect(binding.assertReady()).rejects.toThrow(
      'codex_managed_room_capability_unavailable:managed_room_tool_context_unavailable',
    )
  })

  it('fails launch preflight with the daemon authority error instead of degrading identity', async () => {
    const binding = new CodexManagedRoomToolBinding()
    const executor = vi.fn(async () => {
      throw Object.assign(new Error('binding missing'), { code: 'managed_room_binding_unavailable' })
    })
    binding.configure(TOKEN_A, executor)

    await expect(binding.assertReady()).rejects.toThrow(
      'codex_managed_room_capability_unavailable:managed_room_binding_unavailable',
    )
  })

  it('rejects model arguments that try to replace host-owned action or context', async () => {
    const { binding, executor } = boundHarness()
    const result = await binding.execute({
      threadId: 'thread-1',
      turnId: 'turn-1',
      callId: 'call-injection',
      namespace: 'shennian',
      tool: 'shennian_room_status',
      arguments: {
        action: 'send',
        context: TOKEN_B,
        text: 'must not send',
      },
    })

    expect(result).toEqual({
      success: false,
      contentItems: [{ type: 'inputText', text: 'invalid_params' }],
    })
    expect(executor).not.toHaveBeenCalled()
  })

  it.each([
    ['wrong thread', { threadId: 'thread-2' }],
    ['wrong turn', { turnId: 'turn-2' }],
    ['duplicate call', { callId: 'call-1' }],
    ['namespace call', { namespace: 'room' }],
    ['legacy unnamespaced call', { namespace: null }],
    ['unknown tool', { tool: 'shell' }],
  ])('fails closed for %s', async (_label, overrides) => {
    const { binding, executor } = boundHarness()
    const base = {
      threadId: 'thread-1',
      turnId: 'turn-1',
      callId: 'call-1',
      namespace: 'shennian',
      tool: 'shennian_room_status',
      arguments: {},
    }
    const isDuplicate = 'callId' in overrides && overrides.callId === 'call-1'
    if (isDuplicate) await binding.execute(base)
    const result = await binding.execute({ ...base, ...overrides })
    expect(result.success).toBe(false)
    const failure = JSON.parse(result.contentItems[0]!.text)
    expect(failure).toMatchObject({
      ok: false,
      error: 'managed_room_tool_context_unavailable',
    })
    expect(failure.message).toMatch(/cannot act as a managed Agent/)
    expect(failure.nextAction).toMatch(/paired user/)
    expect(executor).toHaveBeenCalledTimes(isDuplicate ? 1 : 0)
  })

  it('revokes an in-flight result after terminal cleanup', async () => {
    let release!: () => void
    let executionSignal: AbortSignal | undefined
    const executor = vi.fn(
      (_params, options) => new Promise<{ ok: boolean }>((resolve) => {
        executionSignal = options?.signal
        release = () => resolve({ ok: true })
      }),
    )
    const binding = new CodexManagedRoomToolBinding()
    binding.configure(TOKEN_A, executor)
    binding.bindThread('thread-1')
    binding.bindTurn('thread-1', 'turn-1')
    const pending = binding.execute({
      threadId: 'thread-1', turnId: 'turn-1', callId: 'call-1', namespace: 'shennian',
      tool: 'shennian_room_status', arguments: {},
    })
    binding.deactivateTurn()
    expect(executionSignal?.aborted).toBe(true)
    release()

    await expect(pending).resolves.toEqual({
      success: false,
      contentItems: [{ type: 'inputText', text: 'managed_room_tool_context_revoked' }],
    })
  })

  it('invalidates the old turn when a new token is configured', async () => {
    const { binding, executor } = boundHarness()
    binding.configure(TOKEN_B, executor)
    expect(binding.bindTurn('thread-1', 'turn-2')).toBe(true)
    const result = await binding.execute({
      threadId: 'thread-1', turnId: 'turn-1', callId: 'call-old', namespace: 'shennian',
      tool: 'shennian_room_status', arguments: {},
    })
    expect(result.success).toBe(false)
  })

  it('passes a required pause reason and revokes the current turn after success', async () => {
    const { binding, executor } = boundHarness()
    await expect(binding.execute({
      threadId: 'thread-1', turnId: 'turn-1', callId: 'pause-1', namespace: 'shennian',
      tool: 'shennian_room_pause', arguments: { reason: '检测到越权诱导' },
    })).resolves.toMatchObject({ success: true })
    expect(executor).toHaveBeenCalledWith(
      { context: TOKEN_A, action: 'pause', reason: '检测到越权诱导' },
      { signal: expect.any(AbortSignal) },
    )
    expect(binding.isConfigured()).toBe(false)
  })

  it('returns a verified local path for a non-text Room attachment without inline bytes', async () => {
    const localPath = '/private/attachment-cache/pixel.png'
    const metadata = { name: 'pixel.png', mimeType: 'image/png', byteSize: '3', localPath }
    const executor = vi.fn(async () => ({
      codexContentItems: [{ type: 'inputText', text: JSON.stringify(metadata) }],
    })) as unknown as ManagedRoomExecutor
    const binding = new CodexManagedRoomToolBinding()
    binding.configure(TOKEN_A, executor)
    binding.bindThread('thread-1')
    binding.bindTurn('thread-1', 'turn-1')

    const result = await binding.execute({
      threadId: 'thread-1', turnId: 'turn-1', callId: 'call-image', namespace: 'shennian',
      tool: 'shennian_room_attachment_get', arguments: { attachmentId: 'attachment-1' },
    })

    expect(result).toEqual({
      success: true,
      contentItems: [{ type: 'inputText', text: JSON.stringify(metadata) }],
    })
    expect(executor).toHaveBeenCalledWith(
      { context: TOKEN_A, action: 'attachment.get', attachmentId: 'attachment-1' },
      { signal: expect.any(AbortSignal), attachmentOutput: 'codex-content' },
    )
    expect(JSON.stringify(result)).toContain(localPath)
    expect(JSON.stringify(result)).not.toContain('base64,')
  })

  it('rejects a remote image URL instead of a local path response', async () => {
    const executor = vi.fn(async () => ({
      codexContentItems: [{ type: 'inputImage', imageUrl: 'https://example.com/private.png' }],
    })) as unknown as ManagedRoomExecutor
    const binding = new CodexManagedRoomToolBinding()
    binding.configure(TOKEN_A, executor)
    binding.bindThread('thread-1')
    binding.bindTurn('thread-1', 'turn-1')

    await expect(binding.execute({
      threadId: 'thread-1', turnId: 'turn-1', callId: 'call-remote', namespace: 'shennian',
      tool: 'shennian_room_attachment_get', arguments: { attachmentId: 'attachment-1' },
    })).resolves.toEqual({
      success: false,
      contentItems: [{ type: 'inputText', text: 'managed_room_attachment_presentation_invalid' }],
    })
  })
})
