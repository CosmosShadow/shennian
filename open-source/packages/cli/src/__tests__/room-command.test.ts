// @covers src/commands/room.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerRoomCommand } from '../commands/room.js'
import { PublicRoomClient, PublicRoomClientError } from '../room/public-room-client.js'
import { PublicAttachmentCache } from '../room/public-attachment-cache.js'
import { externalRoomNextAction, managedRoomNextAction } from '../room/room-error-guidance.js'

const ROOM_URL = 'https://app.shennian.net/spaces/room_1'

function harness() {
  let output = ''
  let failures = 0
  const client = {
    create: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    deleteRecord: vi.fn(),
    getInvite: vi.fn(),
    resetInvite: vi.fn(),
    listMembers: vi.fn(),
    removeMember: vi.fn(),
    join: vi.fn(),
    open: vi.fn(),
    status: vi.fn(),
    read: vi.fn(),
    send: vi.fn(),
    initializeAttachment: vi.fn(),
    upload: vi.fn(),
    completeAttachment: vi.fn(),
    leave: vi.fn(),
  }
  const cache: {
    lookup: ReturnType<
      typeof vi.fn<
        (roomId: string, attachment: unknown) => { downloaded: boolean; localPath: string | null }
      >
    >
    materialize: ReturnType<typeof vi.fn>
  } = {
    lookup: vi.fn(() => ({ downloaded: false, localPath: null })),
    materialize: vi.fn(),
  }
  const program = new Command().exitOverride()
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} })
  registerRoomCommand(program, {
    client: client as unknown as PublicRoomClient,
    cache: cache as unknown as PublicAttachmentCache,
    createInviteQr: async (inviteUrl) => ({
      imagePath: '/tmp/shennian-room-invite.png',
      mimeType: 'image/png',
      payload: inviteUrl,
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    }),
    io: {
      write: (text) => {
        output += text
      },
      fail: () => {
        failures += 1
      },
    },
  })
  return { program, client, cache, result: () => ({ output, failures }) }
}

describe('public Room CLI', () => {
  afterEach(() => {
    delete process.env.SHENNIAN_MANAGED_ROOM_CONTEXT
    delete process.env.SHENNIAN_MANAGED_ROOM_IPC_ROOT
    vi.restoreAllMocks()
  })

  it('waits from an exact sent sequence and returns a new Room reply', async () => {
    const test = harness()
    test.client.read.mockResolvedValue({ messages: [{ sequence: '22', text: '收到' }] })
    await test.program.parseAsync(['room', 'wait', ROOM_URL, '--after', '21', '--timeout', '5'], { from: 'user' })
    expect(test.client.read).toHaveBeenCalledWith('room_1', { after: '21', limit: 50 })
    expect(test.client.send).not.toHaveBeenCalled()
    expect(JSON.parse(test.result().output)).toMatchObject({
      ok: true, command: 'room.wait', result: { timedOut: false, messages: [{ sequence: '22' }] },
    })
  })

  it('fails closed when a managed Room context has no isolated IPC root', async () => {
    process.env.SHENNIAN_MANAGED_ROOM_CONTEXT = `mrc_${'a'.repeat(43)}`
    const test = harness()

    await test.program.parseAsync(['room', 'status'], { from: 'user' })

    expect(JSON.parse(test.result().output)).toMatchObject({
      ok: false,
      error: 'managed_room_context_unavailable',
      nextAction: { type: 'ask_user' },
    })
    expect(test.client.status).not.toHaveBeenCalled()
  })

  it('points non-managed callers to the official Skill and Client install addresses', async () => {
    for (const argv of [['room', 'status'], ['room', 'pause', '--reason', 'x']]) {
      const test = harness()
      await test.program.parseAsync(argv, { from: 'user' })
      expect(JSON.parse(test.result().output)).toMatchObject({
        ok: false,
        nextAction: {
          type: 'use_shennian_skill',
          skillUrl: 'https://shennian.net/skill.md',
          installUrl: 'https://shennian.net/install.md',
        },
      })
    }
  })

  it('gives every managed context failure a next step that never falls back to the human identity', () => {
    for (const code of [
      'managed_room_context_expired',
      'managed_room_context_revoked',
      'managed_room_context_invalid',
      'managed_room_context_unavailable',
      'managed_room_action_forbidden',
    ]) {
      const action = managedRoomNextAction(code)
      expect(action, code).not.toBeNull()
      expect(action!.type).toMatch(/^(wait_for_next_activation|stop_turn|ask_user)$/)
    }
    expect(managedRoomNextAction('managed_room_context_expired')!.message).toMatch(/do not send as the human/i)
    expect(managedRoomNextAction('some_other_error')).toBeNull()
  })

  it('advertises explicit Room CRUD but not search or managed Agent creation', () => {
    const test = harness()
    const help = test.program.commands[0]!.helpInformation()
    expect(help).toContain('list')
    expect(help).not.toMatch(/\bsearch\b|\bagent\b|\bschedule\b|\bpause\b/)
    expect(help).toContain('create')
    expect(help).toContain('get')
    expect(help).toContain('update')
    expect(help).toContain('delete')
    expect(help).toContain('invite')
    expect(help).toContain('member')
    expect(help).toContain('attachment')
  })

  it('explains the public identity and resolves an exact Room before asking for a URL', () => {
    const action = externalRoomNextAction()
    expect(action.message).toMatch(/ordinary AI cannot send as a managed Agent/i)
    expect(action.message).toMatch(/list the user's Rooms/i)
    expect(action.message).toMatch(/ask the user only when multiple candidates remain/i)
  })

  it('lists duplicate names as separate explicit Room URL candidates', async () => {
    const test = harness()
    test.client.list.mockResolvedValue({
      rooms: [
        { name: '产品讨论', canonicalUrl: ROOM_URL, version: '2026-09-22T00:00:00.000Z' },
        { name: '产品讨论', canonicalUrl: 'https://app.shennian.net/spaces/room_2', version: '2026-09-22T00:01:00.000Z' },
      ],
    })
    await test.program.parseAsync(['room', 'list'], { from: 'user' })
    const result = JSON.parse(test.result().output)
    expect(result).toMatchObject({ ok: true, command: 'room.list' })
    expect(result.result.rooms).toHaveLength(2)
    expect(result.result.rooms[0].canonicalUrl).not.toBe(result.result.rooms[1].canonicalUrl)
  })

  it('gets and updates only an explicit Room URL with its exact version', async () => {
    const version = '2026-09-22T00:00:00.000Z'
    const getTest = harness()
    getTest.client.get.mockResolvedValue({ room: { canonicalUrl: ROOM_URL, version } })
    await getTest.program.parseAsync(['room', 'get', ROOM_URL], { from: 'user' })
    expect(getTest.client.get).toHaveBeenCalledWith('room_1')

    const updateTest = harness()
    updateTest.client.update.mockResolvedValue({ idempotent: false })
    await updateTest.program.parseAsync(
      ['room', 'update', ROOM_URL, '--version', version, '--name', '新名称', '--join-policy', 'approval'],
      { from: 'user' },
    )
    expect(updateTest.client.update).toHaveBeenCalledWith('room_1', {
      version,
      name: '新名称',
      joinPolicy: 'approval',
    })
  })

  it('keeps delete semantics personal and version-checked', async () => {
    const version = '2026-09-22T00:00:00.000Z'
    const test = harness()
    test.client.deleteRecord.mockResolvedValue({ deleted: true, activeMembershipRetained: true })
    await test.program.parseAsync(['room', 'delete', ROOM_URL, '--version', version], { from: 'user' })
    expect(test.client.deleteRecord).toHaveBeenCalledWith('room_1', version)
    expect(JSON.parse(test.result().output)).toMatchObject({
      ok: true,
      command: 'room.delete',
      result: { deleted: true, activeMembershipRetained: true },
    })
  })

  it('gets and resets invitations with complete AI-ready sharing and an explicit version', async () => {
    const currentInviteUrl = ROOM_URL + '?invite=' + 'i'.repeat(43)
    const getTest = harness()
    getTest.client.getInvite.mockResolvedValue({ invite: { url: currentInviteUrl, version: 3 } })
    await getTest.program.parseAsync(['room', 'invite', 'get', ROOM_URL], { from: 'user' })
    expect(getTest.client.getInvite).toHaveBeenCalledWith('room_1')
    expect(JSON.parse(getTest.result().output).result.sharing).toMatchObject({
      inviteUrl: currentInviteUrl,
      installUrl: 'https://shennian.net/install.md',
      text: [
        '点击加入神念群聊，或把本消息发给你的 AI：',
        '邀请：' + currentInviteUrl,
        '安装：https://shennian.net/install.md',
      ].join('\n'),
      inviteQr: { payload: currentInviteUrl },
    })

    const resetInviteUrl = ROOM_URL + '?invite=' + 'r'.repeat(43)
    const resetTest = harness()
    resetTest.client.resetInvite.mockResolvedValue({ invite: { url: resetInviteUrl, version: 4 } })
    await resetTest.program.parseAsync(
      ['room', 'invite', 'reset', ROOM_URL, '--version', '3'],
      { from: 'user' },
    )
    expect(resetTest.client.resetInvite).toHaveBeenCalledWith('room_1', 3)
    expect(JSON.parse(resetTest.result().output).result.sharing).toMatchObject({
      inviteUrl: resetInviteUrl,
      installUrl: 'https://shennian.net/install.md',
      inviteQr: { payload: resetInviteUrl },
    })
  })

  it('removes only a public member reference returned by member list', async () => {
    const memberRef = `member_${'m'.repeat(43)}`
    const listTest = harness()
    listTest.client.listMembers.mockResolvedValue({ members: [{ memberRef, version: 2 }] })
    await listTest.program.parseAsync(['room', 'member', 'list', ROOM_URL], { from: 'user' })
    expect(listTest.client.listMembers).toHaveBeenCalledWith('room_1')

    const removeTest = harness()
    removeTest.client.removeMember.mockResolvedValue({ removed: true, removedCount: 1 })
    await removeTest.program.parseAsync(
      ['room', 'member', 'remove', ROOM_URL, '--member-ref', memberRef, '--version', '2'],
      { from: 'user' },
    )
    expect(removeTest.client.removeMember).toHaveBeenCalledWith('room_1', memberRef, 2)
  })

  it('joins only through the unified official invitation URL', async () => {
    testInviteResult()
    const test = harness()
    test.client.join.mockResolvedValue({
      outcome: 'joined',
      room: {
        canonicalUrl: ROOM_URL,
        launchUrl: `${ROOM_URL}?access=${'h'.repeat(43)}`,
        name: '产品讨论',
      },
    })
    const invite = `${ROOM_URL}?invite=${'i'.repeat(43)}`

    await test.program.parseAsync(['room', 'join', invite], { from: 'user' })

    expect(test.client.join).toHaveBeenCalledWith('room_1', 'i'.repeat(43), undefined)
    expect(JSON.parse(test.result().output)).toMatchObject({
      ok: true,
      command: 'room.join',
      result: {
        outcome: 'joined',
        room: {
          canonicalUrl: ROOM_URL,
          launchUrl: `${ROOM_URL}?access=${'h'.repeat(43)}`,
        },
      },
    })
  })

  it('passes an approval message when joining an approval-only Room', async () => {
    const test = harness()
    test.client.join.mockResolvedValue({ outcome: 'approval_required', room: { name: '产品讨论' } })
    const invite = `${ROOM_URL}?invite=${'i'.repeat(43)}`

    await test.program.parseAsync(
      ['room', 'join', invite, '--message', '  我是设计师，申请加入  '],
      { from: 'user' },
    )

    expect(test.client.join).toHaveBeenCalledWith('room_1', 'i'.repeat(43), '我是设计师，申请加入')
  })

  it('returns a fresh launch URL when opening a stable Room URL for the current host', async () => {
    const test = harness()
    const launchUrl = `${ROOM_URL}?access=${'h'.repeat(43)}`
    test.client.open.mockResolvedValue({
      room: { name: '产品讨论', canonicalUrl: ROOM_URL, launchUrl },
      nextAction: { type: 'open_url', url: launchUrl },
    })

    await test.program.parseAsync(['room', 'open', ROOM_URL], { from: 'user' })

    expect(test.client.open).toHaveBeenCalledWith('room_1')
    expect(JSON.parse(test.result().output)).toMatchObject({
      ok: true,
      command: 'room.open',
      result: {
        room: { canonicalUrl: ROOM_URL, launchUrl },
        nextAction: { type: 'open_url', url: launchUrl },
      },
    })
  })

  it('returns a host-only launch URL alongside directly shareable Room fields after creation', async () => {
    const test = harness()
    const inviteUrl = `${ROOM_URL}?invite=${'i'.repeat(43)}`
    test.client.create.mockResolvedValue({
      outcome: 'created',
      room: {
        name: '产品讨论',
        canonicalUrl: ROOM_URL,
        launchUrl: `${ROOM_URL}?access=${'h'.repeat(43)}`,
        inviteUrl,
      },
    })

    await test.program.parseAsync(['room', 'create', '--name', '产品讨论'], { from: 'user' })

    expect(JSON.parse(test.result().output)).toMatchObject({
      ok: true,
      command: 'room.create',
      result: {
        outcome: 'created',
        room: {
          canonicalUrl: ROOM_URL,
          launchUrl: `${ROOM_URL}?access=${'h'.repeat(43)}`,
          inviteUrl,
        },
        sharing: {
          inviteUrl,
          installUrl: 'https://shennian.net/install.md',
          text: [
            '邀请你加入神念群聊「产品讨论」。',
            '直接点击，或把本消息发给你的 AI，让它安装神念、完成配对并加入群聊。',
            '邀请：' + inviteUrl,
            '安装：https://shennian.net/install.md',
          ].join('\n'),
          inviteQr: {
            imagePath: '/tmp/shennian-room-invite.png',
            mimeType: 'image/png',
            payload: inviteUrl,
            dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
          },
        },
      },
    })
    expect(JSON.parse(test.result().output).result.sharing).not.toHaveProperty('installGuideUrl')
  })

  it('keeps one-time launch fields out of commands that do not immediately open a Room', async () => {
    const test = harness()
    test.client.list.mockResolvedValue({
      rooms: [{ canonicalUrl: ROOM_URL, launchUrl: `${ROOM_URL}?access=${'h'.repeat(43)}` }],
      access: 'private-capability',
    })

    await test.program.parseAsync(['room', 'list'], { from: 'user' })

    expect(test.result().output).not.toContain('launchUrl')
    expect(test.result().output).not.toContain('private-capability')
    expect(JSON.parse(test.result().output).result.rooms[0]).toEqual({ canonicalUrl: ROOM_URL })
  })

  it('keeps the created Room result when local QR rendering is unavailable', async () => {
    const test = harness()
    const inviteUrl = `${ROOM_URL}?invite=${'i'.repeat(43)}`
    test.client.create.mockResolvedValue({
      outcome: 'created',
      room: { name: '产品讨论', canonicalUrl: ROOM_URL, launchUrl: ROOM_URL, inviteUrl },
    })
    const roomCommand = test.program.commands[0]!
    const originalAction = roomCommand.commands.find((command) => command.name() === 'create')
    expect(originalAction).toBeDefined()

    const fallbackProgram = new Command().exitOverride()
    let output = ''
    registerRoomCommand(fallbackProgram, {
      client: test.client as unknown as PublicRoomClient,
      cache: test.cache as unknown as PublicAttachmentCache,
      createInviteQr: async () => {
        throw new Error('disk unavailable')
      },
      io: {
        write: (text) => {
          output += text
        },
        fail: () => {},
      },
    })
    await fallbackProgram.parseAsync(['room', 'create', '--name', '产品讨论'], { from: 'user' })

    expect(JSON.parse(output)).toMatchObject({
      ok: true,
      result: {
        sharing: { inviteQr: { imagePath: null, mimeType: 'image/png', payload: inviteUrl, dataUrl: null } },
      },
    })
  })

  it('reads by sequence without exposing pagination cursors and adds local attachment state', async () => {
    const test = harness()
    test.client.read.mockResolvedValue({
      messages: [
        {
          sequence: '42',
          text: '方案',
          attachments: [
            {
              attachmentId: 'ratt_file',
              name: 'a.pdf',
              mimeType: 'application/pdf',
              byteSize: '3',
              sha256: 'a'.repeat(64),
            },
          ],
        },
      ],
    })
    test.cache.lookup.mockReturnValue({ downloaded: true, localPath: '/tmp/cache/a.pdf' })

    await test.program.parseAsync(['room', 'read', ROOM_URL, '--before', '50', '--limit', '20'], {
      from: 'user',
    })

    expect(test.client.read).toHaveBeenCalledWith('room_1', {
      before: '50',
      after: undefined,
      limit: 20,
    })
    const json = JSON.parse(test.result().output)
    expect(json.result.messages[0].attachments[0]).toMatchObject({
      downloaded: true,
      localPath: '/tmp/cache/a.pdf',
    })
    expect(json.result).not.toHaveProperty('hasMore')
    expect(json.result).not.toHaveProperty('nextCursor')
  })

  it('sends a HEIC file untouched as an ordinary file with its original name, MIME and bytes', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-room-command-'))
    const heic = path.join(root, 'IMG_9718.HEIC')
    const bytes = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])
    fs.writeFileSync(heic, bytes)
    try {
      const test = harness()
      test.client.initializeAttachment.mockResolvedValue({
        attachment: { id: 'ratt_1' },
        upload: { method: 'PUT', url: 'https://oss.example/upload-1', headers: {} },
      })
      test.client.completeAttachment.mockResolvedValue({})
      test.client.send.mockResolvedValue({ message: { sequence: '9' }, idempotent: false })

      await test.program.parseAsync(['room', 'send', ROOM_URL, '--file', heic], { from: 'user' })

      expect(test.client.initializeAttachment).toHaveBeenCalledWith('room_1', expect.objectContaining({
        name: 'IMG_9718.HEIC', mimeType: 'image/heic', mediaKind: 'file', byteSize: bytes.byteLength,
      }))
      expect(test.client.upload).toHaveBeenCalledOnce()
      expect(Buffer.from(test.client.upload.mock.calls[0]![2] as Uint8Array)).toEqual(bytes)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('uploads repeated files and commits them in one message', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-room-command-'))
    const first = path.join(root, 'first.txt')
    const second = path.join(root, 'second.txt')
    fs.writeFileSync(first, 'one')
    fs.writeFileSync(second, 'two')
    try {
      const test = harness()
      let uploadIndex = 0
      test.client.initializeAttachment.mockImplementation(async () => {
        uploadIndex += 1
        return {
          attachment: { id: `ratt_${uploadIndex}` },
          upload: { method: 'PUT', url: `https://oss.example/upload-${uploadIndex}`, headers: {} },
        }
      })
      test.client.completeAttachment.mockResolvedValue({})
      test.client.send.mockResolvedValue({ message: { sequence: '9' }, idempotent: false })

      await test.program.parseAsync(
        ['room', 'send', ROOM_URL, '--text', '附件', '--file', first, '--file', second],
        { from: 'user' },
      )

      expect(test.client.upload).toHaveBeenCalledTimes(2)
      expect(test.client.send).toHaveBeenCalledWith(
        'room_1',
        expect.objectContaining({
          text: '附件',
          attachmentIds: ['ratt_1', 'ratt_2'],
        }),
      )
      expect(JSON.parse(test.result().output)).toMatchObject({ ok: true, command: 'room.send' })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('turns escaped paragraph breaks from CLI prose into real line breaks', async () => {
    const test = harness()
    test.client.send.mockResolvedValue({ message: { sequence: '9' }, idempotent: false })

    await test.program.parseAsync(
      ['room', 'send', ROOM_URL, '--text', '更新说明。\\n\\n第一项\\n第二项'],
      { from: 'user' },
    )

    expect(test.client.send).toHaveBeenCalledWith('room_1', expect.objectContaining({
      text: '更新说明。\n\n第一项\n第二项',
    }))
  })

  it('keeps isolated and double-escaped newline examples unchanged', async () => {
    for (const text of ['代码里的 \\n 字符', '代码里的 \\\\n\\\\n 字符']) {
      const test = harness()
      test.client.send.mockResolvedValue({ message: { sequence: '9' }, idempotent: false })

      await test.program.parseAsync(['room', 'send', ROOM_URL, '--text', text], { from: 'user' })

      expect(test.client.send).toHaveBeenCalledWith('room_1', expect.objectContaining({ text }))
    }
  })

  it('rejects eleven files before uploading anything', async () => {
    const test = harness()
    await test.program.parseAsync(
      [
        'room',
        'send',
        ROOM_URL,
        ...Array.from({ length: 11 }, (_, index) => ['--file', `/tmp/file-${index}`]).flat(),
      ],
      { from: 'user' },
    )
    expect(test.client.initializeAttachment).not.toHaveBeenCalled()
    expect(JSON.parse(test.result().output)).toMatchObject({
      ok: false,
      error: 'room_attachments_too_many',
    })
  })

  it('does not commit a message when any attachment upload fails', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-room-command-failure-'))
    const first = path.join(root, 'first.txt')
    const second = path.join(root, 'second.txt')
    fs.writeFileSync(first, 'one')
    fs.writeFileSync(second, 'two')
    try {
      const test = harness()
      test.client.initializeAttachment
        .mockResolvedValueOnce({
          attachment: { id: 'ratt_one' },
          upload: { method: 'PUT', url: 'https://oss.example/upload-one', headers: {} },
        })
        .mockResolvedValueOnce({
          attachment: { id: 'ratt_two' },
          upload: { method: 'PUT', url: 'https://oss.example/upload-two', headers: {} },
        })
      test.client.upload
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(
          new PublicRoomClientError('attachment_upload_failed', 'Upload failed.'),
        )

      await test.program.parseAsync(
        ['room', 'send', ROOM_URL, '--text', '附件', '--file', first, '--file', second],
        { from: 'user' },
      )

      expect(test.client.send).not.toHaveBeenCalled()
      expect(JSON.parse(test.result().output)).toMatchObject({
        ok: false,
        error: 'attachment_upload_failed',
      })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects non-official Room references and never keeps a global current Room', async () => {
    const test = harness()
    await test.program.parseAsync(['room', 'status', 'https://evil.example/spaces/room_1'], {
      from: 'user',
    })
    expect(test.client.status).not.toHaveBeenCalled()
    expect(JSON.parse(test.result().output)).toMatchObject({ ok: false, error: 'invalid_room_ref' })

    const missing = harness()
    await missing.program.parseAsync(['room', 'read'], { from: 'user' })
    expect(missing.client.read).not.toHaveBeenCalled()
    expect(JSON.parse(missing.result().output)).toMatchObject({
      ok: false,
      error: 'room_ref_required',
    })
  })

  it('returns stable structured errors', async () => {
    const test = harness()
    test.client.status.mockRejectedValue(
      new PublicRoomClientError('room_read_forbidden', 'No access.'),
    )

    await test.program.parseAsync(['room', 'status', ROOM_URL], { from: 'user' })

    expect(JSON.parse(test.result().output)).toEqual({
      ok: false,
      error: 'room_read_forbidden',
      message: 'No access.',
      nextAction: null,
    })
    expect(test.result().failures).toBe(1)
  })
})

function testInviteResult() {
  // Keeps the test intent explicit: opening the browser is a Skill/host action,
  // while this command only preserves the server-provided navigation URL.
}
