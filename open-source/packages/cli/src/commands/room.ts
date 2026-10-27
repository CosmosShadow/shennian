// @arch open-source/docs/cli-runtime.md
// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/room-command.test.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Command } from 'commander'
import { PublicAttachmentCache } from '../room/public-attachment-cache.js'
import { PublicRoomClient, PublicRoomClientError } from '../room/public-room-client.js'
import { callDaemonIpc } from '../daemon-ipc/client.js'
import { DaemonIpcError } from '../daemon-ipc/protocol.js'
import { MANAGED_ROOM_IPC_ROOT_ENV, resolveManagedRoomIpcPaths } from '../daemon-ipc/paths.js'
import { MANAGED_ROOM_CONTEXT_ENV } from '../room/managed-context.js'
import { createRoomInviteQr, type RoomInviteQr } from '../room/invite-qr.js'
import {
  externalRoomNextAction,
  managedRoomNextAction,
  SHENNIAN_INSTALL_URL,
} from '../room/room-error-guidance.js'
import { attachmentMediaKind } from '../room/attachment-upload.js'
import { parseWaitTimeout, waitForMessages } from '../room/wait-for-messages.js'

type RoomCommandIo = { write: (text: string) => void; fail: () => void }
type RoomCommandOptions = {
  client?: PublicRoomClient
  cache?: PublicAttachmentCache
  io?: RoomCommandIo
  createInviteQr?: (inviteUrl: string) => Promise<RoomInviteQr>
}

const defaultIo: RoomCommandIo = {
  write: (text) => {
    process.stdout.write(text)
  },
  fail: () => {
    process.exitCode = 1
  },
}

export function registerRoomCommand(program: Command, options: RoomCommandOptions = {}): void {
  const client = options.client ?? new PublicRoomClient()
  const cache = options.cache ?? new PublicAttachmentCache({ client })
  const io = options.io ?? defaultIo
  const createInviteQr = options.createInviteQr ?? createRoomInviteQr
  const buildInvitationSharing = async (inviteUrl: string, roomName?: string) => {
    const inviteQr = await createInviteQr(inviteUrl).catch(() => ({
      imagePath: null,
      mimeType: 'image/png' as const,
      payload: inviteUrl,
      dataUrl: null,
    }))
    return {
      inviteUrl,
      installUrl: SHENNIAN_INSTALL_URL,
      text: roomInvitationShareText(inviteUrl, roomName),
      inviteQr,
    }
  }
  const room = program.command('room').description('Use one explicitly referenced Shennian Room')
  room.command('schedule', { hidden: true }).description('Manage scheduled work in the current managed conversation')
    .requiredOption('--operation <operation>', 'list/create/update/pause/resume/delete')
    .option('--id <id>').option('--version <version>').option('--operation-id <operationId>')
    .option('--time-description <timeDescription>').option('--timezone <timezone>').option('--prompt <prompt>')
    .action(async (flags) => run('room.schedule', io, async () => {
      const context = managedContext()
      if (!context) invalid('managed_room_context_required', 'Scheduling is only available in managed Room context.', externalRoomNextAction())
      return callManaged(context, 'schedule', { ...flags, version: flags.version ? Number(flags.version) : undefined })
    }))


  room
    .command('create')
    .description('Create a Room as the paired user')
    .requiredOption('--name <name>', 'Room name')
    .action(async (flags: { name: string }) =>
      run('room.create', io, async () => {
        rejectManagedHumanAction('create')
        const name = flags.name.trim()
        if (!name || name.length > 80)
          invalid('invalid_room_name', 'Room name must contain 1 to 80 characters.')
        const result = await client.create(name, crypto.randomUUID())
        const room = record(result.room, 'invalid_room_response')
        if (typeof room.inviteUrl !== 'string') {
          invalid('invalid_room_response', 'Shennian returned an invalid Room invitation.')
        }
        return {
          ...result,
          sharing: await buildInvitationSharing(
            room.inviteUrl,
            typeof room.name === 'string' ? room.name : name,
          ),
        }
      }),
    )

  room
    .command('list')
    .description('List Rooms for the paired user; duplicate names remain separate candidates')
    .action(() =>
      run('room.list', io, () => {
        rejectManagedHumanAction('list')
        return client.list()
      }),
    )

  room
    .command('get <room-ref>')
    .description('Get one explicitly referenced Room and its current version')
    .action((roomRef: string) =>
      run('room.get', io, () => {
        rejectManagedHumanAction('get')
        return client.get(parseRoomRef(roomRef))
      }),
    )

  room
    .command('update <room-ref>')
    .description('Update one Room using the version returned by room get or room list')
    .requiredOption('--version <version>', 'Exact Room version returned by Shennian')
    .option('--name <name>', 'New Room name')
    .option('--visibility <visibility>', 'private or public_read')
    .option('--join-policy <policy>', 'open, approval, or closed')
    .action((roomRef: string, flags: {
      version: string
      name?: string
      visibility?: string
      joinPolicy?: string
    }) =>
      run('room.update', io, () => {
        rejectManagedHumanAction('update')
        const name = flags.name?.trim()
        if (flags.name !== undefined && (!name || name.length > 80)) {
          invalid('invalid_room_name', 'Room name must contain 1 to 80 characters.')
        }
        if (
          flags.visibility !== undefined &&
          flags.visibility !== 'private' &&
          flags.visibility !== 'public_read'
        ) {
          invalid('invalid_room_visibility', '--visibility must be private or public_read.')
        }
        if (
          flags.joinPolicy !== undefined &&
          flags.joinPolicy !== 'open' &&
          flags.joinPolicy !== 'approval' &&
          flags.joinPolicy !== 'closed'
        ) {
          invalid('invalid_room_join_policy', '--join-policy must be open, approval, or closed.')
        }
        if (name === undefined && flags.visibility === undefined && flags.joinPolicy === undefined) {
          invalid('room_update_required', 'Provide --name, --visibility, or --join-policy.')
        }
        return client.update(parseRoomRef(roomRef), {
          version: parseVersion(flags.version),
          ...(name === undefined ? {} : { name }),
          ...(flags.visibility === undefined
            ? {}
            : { visibility: flags.visibility as 'private' | 'public_read' }),
          ...(flags.joinPolicy === undefined
            ? {}
            : { joinPolicy: flags.joinPolicy as 'open' | 'approval' | 'closed' }),
        })
      }),
    )

  room
    .command('delete <room-ref>')
    .description('Delete this user\'s Room chat record without physically deleting the Room')
    .requiredOption('--version <version>', 'Exact Room version returned by Shennian')
    .action((roomRef: string, flags: { version: string }) =>
      run('room.delete', io, () => {
        rejectManagedHumanAction('delete')
        return client.deleteRecord(parseRoomRef(roomRef), parseVersion(flags.version))
      }),
    )

  room
    .command('join <invite-url>')
    .description('Join or request access through an official Room invitation')
    .option(
      '--message <message>',
      'Introduction and reason required when owner approval is enabled',
    )
    .action(async (inviteUrl: string, flags: { message?: string }) =>
      run('room.join', io, async () => {
        rejectManagedHumanAction('join')
        const parsed = parseRoomUrl(inviteUrl, 'invite')
        const message = flags.message?.trim()
        if (message && message.length > 500) {
          invalid('join_message_too_long', 'Join request message must be at most 500 characters.')
        }
        return client.join(parsed.roomId, parsed.inviteToken!, message)
      }),
    )

  room
    .command('open <room-url>')
    .description('Open one Room where the paired user is already a member')
    .action(async (roomUrl: string) =>
      run('room.open', io, async () => {
        rejectManagedHumanAction('open')
        const parsed = parseRoomUrl(roomUrl, 'stable')
        return client.open(parsed.roomId)
      }),
    )

  room
    .command('status [room-ref]')
    .description('Show the managed Room, or one explicitly referenced Room')
    .action(async (roomRef?: string) =>
      run('room.status', io, () => {
        const context = managedContext()
        if (context) {
          if (roomRef)
            invalid(
              'managed_room_ref_forbidden',
              'Do not pass a Room reference in managed Room context.',
            )
          return callManaged(context, 'status', {})
        }
        return client.status(parseRequiredRoomRef(roomRef))
      }),
    )

  room
    .command('read [room-ref]')
    .description('Read recent, older, or newer messages from one Room')
    .option('--before <sequence>', 'Read messages before this sequence')
    .option('--after <sequence>', 'Read messages after this sequence')
    .option('--limit <count>', 'Maximum messages, 1 to 50', '50')
    .action(
      async (
        roomRef: string | undefined,
        flags: { before?: string; after?: string; limit: string },
      ) => {
        await run('room.read', io, async () => {
          if (flags.before && flags.after)
            invalid('ambiguous_sequence_cursor', '--before and --after are mutually exclusive.')
          if (flags.before && !isSequence(flags.before))
            invalid('invalid_sequence', '--before sequence is invalid.')
          if (flags.after && !isSequence(flags.after))
            invalid('invalid_sequence', '--after sequence is invalid.')
          const limit = Number(flags.limit)
          if (!Number.isInteger(limit) || limit < 1 || limit > 50)
            invalid('invalid_limit', '--limit must be between 1 and 50.')
          const context = managedContext()
          if (context) {
            if (roomRef)
              invalid(
                'managed_room_ref_forbidden',
                'Do not pass a Room reference in managed Room context.',
              )
            return callManaged(context, 'read', {
              ...(flags.before ? { before: flags.before } : {}),
              ...(flags.after ? { after: flags.after } : {}),
              limit,
            })
          }
          const roomId = parseRequiredRoomRef(roomRef)
          const result = await client.read(roomId, {
            before: flags.before,
            after: flags.after,
            limit,
          })
          return addLocalAttachmentState(result, roomId, cache)
        })
      },
    )

  room
    .command('wait <room-ref>')
    .description('Wait up to 60 seconds for new messages after an exact sequence')
    .requiredOption('--after <sequence>', 'Sequence returned by room send or read')
    .option('--timeout <seconds>', 'Wait for 1 to 60 seconds', '60')
    .action((roomRef: string, flags: { after: string; timeout: string }) =>
      run('room.wait', io, async () => {
        rejectManagedHumanAction('wait')
        if (!isSequence(flags.after)) invalid('invalid_sequence', '--after sequence is invalid.')
        let timeout: number
        try { timeout = parseWaitTimeout(flags.timeout) }
        catch { invalid('invalid_wait_timeout', '--timeout must be between 1 and 60 seconds.') }
        const roomId = parseRequiredRoomRef(roomRef)
        return waitForMessages(
          after => client.read(roomId, { after, limit: 50 }),
          flags.after,
          timeout!,
        )
      }),
    )

  room
    .command('send [room-ref]')
    .description('Send text and up to 10 files as the paired user')
    .option('--text <text>', 'Message text')
    .option('--file <path>', 'Local file path; repeat for multiple files', collect, [])
    .action(async (roomRef: string | undefined, flags: { text?: string; file: string[] }) => {
      await run('room.send', io, async () => {
        const text = normalizeEscapedRoomLineBreaks(flags.text?.trim() ?? '')
        if (!text && flags.file.length === 0)
          invalid('room_message_empty', 'Provide --text or at least one --file.')
        if (flags.file.length > 10)
          invalid('room_attachments_too_many', 'A message can contain at most 10 files.')
        const context = managedContext()
        if (context) {
          if (roomRef)
            invalid(
              'managed_room_ref_forbidden',
              'Do not pass a Room reference in managed Room context.',
            )
          return callManaged(context, 'send', {
            clientMessageId: `managed:${crypto.randomUUID()}`,
            text,
            files: flags.file,
          })
        }
        const roomId = parseRequiredRoomRef(roomRef)
        const attachmentIds: string[] = []
        for (const filePath of flags.file)
          attachmentIds.push(await uploadFile(client, roomId, filePath))
        return client.send(roomId, {
          clientMessageId: `cli:${crypto.randomUUID()}`,
          ...(text ? { text } : {}),
          ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
        })
      })
    })

  room
    .command('pause', { hidden: true })
    .description('Pause the current managed Agent in its bound Room')
    .requiredOption('--reason <reason>', 'Short reason shown to all Room members')
    .action(async (flags: { reason: string }) =>
      run('room.pause', io, () => {
        const context = managedContext()
        if (!context) invalid('managed_room_context_required', 'Pause is only available in managed Room context.', externalRoomNextAction())
        return callManaged(context!, 'pause', { reason: flags.reason })
      }),
    )

  const attachment = room
    .command('attachment')
    .description('Download Room attachments through Shennian')
  attachment
    .command('get [room-ref] [attachment-id]')
    .description('Download and verify one Room attachment')
    .action(async (roomRef?: string, attachmentId?: string) => {
      await run('room.attachment.get', io, async () => {
        const context = managedContext()
        const resolvedAttachmentId = context ? roomRef : attachmentId
        if (!resolvedAttachmentId || !/^ratt_[A-Za-z0-9_-]{1,191}$/.test(resolvedAttachmentId)) {
          invalid('invalid_attachment_ref', 'attachment-id is invalid.')
        }
        if (context)
          return callManaged(context, 'attachment.get', { attachmentId: resolvedAttachmentId })
        return cache.materialize(parseRequiredRoomRef(roomRef), resolvedAttachmentId)
      })
    })

  room
    .command('leave <room-ref>')
    .description('Leave one explicitly referenced Room')
    .action(async (roomRef: string) =>
      run('room.leave', io, () => {
        rejectManagedHumanAction('leave')
        return client.leave(parseRoomRef(roomRef))
      }),
    )

  const invite = room.command('invite').description('Read or reset the current Room invitation')
  invite
    .command('get <room-ref>')
    .description('Get the current invitation and version for one Room')
    .action((roomRef: string) =>
      run('room.invite.get', io, async () => {
        rejectManagedHumanAction('invite get')
        const result = record(await client.getInvite(parseRoomRef(roomRef)), 'invalid_room_response')
        const invitation = record(result.invite, 'invalid_room_response')
        if (typeof invitation.url !== 'string') {
          invalid('invalid_room_response', 'Shennian returned an invalid Room invitation.')
        }
        return {
          ...result,
          sharing: await buildInvitationSharing(invitation.url),
        }
      }),
    )
  invite
    .command('reset <room-ref>')
    .description('Reset an invitation using the version returned by room invite get')
    .requiredOption('--version <version>', 'Positive invitation version')
    .action((roomRef: string, flags: { version: string }) =>
      run('room.invite.reset', io, async () => {
        rejectManagedHumanAction('invite reset')
        const result = record(
          await client.resetInvite(
            parseRoomRef(roomRef),
            parsePositiveInteger(flags.version, 'room_invite_version'),
          ),
          'invalid_room_response',
        )
        const invitation = record(result.invite, 'invalid_room_response')
        if (typeof invitation.url !== 'string') {
          invalid('invalid_room_response', 'Shennian returned an invalid Room invitation.')
        }
        return {
          ...result,
          sharing: await buildInvitationSharing(invitation.url),
        }
      }),
    )

  const member = room.command('member').description('List or remove Room members')
  member
    .command('list <room-ref>')
    .description('List public member references and versions for one Room')
    .action((roomRef: string) =>
      run('room.member.list', io, () => {
        rejectManagedHumanAction('member list')
        return client.listMembers(parseRoomRef(roomRef))
      }),
    )
  member
    .command('remove <room-ref>')
    .description('Remove one exact member reference using its listed version')
    .requiredOption('--member-ref <member-ref>', 'Public member reference returned by room member list')
    .requiredOption('--version <version>', 'Positive member version returned by room member list')
    .action((roomRef: string, flags: { memberRef: string; version: string }) =>
      run('room.member.remove', io, () => {
        rejectManagedHumanAction('member remove')
        if (!/^member_[A-Za-z0-9_-]{32,64}$/.test(flags.memberRef)) {
          invalid('invalid_room_member_ref', 'Use a memberRef returned by room member list.')
        }
        return client.removeMember(
          parseRoomRef(roomRef),
          flags.memberRef,
          parsePositiveInteger(flags.version, 'room_member_version'),
        )
      }),
    )
  room
    .command('search', { hidden: true })
    .allowUnknownOption(true)
    .action(() =>
      writeError(io, 'command_removed', 'Room search is not available to Agents.', null),
    )
  room
    .command('agent', { hidden: true })
    .allowUnknownOption(true)
    .action(() =>
      writeError(
        io,
        'command_removed',
        'Managed Agents are created in the Shennian mobile App.',
        null,
      ),
    )
}

function roomInvitationShareText(inviteUrl: string, roomName?: string): string {
  return [
    roomName ? '邀请你加入神念群聊「' + roomName + '」。' : '点击加入神念群聊，或把本消息发给你的 AI：',
    ...(roomName
      ? ['直接点击，或把本消息发给你的 AI，让它安装神念、完成配对并加入群聊。']
      : []),
    '邀请：' + inviteUrl,
    '安装：' + SHENNIAN_INSTALL_URL,
  ].join('\n')
}

async function run(
  command: string,
  io: RoomCommandIo,
  operation: () => Promise<unknown>,
): Promise<void> {
  try {
    const result = await operation()
    io.write(`${JSON.stringify({
      ok: true,
      command,
      result: stripPrivateRoomFields(result, opensRoomInCurrentHost(command)),
    })}\n`)
  } catch (error) {
    if (error instanceof PublicRoomClientError) {
      writeError(io, error.code, error.message, error.nextAction)
      return
    }
    if (error instanceof DaemonIpcError) {
      writeError(io, error.code, error.message, managedRoomNextAction(error.code))
      return
    }
    writeError(io, 'room_command_failed', 'Shennian Room command failed.', null)
  }
}

function opensRoomInCurrentHost(command: string): boolean {
  return command === 'room.create' || command === 'room.join' || command === 'room.open'
}

function stripPrivateRoomFields(value: unknown, keepLaunchUrl: boolean): unknown {
  if (Array.isArray(value)) return value.map(child => stripPrivateRoomFields(child, keepLaunchUrl))
  if (!value || typeof value !== 'object') return value
  const sanitized: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (key === 'access' || (key === 'launchUrl' && !keepLaunchUrl)) continue
    sanitized[key] = stripPrivateRoomFields(child, keepLaunchUrl)
  }
  return sanitized
}

function managedContext(): string | null {
  const value = process.env[MANAGED_ROOM_CONTEXT_ENV]?.trim()
  return value || null
}

async function callManaged(
  context: string,
  action: 'schedule' | 'status' | 'read' | 'send' | 'attachment.get' | 'pause',
  params: Record<string, unknown>,
) {
  const ipcRoot = process.env[MANAGED_ROOM_IPC_ROOT_ENV]?.trim()
  if (!ipcRoot || !path.isAbsolute(ipcRoot)) {
    throw new DaemonIpcError(
      'managed_room_context_unavailable',
      'Managed Room IPC context is unavailable.',
    )
  }
  return callDaemonIpc({
    method: 'managed-room.execute',
    params: { context, action, ...params } as never,
    paths: resolveManagedRoomIpcPaths(ipcRoot),
    timeoutMs: action === 'send' || action === 'attachment.get' ? 180_000 : 15_000,
  })
}

function rejectManagedHumanAction(action: string): void {
  if (managedContext())
    invalid('managed_room_action_forbidden', `${action} is not available in managed Room context.`)
}

function parseRequiredRoomRef(value?: string): string {
  if (!value) {
    invalid('room_ref_required', 'Use an official Room URL returned by Shennian.', externalRoomNextAction())
  }
  return parseRoomRef(value)
}

function parseRoomRef(value: string): string {
  return parseRoomUrl(value, 'stable').roomId
}

function parseRoomUrl(
  value: string,
  expected: 'stable' | 'invite',
): { roomId: string; inviteToken?: string } {
  let url: URL
  const code = expected === 'invite' ? 'invalid_invite_url' : 'invalid_room_ref'
  const message =
    expected === 'invite'
      ? 'Use an official Shennian Room invitation URL.'
      : 'Use an official Room URL returned by Shennian.'
  try {
    url = new URL(value)
  } catch {
    invalid(code, message)
  }
  const match = url!.pathname.match(/^\/spaces\/([A-Za-z0-9_-]{1,191})$/)
  const inviteToken = url!.searchParams.get('invite')
  if (
    url!.protocol !== 'https:' ||
    url!.hostname !== 'app.shennian.net' ||
    url!.port ||
    url!.username ||
    url!.password ||
    url!.hash ||
    !match ||
    url!.searchParams.has('access') ||
    [...url!.searchParams.keys()].some((key) => key !== 'invite') ||
    (expected === 'stable' && inviteToken != null) ||
    (expected === 'invite' && (inviteToken == null || !/^[A-Za-z0-9_-]{32,256}$/.test(inviteToken)))
  )
    invalid(code, message)
  return { roomId: match![1]!, ...(inviteToken ? { inviteToken } : {}) }
}

function isSequence(value: string): boolean {
  return /^(0|[1-9]\d{0,19})$/.test(value)
}

function parseVersion(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    invalid('invalid_room_version', 'Use the exact version returned by room get or room list.')
  }
  return value
}

function parsePositiveInteger(value: string, code: string): number {
  if (!/^[1-9]\d*$/.test(value)) invalid(code, 'Version must be a positive integer.')
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) invalid(code, 'Version must be a positive integer.')
  return parsed
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value]
}

function normalizeEscapedRoomLineBreaks(text: string): string {
  // Repeated escaped paragraph breaks indicate prose formatted as a string literal.
  // Leave isolated escapes alone so technical examples keep their exact text.
  if (text.includes('\n') || !text.includes('\\n\\n')) return text
  return text.replace(/(?<!\\)\\n/g, '\n')
}

async function uploadFile(
  client: PublicRoomClient,
  roomId: string,
  requestedPath: string,
): Promise<string> {
  const absolute = path.resolve(requestedPath)
  let stat: fs.Stats
  try {
    stat = await fs.promises.lstat(absolute)
  } catch {
    invalid('file_not_found', `File does not exist: ${requestedPath}`)
  }
  if (!stat!.isFile() || stat!.isSymbolicLink())
    invalid('invalid_file', `Not a regular file: ${requestedPath}`)
  if (stat!.size < 1 || stat!.size > 100 * 1024 * 1024)
    invalid('invalid_file_size', 'Each file must be between 1 byte and 100 MB.')
  const data = await fs.promises.readFile(absolute)
  const sha256 = crypto.createHash('sha256').update(data).digest('hex')
  const mimeType = inferMimeType(absolute)
  const initialized = await client.initializeAttachment(roomId, {
    clientUploadId: `cli:${crypto.randomUUID()}`,
    name: path.basename(absolute),
    mediaKind: attachmentMediaKind(path.basename(absolute), mimeType),
    mimeType,
    byteSize: stat!.size,
    sha256,
  })
  const attachment = record(initialized.attachment, 'invalid_attachment_response')
  const upload = record(initialized.upload, 'invalid_attachment_response')
  if (
    typeof attachment.id !== 'string' ||
    typeof upload.url !== 'string' ||
    upload.method !== 'PUT'
  ) {
    invalid('invalid_attachment_response', 'Shennian returned an invalid attachment response.')
  }
  const headers = record(upload.headers, 'invalid_attachment_response')
  if (Object.values(headers).some((value) => typeof value !== 'string')) {
    invalid('invalid_attachment_response', 'Shennian returned invalid upload headers.')
  }
  validateTemporaryUrl(upload.url as string)
  await client.upload(upload.url as string, headers as Record<string, string>, data)
  await client.completeAttachment(roomId, attachment.id as string)
  return attachment.id as string
}

function inferMimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase()
  const known: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.csv': 'text/csv',
    '.zip': 'application/zip',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }
  return known[extension] ?? 'application/octet-stream'
}

function addLocalAttachmentState(
  result: Record<string, unknown>,
  roomId: string,
  cache: PublicAttachmentCache,
): Record<string, unknown> {
  if (!Array.isArray(result.messages))
    invalid('invalid_server_response', 'Shennian returned invalid messages.')
  return {
    messages: result.messages.map((value) => {
      const message = record(value, 'invalid_server_response')
      const attachments = Array.isArray(message.attachments) ? message.attachments : []
      return {
        ...message,
        attachments: attachments.map((value) => {
          const attachment = record(value, 'invalid_server_response')
          if (
            typeof attachment.attachmentId !== 'string' ||
            typeof attachment.name !== 'string' ||
            typeof attachment.mimeType !== 'string' ||
            typeof attachment.byteSize !== 'string' ||
            typeof attachment.sha256 !== 'string'
          )
            invalid('invalid_server_response', 'Shennian returned invalid attachment metadata.')
          return {
            ...attachment,
            ...cache.lookup(
              roomId,
              attachment as {
                attachmentId: string
                name: string
                mimeType: string
                byteSize: string
                sha256: string
              },
            ),
          }
        }),
      }
    }),
  }
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid(code, 'Invalid structured response.')
  return value as Record<string, unknown>
}

function validateTemporaryUrl(value: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    invalid('invalid_attachment_response', 'Invalid upload URL.')
  }
  const localHttp =
    url!.protocol === 'http:' && (url!.hostname === 'localhost' || url!.hostname === '127.0.0.1')
  if ((url!.protocol !== 'https:' && !localHttp) || url!.username || url!.password || url!.hash) {
    invalid('invalid_attachment_response', 'Invalid upload URL.')
  }
}

function invalid(code: string, message: string, nextAction: Record<string, string> | null = null): never {
  throw new PublicRoomClientError(code, message, nextAction)
}

function writeError(
  io: RoomCommandIo,
  error: string,
  message: string,
  nextAction: Record<string, string> | null,
): void {
  io.write(`${JSON.stringify({ ok: false, error, message, nextAction })}\n`)
  io.fail()
}
