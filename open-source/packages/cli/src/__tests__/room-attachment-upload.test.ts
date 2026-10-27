// @covers src/room/attachment-upload.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RoomAttachmentUploader } from '../room/attachment-upload.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('RoomAttachmentUploader', () => {
  it('uploads a workspace file to the signed private URL and completes it', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-room-upload-'))
    roots.push(root)
    fs.writeFileSync(path.join(root, 'note.txt'), 'hello')
    const initializeAttachment = vi.fn(async (input: { sha256: string }) => ({
      attachment: { id: 'attachment_1' },
      upload: {
        url: 'https://private-oss.example/upload?signature=short',
        headers: { 'content-type': 'text/plain', 'x-oss-meta-sha256': input.sha256 },
      },
    }))
    const completeAttachment = vi.fn(async () => ({
      attachment: { attachmentId: 'attachment_1' },
      idempotent: false,
    }))
    const uploadFetch = vi.fn(async () => new Response(null, { status: 200 }))
    const uploader = new RoomAttachmentUploader({
      actionClient: { initializeAttachment, completeAttachment } as never,
      fetch: uploadFetch as never,
    })

    await expect(
      uploader.upload({
        machineToken: 'machine-secret',
        roomId: 'room_1',
        bindingId: 'binding_1',
        workspacePath: root,
        clientMessageId: 'client_1',
        files: ['note.txt'],
      }),
    ).resolves.toEqual(['attachment_1'])
    expect(initializeAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'note.txt',
        mimeType: 'text/plain',
        byteSize: 5,
        sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      }),
    )
    expect(uploadFetch).toHaveBeenCalledWith(
      expect.stringContaining('https://private-oss.example/'),
      expect.objectContaining({ method: 'PUT', redirect: 'error' }),
    )
    expect(JSON.stringify(uploadFetch.mock.calls)).not.toContain('machine-secret')
    expect(completeAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ attachmentId: 'attachment_1' }),
    )
  })

  it.each([
    ['IMG_9718.HEIC', 'image/heic'],
    ['photo.heif', 'image/heif'],
  ])('uploads managed %s untouched as an ordinary file', async (name, mimeType) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-room-upload-heic-'))
    roots.push(root)
    const bytes = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])
    fs.writeFileSync(path.join(root, name), bytes)
    const initializeAttachment = vi.fn(async (input: { sha256: string }) => ({
      attachment: { id: 'attachment_1' },
      upload: { url: 'https://private-oss.example/upload?signature=short', headers: { 'x-oss-meta-sha256': input.sha256 } },
    }))
    const uploadFetch = vi.fn(async () => new Response(null, { status: 200 }))
    const uploader = new RoomAttachmentUploader({
      actionClient: { initializeAttachment, completeAttachment: vi.fn(async () => ({ attachment: { attachmentId: 'attachment_1' }, idempotent: false })) } as never,
      fetch: uploadFetch as never,
    })

    await uploader.upload({
      machineToken: 'machine-secret', roomId: 'room_1', bindingId: 'binding_1',
      workspacePath: root, clientMessageId: 'client_1', files: [name],
    })

    expect(initializeAttachment).toHaveBeenCalledWith(expect.objectContaining({
      name, mimeType, mediaKind: 'file', byteSize: bytes.byteLength,
    }))
    const put = uploadFetch.mock.calls[0] as unknown as [string, { body: Uint8Array }]
    expect(Buffer.from(put[1].body)).toEqual(bytes)
  })

  it('rejects paths outside the exact workspace and symbolic links', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-room-upload-boundary-'))
    roots.push(root)
    const workspace = path.join(root, 'workspace')
    fs.mkdirSync(workspace)
    fs.writeFileSync(path.join(root, 'secret.txt'), 'secret')
    const uploader = new RoomAttachmentUploader({
      actionClient: {} as never,
      fetch: vi.fn() as never,
    })
    await expect(
      uploader.upload({
        machineToken: 'm',
        roomId: 'r',
        bindingId: 'b',
        workspacePath: workspace,
        clientMessageId: 'c',
        files: ['../secret.txt'],
      }),
    ).rejects.toMatchObject({ code: 'room_upload_outside_workspace' })
    if (process.platform !== 'win32') {
      fs.symlinkSync(path.join(root, 'secret.txt'), path.join(workspace, 'link.txt'))
      await expect(
        uploader.upload({
          machineToken: 'm',
          roomId: 'r',
          bindingId: 'b',
          workspacePath: workspace,
          clientMessageId: 'c',
          files: ['link.txt'],
        }),
      ).rejects.toMatchObject({ code: 'room_upload_invalid_file' })
    }
  })

  it('never lets the daemon upload sensitive files or hard-link aliases for a managed Agent', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-room-upload-sensitive-'))
    roots.push(root)
    fs.mkdirSync(path.join(root, 'nested'))
    fs.writeFileSync(path.join(root, 'nested', '.env.production'), 'secret')
    fs.writeFileSync(path.join(root, 'source.txt'), 'secret')
    fs.linkSync(path.join(root, 'source.txt'), path.join(root, 'alias.txt'))
    const uploader = new RoomAttachmentUploader({ actionClient: {} as never })

    await expect(
      uploader.upload({
        machineToken: 'm',
        roomId: 'r',
        bindingId: 'b',
        workspacePath: root,
        clientMessageId: 'c',
        files: ['nested/.env.production'],
      }),
    ).rejects.toMatchObject({ code: 'room_upload_sensitive_file' })
    await expect(
      uploader.upload({
        machineToken: 'm',
        roomId: 'r',
        bindingId: 'b',
        workspacePath: root,
        clientMessageId: 'c',
        files: ['alias.txt'],
      }),
    ).rejects.toMatchObject({ code: 'room_upload_invalid_file' })
  })

  it('rejects a file replaced between path validation and descriptor open', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-room-upload-race-'))
    roots.push(root)
    const target = path.join(root, 'note.txt')
    const replacement = path.join(root, 'replacement.txt')
    fs.writeFileSync(target, 'safe')
    fs.writeFileSync(replacement, 'secret')
    const originalOpen = fs.openSync.bind(fs)
    const open = vi.spyOn(fs, 'openSync').mockImplementationOnce((file, flags, mode) => {
      fs.renameSync(target, path.join(root, 'original.txt'))
      fs.renameSync(replacement, target)
      return originalOpen(file, flags, mode)
    })
    const uploader = new RoomAttachmentUploader({ actionClient: {} as never })

    try {
      await expect(
        uploader.upload({
          machineToken: 'm',
          roomId: 'r',
          bindingId: 'b',
          workspacePath: root,
          clientMessageId: 'c',
          files: ['note.txt'],
        }),
      ).rejects.toMatchObject({ code: 'room_upload_file_changed' })
    } finally {
      open.mockRestore()
    }
  })

  it('classifies image, audio, and ordinary files before private upload', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-room-upload-kinds-'))
    roots.push(root)
    fs.writeFileSync(path.join(root, 'diagram.png'), 'image')
    fs.writeFileSync(path.join(root, 'note.m4a'), 'audio')
    fs.writeFileSync(path.join(root, 'report.pdf'), 'file')
    let nextId = 0
    const initializeAttachment = vi.fn(
      async (_input: {
        name: string
        mediaKind: 'image' | 'audio' | 'file'
        mimeType: string
      }) => ({
        attachment: { id: `attachment_${++nextId}` },
        upload: { url: 'https://private-oss.example/upload', headers: {} },
      }),
    )
    const completeAttachment = vi.fn(async (input: { attachmentId: string }) => ({
      attachment: { attachmentId: input.attachmentId },
      idempotent: false,
    }))
    const uploader = new RoomAttachmentUploader({
      actionClient: { initializeAttachment, completeAttachment } as never,
      fetch: vi.fn(async () => new Response(null, { status: 200 })) as never,
    })

    await uploader.upload({
      machineToken: 'm',
      roomId: 'r',
      bindingId: 'b',
      workspacePath: root,
      clientMessageId: 'client-kinds',
      files: ['diagram.png', 'note.m4a', 'report.pdf'],
    })

    expect(
      initializeAttachment.mock.calls.map(([input]) => ({
        name: input.name,
        mediaKind: input.mediaKind,
        mimeType: input.mimeType,
      })),
    ).toEqual([
      { name: 'diagram.png', mediaKind: 'image', mimeType: 'image/png' },
      { name: 'note.m4a', mediaKind: 'audio', mimeType: 'audio/mp4' },
      { name: 'report.pdf', mediaKind: 'file', mimeType: 'application/pdf' },
    ])
  })

  it.each([
    {
      label: 'transport failure',
      upload: () => Promise.reject(new Error('signed URL must stay private')),
      code: 'room_upload_unavailable',
    },
    {
      label: 'non-success response',
      upload: () => Promise.resolve(new Response('private OSS response', { status: 403 })),
      code: 'room_upload_http_403',
    },
  ])(
    'reports a safe phase-specific error for $label and does not complete',
    async ({ upload, code }) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-room-upload-failure-'))
      roots.push(root)
      fs.writeFileSync(path.join(root, 'note.txt'), 'hello')
      const initializeAttachment = vi.fn(async (input: { sha256: string }) => ({
        attachment: { id: 'attachment_1' },
        upload: {
          url: 'https://private-oss.example/upload?private-signature',
          headers: { 'content-type': 'text/plain', 'x-oss-meta-sha256': input.sha256 },
        },
      }))
      const completeAttachment = vi.fn()
      const uploader = new RoomAttachmentUploader({
        actionClient: { initializeAttachment, completeAttachment } as never,
        fetch: vi.fn(upload) as never,
      })

      const failure = uploader.upload({
        machineToken: 'machine-secret',
        roomId: 'room_1',
        bindingId: 'binding_1',
        workspacePath: root,
        clientMessageId: 'client_1',
        files: ['note.txt'],
      })
      await expect(failure).rejects.toMatchObject({ code })
      await expect(failure).rejects.not.toThrow(/signature|OSS response/)
      expect(completeAttachment).not.toHaveBeenCalled()
    },
  )
})
