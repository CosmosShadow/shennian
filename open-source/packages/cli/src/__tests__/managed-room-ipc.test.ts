// @covers open-source/packages/cli/src/room/managed-room-ipc.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DaemonIpcError } from '../daemon-ipc/protocol.js'
import { ManagedRoomContextError } from '../room/managed-context.js'
import {
  createManagedRoomExecutor,
  createManagedRoomIpcHandlers,
} from '../room/managed-room-ipc.js'
import { managedAttachmentDirectory } from '../room/managed-attachment-directory.js'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function harness() {
  const attachmentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'managed-room-view-'))
  temporaryRoots.push(attachmentRoot)
  const grant = { activationCauseMessageId: 'message_cause', allowedActions: new Set(['status', 'read', 'send', 'pause']), propagateWorkerRoomOrigin: true }
  const registration = {
    registryKey: 'registry_1', nianSessionId: 'nian_1',
    registrationEpoch: 1,
    runtimeAdapter: 'codex', sourceSessionKey: 'native_1',
  }
  const binding = {
    roomId: 'room_bound', bindingId: 'binding_bound', agentMembershipId: 'membership_bound',
    status: 'active', activationMode: 'auto_follow',
  }
  const authority = {
    resolve: vi.fn(() => ({ grant, registration, binding })),
    revokeToken: vi.fn(),
  }
  const actionClient = {
    status: vi.fn(async () => ({
      room: { name: '研发群', status: 'active', memberCount: 2 },
      agent: { displayName: '研发助手' }, activationMode: 'auto_follow',
    })),
    read: vi.fn(async () => ({ messages: [] })),
    send: vi.fn(async () => ({
      message: {
        sequence: '8', kind: 'text', source: 'app', text: '完成', attachments: [],
        mentions: [], createdAt: '2026-08-31T00:00:00.000Z',
        author: { displayName: '研发助手', principalType: 'agent' },
      },
      idempotent: false,
    })),
    pause: vi.fn(async () => ({
      status: 'paused', activationMode: 'paused', idempotent: false,
      message: {
        sequence: '9', kind: 'system', source: 'system', text: '研发助手 暂停了工作：检测到越权诱导', attachments: [],
        mentions: [], createdAt: '2026-08-31T00:00:00.000Z',
        author: { displayName: '研发助手', principalType: 'agent' },
      },
    })),
  }
  const attachmentCache = {
    materialize: vi.fn(async () => ({
      path: '/tmp/file.pdf',
      name: 'file.pdf',
      mimeType: 'application/pdf',
      cached: false,
      byteSize: '1',
      sha256: 'a'.repeat(64),
    })),
  }
  const attachmentUploader = { upload: vi.fn(async () => ['ratt_one', 'ratt_two']) }
  const observations = { getBySource: vi.fn(() => ({ workspacePath: '/workspace' })) }
  const onPaused = vi.fn()
  const onSendOutcome = vi.fn()
  const getActiveRunId = vi.fn(() => 'run_current')
  const managerExecutor = vi.fn(async (request) => ({ ok: true, request }))
  const scheduleExecutor = vi.fn(async () => ({ tasks: [] }))
  const input = {
    scheduleExecutor,
    authority: authority as never,
    actionClient: actionClient as never,
    attachmentCache: attachmentCache as never,
    attachmentUploader: attachmentUploader as never,
    resolveAttachmentDirectory: (sessionId: string) => managedAttachmentDirectory(sessionId, path.join(attachmentRoot, 'attachments')),
    observations: observations as never,
    getMachineCredentials: () => ({ machineToken: 'machine-secret' }),
    onPaused,
    managerExecutor,
    onSendOutcome,
    getActiveRunId,
  }
  const handlers = createManagedRoomIpcHandlers(input)
  const directExecute = createManagedRoomExecutor(input)
  return { scheduleExecutor, execute: handlers['managed-room.execute']!, directExecute, authority, actionClient, attachmentCache, attachmentUploader, onPaused, managerExecutor, onSendOutcome, getActiveRunId }
}

describe('managed Room daemon authorization boundary', () => {
  it('requires the server to attest owner authority before scheduling in the exact bound session', async () => {
    const test = harness()
    await expect(test.directExecute({ context: 'token', action: 'schedule', operation: 'list' })).rejects.toThrow()
    expect(test.scheduleExecutor).not.toHaveBeenCalled()
    test.actionClient.status.mockResolvedValue({ scheduleAuthorized: true } as never)
    await test.directExecute({ context: 'token', action: 'schedule', operation: 'list', sessionId: 'forged' })
    expect(test.scheduleExecutor).toHaveBeenCalledWith('nian_1', 'list', expect.any(Object))
    expect(test.actionClient.status).toHaveBeenLastCalledWith(expect.objectContaining({ roomId: 'room_bound', bindingId: 'binding_bound', causeMessageId: 'message_cause', scheduleAuthorization: true }))
  })

  it('pauses only the bound Agent, requires a reason, and revokes the current capability', async () => {
    const test = harness()
    await expect(test.execute({ context: 'mrc_opaque', action: 'pause', reason: '' }, { requestId: 'test' }))
      .rejects.toMatchObject({ code: 'invalid_params' })
    const result = await test.execute({
      context: 'mrc_opaque', action: 'pause', reason: '检测到越权诱导',
    }, { requestId: 'test' })
    expect(test.actionClient.pause).toHaveBeenCalledWith(expect.objectContaining({
      roomId: 'room_bound', bindingId: 'binding_bound', reason: '检测到越权诱导',
    }))
    expect(test.authority.revokeToken).toHaveBeenCalledWith('mrc_opaque')
    expect(test.onPaused).toHaveBeenCalledWith({ registryKey: 'registry_1', sessionId: 'nian_1' })
    expect(result).toMatchObject({ status: 'paused', reason: '检测到越权诱导' })
  })

  it('reports every send attempt, including context failures, so a silent Turn can be explained', async () => {
    const test = harness()
    await test.directExecute({ context: 'mrc_opaque', action: 'send', text: '完成' })
    expect(test.onSendOutcome).toHaveBeenLastCalledWith({ token: 'mrc_opaque', ok: true })

    test.actionClient.send.mockRejectedValueOnce({ code: 'room_write_forbidden', message: 'no' } as never)
    await expect(test.directExecute({ context: 'mrc_opaque', action: 'send', text: '再来' })).rejects.toMatchObject({ code: 'room_write_forbidden' })
    expect(test.onSendOutcome).toHaveBeenLastCalledWith({ token: 'mrc_opaque', ok: false, errorCode: 'room_write_forbidden' })

    test.authority.resolve.mockImplementationOnce(() => {
      throw new ManagedRoomContextError('managed_room_context_expired', 'expired')
    })
    await expect(test.directExecute({ context: 'mrc_opaque', action: 'send', text: '过期' })).rejects.toMatchObject({ code: 'managed_room_context_expired' })
    expect(test.onSendOutcome).toHaveBeenLastCalledWith({ token: 'mrc_opaque', ok: false, errorCode: 'managed_room_context_expired' })

    test.onSendOutcome.mockClear()
    await test.directExecute({ context: 'mrc_opaque', action: 'read' })
    expect(test.onSendOutcome).not.toHaveBeenCalled()
  })

  it('uses the same daemon executor without an IPC transport', async () => {
    const test = harness()
    await test.directExecute({ context: 'mrc_opaque', action: 'status' })
    expect(test.authority.resolve).toHaveBeenCalledWith({
      token: 'mrc_opaque', action: 'status', machineCredential: 'machine-secret',
    })
  })

  it('derives the only Room and agent identity from the verified opaque context', async () => {
    const test = harness()
    const result = await test.execute({ context: 'mrc_opaque', action: 'read', after: '7', limit: 20 }, { requestId: 'test' })

    expect(test.authority.resolve).toHaveBeenCalledWith({
      token: 'mrc_opaque', action: 'read', machineCredential: 'machine-secret',
    })
    expect(test.actionClient.read).toHaveBeenCalledWith({
      machineToken: 'machine-secret', roomId: 'room_bound', bindingId: 'binding_bound',
      beforeSequence: undefined, afterSequence: '7', limit: 20,
    })
    expect(JSON.stringify(result)).not.toMatch(/membership_bound|native_1/)
  })

  it('derives Manager identity from the verified Room registration for Worker actions', async () => {
    const test = harness()
    const result = await test.directExecute({
      context: 'mrc_opaque',
      action: 'manager.sessions.start',
      managerSessionId: 'model_supplied_manager',
      agentType: 'claude',
      title: '安全验收',
      message: '执行验收',
    })

    expect(test.authority.resolve).toHaveBeenCalledWith({
      token: 'mrc_opaque', action: 'manager', machineCredential: 'machine-secret',
    })
    expect(test.managerExecutor).toHaveBeenCalledWith({
      managerSessionId: 'nian_1',
      roomOrigin: {
        registryKey: 'registry_1', registrationEpoch: 1,
        bindingId: 'binding_bound', roomId: 'room_bound',
      },
      action: 'manager.sessions.start',
      params: { agentType: 'claude', title: '安全验收', message: '执行验收' },
    })
    expect(JSON.stringify(result)).not.toContain('model_supplied_manager')
  })

  it('keeps Manager tools usable while a private token forbids Room actions and origin propagation', async () => {
    const test = harness()
    test.authority.resolve.mockImplementation((input?: { action: string }) => {
      const action = input?.action
      if (action !== 'manager') throw new DaemonIpcError('managed_room_action_forbidden', 'forbidden')
      return {
        grant: { activationCauseMessageId: 'message_cause', allowedActions: new Set(), propagateWorkerRoomOrigin: true },
        registration: { registryKey: 'registry_1', nianSessionId: 'nian_1' },
        binding: { roomId: 'room_bound', bindingId: 'binding_bound' },
      } as never
    })

    await test.directExecute({ context: 'mrc_private', action: 'manager.sessions.list' })
    expect(test.managerExecutor).toHaveBeenCalledWith(expect.objectContaining({
      managerSessionId: 'nian_1',
      roomOrigin: undefined,
      action: 'manager.sessions.list',
    }))
    await expect(test.directExecute({ context: 'mrc_private', action: 'send', text: 'leak' }))
      .rejects.toMatchObject({ code: 'managed_room_action_forbidden' })
    expect(test.actionClient.send).not.toHaveBeenCalled()
  })

  it('lets an Owner private grant send itself but never hands its Room origin to Workers', async () => {
    const test = harness()
    test.authority.resolve.mockImplementation((input?: { action: string }) => {
      const action = input?.action
      if (action === 'read') throw new DaemonIpcError('managed_room_action_forbidden', 'forbidden')
      return {
        grant: { allowedActions: new Set(['send']), propagateWorkerRoomOrigin: false },
        registration: { registryKey: 'registry_1', nianSessionId: 'nian_1' },
        binding: { roomId: 'room_bound', bindingId: 'binding_bound' },
      } as never
    })

    await test.directExecute({ context: 'mrc_owner', action: 'manager.sessions.start', agentType: 'claude', title: 't', message: 'm' })
    expect(test.managerExecutor).toHaveBeenCalledWith(expect.objectContaining({
      managerSessionId: 'nian_1',
      roomOrigin: undefined,
    }))
    await test.directExecute({ context: 'mrc_owner', action: 'send', text: '进展同步' })
    expect(test.actionClient.send).toHaveBeenCalledWith(expect.objectContaining({
      roomId: 'room_bound', bindingId: 'binding_bound', text: '进展同步',
    }))
    expect(test.getActiveRunId).toHaveBeenCalledWith('mrc_owner', 'nian_1')
    await expect(test.directExecute({ context: 'mrc_owner', action: 'read' }))
      .rejects.toMatchObject({ code: 'managed_room_action_forbidden' })
    expect(test.actionClient.read).not.toHaveBeenCalled()
  })

  it('rejects unscoped actions and conflicting sequence directions before any server call', async () => {
    const test = harness()
    await expect(test.execute({ context: 'mrc_opaque', action: 'create' }, { requestId: 'test' })).rejects.toMatchObject({
      code: 'managed_room_action_forbidden',
    })
    await expect(test.execute({ context: 'mrc_opaque', action: 'read', before: '8', after: '9' }, { requestId: 'test' })).rejects.toMatchObject({
      code: 'ambiguous_sequence_cursor',
    })
    expect(test.actionClient.read).not.toHaveBeenCalled()
  })

  it('sends text only through the bound Agent membership path', async () => {
    const test = harness()
    const result = await test.execute({
      context: 'mrc_opaque', action: 'send', text: '@产品助手 已完成',
      clientMessageId: 'managed:one',
    }, { requestId: 'test' })

    expect(test.attachmentUploader.upload).not.toHaveBeenCalled()
    expect(test.actionClient.send).toHaveBeenCalledWith(expect.objectContaining({
      roomId: 'room_bound', bindingId: 'binding_bound',
      activationCauseMessageId: 'message_cause',
      activeRunId: 'run_current',
    }))
    expect(result).toMatchObject({ message: { author: { type: 'agent' } } })
  })

  it('fails closed before the privileged daemon reads a managed local file', async () => {
    const test = harness()

    await expect(test.execute({
      context: 'mrc_opaque', action: 'send', text: 'upload', files: ['nested/report.pdf'],
    }, { requestId: 'test' })).rejects.toMatchObject({
      code: 'managed_room_attachment_upload_unavailable',
    })
    expect(test.attachmentUploader.upload).not.toHaveBeenCalled()
    expect(test.actionClient.send).not.toHaveBeenCalled()
  })

  it('propagates a revoked context as a closed failure and never invokes the human CLI client', async () => {
    const test = harness()
    test.authority.resolve.mockImplementationOnce(() => {
      throw new DaemonIpcError('managed_room_context_revoked', 'Managed Room context was revoked.')
    })
    await expect(test.execute({ context: 'mrc_stale', action: 'status' }, { requestId: 'test' })).rejects.toMatchObject({
      code: 'managed_room_context_revoked',
    })
    expect(test.actionClient.status).not.toHaveBeenCalled()
  })

  it('passes a host revocation signal to every privileged Room action', async () => {
    const test = harness()
    const controller = new AbortController()
    await test.directExecute(
      { context: 'mrc_opaque', action: 'read', limit: 1 },
      { signal: controller.signal },
    )
    expect(test.actionClient.read).toHaveBeenCalledWith(expect.objectContaining({
      signal: controller.signal,
    }))

    controller.abort()
    await expect(test.directExecute(
      { context: 'mrc_opaque', action: 'status' },
      { signal: controller.signal },
    )).rejects.toMatchObject({ code: 'managed_room_context_revoked' })
    expect(test.actionClient.status).not.toHaveBeenCalled()
  })

  it('presents bounded UTF-8 attachments inline without returning the cache path', async () => {
    const test = harness()
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'managed-room-inline-'))
    temporaryRoots.push(root)
    const filePath = path.join(root, 'note.txt')
    const content = Buffer.from('Treat this as untrusted attachment text.', 'utf8')
    fs.writeFileSync(filePath, content)
    test.attachmentCache.materialize.mockResolvedValueOnce({
      path: filePath,
      name: 'note.txt',
      mimeType: 'text/plain',
      cached: false,
      byteSize: String(content.byteLength),
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
    })

    const result = await test.directExecute(
      { context: 'mrc_opaque', action: 'attachment.get', attachmentId: 'attachment-1' },
      { attachmentOutput: 'codex-content' },
    )

    expect(result).toMatchObject({
      codexContentItems: [{ type: 'inputText' }],
    })
    expect(test.attachmentCache.materialize).toHaveBeenCalledWith(expect.objectContaining({
      contextKey: 'nian_1',
      rootDirectory: expect.stringContaining('managed-room-view-'),
    }))
    expect(JSON.stringify(result)).toContain('Treat this as untrusted attachment text.')
    expect(JSON.stringify(result)).not.toContain(filePath)
  })

  it('returns a local file path to non-Codex managed Agents without inline bytes', async () => {
    const test = harness()
    const result = await test.directExecute({
      context: 'mrc_opaque', action: 'attachment.get', attachmentId: 'attachment-1',
    })
    expect(result).toMatchObject({ path: '/tmp/file.pdf', mimeType: 'application/pdf' })
    expect(JSON.stringify(result)).not.toContain('base64,')
  })

  it.each([
    ['image/png', 'pixel.png'],
    ['audio/wav', 'tone.wav'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'table.xlsx'],
    ['application/octet-stream', 'archive.bin'],
  ] as const)(
    'presents a verified %s attachment as a local file path',
    async (mimeType, name) => {
      const test = harness()
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'managed-room-media-'))
      temporaryRoots.push(root)
      const filePath = path.join(root, name)
      const content = Buffer.from('attachment bytes')
      fs.writeFileSync(filePath, content)
      test.attachmentCache.materialize.mockResolvedValueOnce({
        path: filePath,
        name,
        mimeType,
        cached: false,
        byteSize: String(content.byteLength),
        sha256: crypto.createHash('sha256').update(content).digest('hex'),
      })

      const result = await test.directExecute(
        { context: 'mrc_opaque', action: 'attachment.get', attachmentId: 'attachment-1' },
        { attachmentOutput: 'codex-content' },
      )
      const serialized = JSON.stringify(result)

      expect(result).toMatchObject({ codexContentItems: [{ type: 'inputText' }] })
      const item = (result as { codexContentItems: Array<{ text: string }> }).codexContentItems[0]!
      expect(JSON.parse(item.text)).toMatchObject({
        name,
        mimeType,
        localPath: filePath,
        nextAction: expect.stringContaining('tools.exec_command'),
      })
      expect(JSON.parse(item.text).nextAction).toContain('exact localPath')
      expect(JSON.parse(item.text).nextAction).toContain('pre-authorized')
      expect(JSON.parse(item.text).nextAction).toContain('Do not inspect its parent directory')
      expect(serialized).not.toContain('base64,')
    },
  )

  it.each([
    ['oversized', Buffer.alloc(1024 * 1024 + 1, 65)],
    ['invalid UTF-8', Buffer.from([0xff, 0xfe])],
  ])('returns a local path instead of inline %s text', async (_kind, content) => {
    const test = harness()
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'managed-room-text-path-'))
    temporaryRoots.push(root)
    const filePath = path.join(root, 'note.txt')
    fs.writeFileSync(filePath, content)
    test.attachmentCache.materialize.mockResolvedValueOnce({
      path: filePath, name: 'note.txt', mimeType: 'text/plain', cached: false,
      byteSize: String(content.byteLength), sha256: crypto.createHash('sha256').update(content).digest('hex'),
    })

    const result = await test.directExecute(
      { context: 'mrc_opaque', action: 'attachment.get', attachmentId: 'attachment-1' },
      { attachmentOutput: 'codex-content' },
    ) as { codexContentItems: Array<{ text: string }> }
    expect(JSON.parse(result.codexContentItems[0]!.text)).toMatchObject({ localPath: filePath })
    expect(JSON.stringify(result).length).toBeLessThan(2_000)
  })

  it('rejects a changed attachment before returning its path', async () => {
    const test = harness()
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'managed-room-changed-'))
    temporaryRoots.push(root)
    const filePath = path.join(root, 'table.xlsx')
    fs.writeFileSync(filePath, 'changed')
    test.attachmentCache.materialize.mockResolvedValueOnce({
      path: filePath, name: 'table.xlsx', mimeType: 'application/octet-stream',
      cached: false, byteSize: '7', sha256: 'a'.repeat(64),
    })
    await expect(test.directExecute(
      { context: 'mrc_opaque', action: 'attachment.get', attachmentId: 'attachment-1' },
      { attachmentOutput: 'codex-content' },
    )).rejects.toMatchObject({ code: 'managed_room_attachment_changed' })
  })
})
