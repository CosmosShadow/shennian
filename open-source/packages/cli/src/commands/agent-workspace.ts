// @arch open-source/docs/cli-runtime.md
// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/agent-workspace-command.test.ts

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Command } from 'commander'
import { DEFAULT_RESTRICTED_MANAGED_AGENT_PERMISSION_POLICY } from '@shennian/wire'
import { getShennianDir } from '../config/index.js'
import { callDaemonIpc } from '../daemon-ipc/client.js'
import { DaemonIpcError } from '../daemon-ipc/protocol.js'
import {
  PublicAgentClient,
  PublicAgentClientError,
} from '../agents/public-agent-client.js'

type AgentCommandIo = { write: (text: string) => void; fail: () => void }
export type AgentCommandOptions = {
  client?: PublicAgentClient
  io?: AgentCommandIo
  callDaemon?: typeof callDaemonIpc
}

const defaultIo: AgentCommandIo = {
  write: (text) => process.stdout.write(text),
  fail: () => { process.exitCode = 1 },
}

export function registerAgentWorkspaceCommands(
  agent: Command,
  options: AgentCommandOptions = {},
): void {
  const client = options.client ?? new PublicAgentClient()
  const io = options.io ?? defaultIo
  const callDaemon = options.callDaemon ?? callDaemonIpc

  agent.command('list')
    .description('List Shennian Agents owned by the paired user on this computer')
    .action(() => run('agent.list', io, () => client.list()))

  agent.command('get <agent-id>')
    .description('Read one exact Shennian Agent')
    .action((agentId: string) => run('agent.get', io, () => client.get(parseId(agentId, 'agent_id_invalid'))))

  agent.command('create')
    .description('Check one local AI configuration, then create a Shennian Agent (full access unless --file-access is set)')
    .requiredOption('--name <name>', 'Agent display name')
    .requiredOption('--description <description>', 'Public Room introduction')
    .requiredOption('--agent <type>', 'Exact type returned by agent discover')
    .requiredOption('--workdir <path>', 'Absolute working directory on this computer')
    .option('--model <id>', 'Exact model id returned by agent discover')
    .option('--system-prompt <prompt>', 'Private system prompt', '')
    .option('--file-access <mode>', 'Codex restricted file access: workspace-read or workspace-write; denies network, web, browser, computer use and MCP')
    .action((flags: AgentDefinitionFlags) => run('agent.create', io, async () => {
      const definition = definitionFromFlags(flags)
      await validateRuntime(definition, callDaemon)
      return client.create(definition)
    }))

  agent.command('share')
    .description('Publish an existing Agent by --agent-id, or create one and return a usable link')
    .option('--agent-id <id>', 'Exact id of an existing Shennian Agent')
    .option('--name <name>', 'New Agent and public display name')
    .option('--agent <type>', 'New Agent type returned by agent discover')
    .option('--workdir <path>', 'Working directory; otherwise create an empty private directory')
    .option('--model <id>', 'Exact model id returned by agent discover')
    .option('--description <description>', 'Public introduction', '')
    .option('--system-prompt <prompt>', 'Private system prompt', '')
    .option('--file-access <mode>', 'Codex restricted file access: workspace-read or workspace-write; denies network, web, browser, computer use and MCP')
    .option('--anonymous', 'Allow browser-scoped visitors to chat without signing in (default)')
    .option('--require-login', 'Require visitors to sign in before chatting')
    .action((flags: AgentShareFlags) => run('agent.share', io, async () => {
      if (flags.anonymous && flags.requireLogin) {
        invalid('agent_share_access_conflict', 'Use either --anonymous or --require-login, not both.')
      }
      const anonymous = !flags.requireLogin
      let id = ''
      let definition: Record<string, unknown>
      if (flags.agentId) {
        if (flags.name || flags.agent || flags.workdir || flags.model || flags.systemPrompt || flags.description || flags.fileAccess) {
          invalid('agent_share_ambiguous', 'Use --agent-id alone for an existing Agent; edit its settings separately.')
        }
        id = parseId(flags.agentId, 'agent_id_invalid')
        definition = agentRecord(await client.get(id))
        if (definition.status !== 'active') invalid('agent_unavailable', 'This Agent is not active.')
      } else {
        if (!flags.name || !flags.agent) {
          invalid('agent_share_selection_required', 'Provide --agent-id for an existing Agent, or --name and --agent for a new one.')
        }
        const workDir = flags.workdir ? absolutePath(flags.workdir) : await createShareWorkDir()
        definition = definitionFromFlags({ ...flags, name: flags.name, agent: flags.agent,
          systemPrompt: flags.systemPrompt ?? '',
          description: flags.description || flags.name, workdir: workDir })
      }
      if (!flags.agentId) {
        // New AI creation still validates its definition. Sharing an existing
        // AI reuses the saved configuration without another hello probe.
        await validateRuntime(definition, callDaemon)
        const created = agentRecord(await client.create(definition))
        id = requiredString(created.id, 'invalid_server_response')
      }
      const existing = flags.agentId ? (await client.getPublication(id)).publication : null
      if (!existing || (typeof existing === 'object' && !Array.isArray(existing)
        && (existing as Record<string, unknown>).status === 'revoked')) {
        await client.createPublicationDraft(id, {
          displayName: requiredString(definition.displayName, 'invalid_server_response'),
          description: typeof definition.description === 'string' ? definition.description : '',
          dailyMessageLimit: 100,
        })
      }
      const initial = record(existing ?? (await client.getPublication(id)).publication,
        'invalid_server_response')
      if ((initial.allowAnonymousVisitors === true) !== anonymous) {
        await client.setPublicationAnonymousAccess(id, anonymous,
          positiveVersion(initial.generation), positiveVersion(initial.policyVersion))
      }
      const draft = record((await client.getPublication(id)).publication, 'invalid_server_response')
      if (draft.status !== 'active') {
        const activated = record((await client.activatePublication(id,
          positiveVersion(draft.generation), positiveVersion(draft.policyVersion))).publication,
        'invalid_server_response')
        if (activated.status !== 'active') {
          invalid('agent_publication_inactive', `Agent ${id} exists, but publication is not active.`)
        }
      }
      const confirmed = record((await client.getPublication(id)).publication, 'invalid_server_response')
      if (confirmed.status !== 'active' || typeof confirmed.shareUrl !== 'string') {
        invalid('agent_publication_unconfirmed',
          `Agent ${id} was created, but an active share URL could not be confirmed.`)
      }
      if (anonymous && confirmed.allowAnonymousVisitors !== true) {
        invalid('agent_publication_guest_unconfirmed',
          `Agent ${id} was published, but browser guest access could not be confirmed.`)
      }
      if (!anonymous && confirmed.allowAnonymousVisitors !== false) {
        invalid('agent_publication_login_unconfirmed',
          `Agent ${id} was published, but sign-in requirements could not be confirmed.`)
      }
      return { agentId: id, status: 'active', shareUrl: confirmed.shareUrl,
        visitorAccess: confirmed.allowAnonymousVisitors === true ? 'browser_guest_allowed' : 'sign_in_required' }
    }))

  agent.command('update <agent-id>')
    .description('Update one exact Shennian Agent; runtime changes are checked before saving')
    .option('--name <name>', 'Agent display name')
    .option('--description <description>', 'Public Room introduction')
    .option('--agent <type>', 'Exact type returned by agent discover')
    .option('--workdir <path>', 'Absolute working directory on this computer')
    .option('--model <id>', 'Exact model id returned by agent discover')
    .option('--clear-model', 'Use the runtime default model')
    .option('--system-prompt <prompt>', 'Private system prompt')
    .action((agentId: string, flags: AgentUpdateFlags) => run('agent.update', io, async () => {
      const id = parseId(agentId, 'agent_id_invalid')
      const changes = changesFromFlags(flags)
      if (!Object.keys(changes).length) invalid('agent_changes_required', 'Provide at least one Agent field to update.')
      const current = agentRecord(await client.get(id))
      const next = { ...current, ...changes }
      if (runtimeSignature(current) !== runtimeSignature(next)) {
        await validateRuntime(next, callDaemon)
      }
      return client.update(id, changes)
    }))

  agent.command('delete <agent-id>')
    .description('Delete one exact Shennian Agent and its dedicated Room conversations')
    .action((agentId: string) => run('agent.delete', io, () => client.delete(parseId(agentId, 'agent_id_invalid'))))

  const room = agent.command('room').description('List, add, or remove this Agent in explicit Rooms')
  room.command('list <agent-id>')
    .description('List Rooms currently linked to one exact Agent')
    .action((agentId: string) => run('agent.room.list', io, () => client.listRooms(parseId(agentId, 'agent_id_invalid'))))
  room.command('add <agent-id> <room-url>')
    .description('Create a dedicated conversation and add this Agent to one explicit Room')
    .option('--mode <mode>', 'auto_follow, mention_only, or paused', 'auto_follow')
    .action((agentId: string, roomUrl: string, flags: { mode: string }) =>
      run('agent.room.add', io, async () => {
        const id = parseId(agentId, 'agent_id_invalid')
        const roomId = parseRoomUrl(roomUrl)
        const activationMode = parseActivationMode(flags.mode)
        const assignmentIntentId = `cli-agent-room:${crypto.randomUUID()}`
        const prepared = await client.createRoomSession(id, {
          roomId,
          assignmentIntentId,
          activationMode,
        })
        if (prepared.existing === true) return prepared
        const session = record(prepared.session, 'invalid_server_response')
        const sessionId = requiredString(session.id, 'invalid_server_response')
        const agentType = requiredString(session.agentType, 'invalid_server_response')
        const binding = await callDaemon({
          method: 'room.agent.bind-managed',
          params: {
            roomId,
            agentIdentityId: id,
            nianSessionId: sessionId,
            assignmentIntentId,
            agentType,
            activationMode,
          },
          timeoutMs: 120_000,
        })
        return { session, binding }
      }),
    )
  room.command('remove <agent-id> <room-url>')
    .description('Remove this Agent from one explicit Room and delete its dedicated conversation')
    .action((agentId: string, roomUrl: string) => run('agent.room.remove', io, () =>
      client.removeFromRoom(parseId(agentId, 'agent_id_invalid'), parseRoomUrl(roomUrl))))

  const publication = agent.command('publication')
    .description('Manage one Agent publication by exact Agent id')
  publication.command('get <agent-id>')
    .description('Read publication status and versions')
    .action((agentId: string) => run('agent.publication.get', io, () =>
      client.getPublication(parseId(agentId, 'agent_id_invalid'))))
  publication.command('readiness <agent-id>')
    .description('Read the current machine and runtime checks for one exact Agent publication')
    .action((agentId: string) => run('agent.publication.readiness', io, () =>
      client.getPublicationReadiness(parseId(agentId, 'agent_id_invalid'))))
  publication.command('draft <agent-id>')
    .description('Create an inactive publication draft; this does not expose a share URL')
    .requiredOption('--name <name>', 'Public display name')
    .requiredOption('--description <description>', 'Public introduction')
    .option('--daily-limit <count>', 'Visitor messages per day', '100')
    .action((agentId: string, flags: { name: string; description: string; dailyLimit: string }) =>
      run('agent.publication.draft', io, () => client.createPublicationDraft(
        parseId(agentId, 'agent_id_invalid'), {
          displayName: text(flags.name, 80, 'publication_name_invalid', true),
          description: text(flags.description, 1000, 'publication_description_invalid'),
          dailyMessageLimit: parseDailyLimit(flags.dailyLimit),
        },
      )))
  publication.command('update <agent-id>')
    .description('Update publication details with versions from publication get')
    .requiredOption('--generation <number>', 'Expected generation')
    .requiredOption('--policy-version <number>', 'Expected policy version')
    .requiredOption('--name <name>', 'Public display name')
    .requiredOption('--description <description>', 'Public introduction')
    .requiredOption('--daily-limit <count>', 'Visitor messages per day')
    .action((agentId: string, flags: PublicationUpdateFlags) =>
      run('agent.publication.update', io, () => client.updatePublication(
        parseId(agentId, 'agent_id_invalid'), {
          expectedGeneration: parsePositiveInt(flags.generation, 'publication_generation_invalid'),
          expectedPolicyVersion: parsePositiveInt(flags.policyVersion, 'publication_policy_version_invalid'),
          displayName: text(flags.name, 80, 'publication_name_invalid', true),
          description: text(flags.description, 1000, 'publication_description_invalid'),
          dailyMessageLimit: parseDailyLimit(flags.dailyLimit),
        },
      )))
  publication.command('anonymous <agent-id>')
    .description('Enable or disable browser-scoped chats without sign-in on one publication')
    .requiredOption('--generation <number>', 'Expected generation')
    .requiredOption('--policy-version <number>', 'Expected policy version')
    .requiredOption('--allowed <value>', 'true or false')
    .action((agentId: string, flags: PublicationVersionFlags & { allowed: string }) =>
      run('agent.publication.anonymous', io, () => client.setPublicationAnonymousAccess(
        parseId(agentId, 'agent_id_invalid'), parseBoolean(flags.allowed),
        parsePositiveInt(flags.generation, 'publication_generation_invalid'),
        parsePositiveInt(flags.policyVersion, 'publication_policy_version_invalid'),
      )))
  publication.command('pause <agent-id>')
    .description('Pause an active publication using exact versions')
    .requiredOption('--generation <number>', 'Expected generation')
    .requiredOption('--policy-version <number>', 'Expected policy version')
    .action((agentId: string, flags: PublicationVersionFlags) =>
      run('agent.publication.pause', io, () => client.pausePublication(
        parseId(agentId, 'agent_id_invalid'),
        parsePositiveInt(flags.generation, 'publication_generation_invalid'),
        parsePositiveInt(flags.policyVersion, 'publication_policy_version_invalid'),
      )))
  publication.command('activate <agent-id>')
    .description('Activate a draft or resume a paused publication only after server release and runtime checks')
    .requiredOption('--generation <number>', 'Expected generation')
    .requiredOption('--policy-version <number>', 'Expected policy version')
    .action((agentId: string, flags: PublicationVersionFlags) =>
      run('agent.publication.activate', io, () => client.activatePublication(
        parseId(agentId, 'agent_id_invalid'),
        parsePositiveInt(flags.generation, 'publication_generation_invalid'),
        parsePositiveInt(flags.policyVersion, 'publication_policy_version_invalid'),
      )))
  publication.command('revoke <agent-id>')
    .description('Revoke a publication and invalidate its old share URL')
    .requiredOption('--generation <number>', 'Expected generation')
    .action((agentId: string, flags: { generation: string }) =>
      run('agent.publication.revoke', io, () => client.revokePublication(
        parseId(agentId, 'agent_id_invalid'),
        parsePositiveInt(flags.generation, 'publication_generation_invalid'),
      )))
  publication.command('conversations <agent-id>')
    .description('List this publication’s conversations, one page at a time')
    .option('--cursor <cursor>', 'Opaque next cursor from the previous page')
    .action((agentId: string, flags: { cursor?: string }) =>
      run('agent.publication.conversations', io, () => client.listPublicationConversations(
        parseId(agentId, 'agent_id_invalid'), flags.cursor,
      )))

  const publicAgent = agent.command('public')
    .description('Use the same published Agent URL as a human visitor')
  publicAgent.command('list')
    .description('List your own existing conversations, including history after a link is revoked')
    .option('--cursor <cursor>', 'Opaque next cursor from the previous page')
    .action((flags: { cursor?: string }) =>
      run('agent.public.list', io, () => client.listMyDirectConversations(flags.cursor)))
  publicAgent.command('open <url>')
    .description('Read public Agent details from an exact Shennian share URL')
    .action((url: string) => run('agent.public.open', io, () => client.openPublishedAgent(url)))
  publicAgent.command('read <url>')
    .description('Read your latest messages, or page older / follow newer messages')
    .option('--after <cursor>', 'Read messages after this sequence')
    .option('--before <cursor>', 'Read older messages before this sequence (default: latest)')
    .action((url: string, flags: { after?: string; before?: string }) =>
      run('agent.public.read', io, () => client.readPublishedAgent(url, flags)))
  publicAgent.command('history <conversation-id>')
    .description('Read your latest conversation history by stable ID after URL revocation')
    .option('--after <cursor>', 'Read messages after this sequence')
    .option('--before <cursor>', 'Read older messages before this sequence (default: latest)')
    .action((conversationId: string, flags: { after?: string; before?: string }) =>
      run('agent.public.history', io, () => client.readDirectConversation(
        parseId(conversationId, 'conversation_id_invalid'), flags,
      )))
  publicAgent.command('send <url> <message>')
    .description('Send one message as the paired human user; requires an active publication')
    .requiredOption('--client-message-id <id>', 'Stable ID for idempotent retries (letters, digits, _ or -)')
    .action((url: string, message: string, flags: { clientMessageId: string }) =>
      run('agent.public.send', io, async () => {
        const clientMessageId = parseMessageId(flags.clientMessageId)
        const result = await client.sendPublishedAgent(url, {
          text: text(message, 20_000, 'publication_message_invalid', true),
          clientMessageId,
        })
        // This reference identifies history, never grants access on its own.
        // The Server checks the paired human user for every read.
        return { ...result,
          ...(typeof result.conversationId === 'string'
            ? { conversationRef: result.conversationId } : {}),
          clientMessageId }
      }))
}

type PublicationVersionFlags = { generation: string; policyVersion: string }
type PublicationUpdateFlags = PublicationVersionFlags & {
  name: string; description: string; dailyLimit: string
}

function parsePositiveInt(value: string, code: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) invalid(code, 'Use a positive integer.')
  const number = Number(value)
  if (!Number.isSafeInteger(number)) invalid(code, 'Use a positive integer.')
  return number
}

function parseDailyLimit(value: string): number {
  const number = parsePositiveInt(value, 'publication_daily_limit_invalid')
  if (number > 1000) invalid('publication_daily_limit_invalid', 'Daily limit must be at most 1000.')
  return number
}

function parseMessageId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    invalid('publication_message_id_invalid', 'Use 1–128 letters, digits, _ or - for --client-message-id.')
  }
  return value
}

type AgentDefinitionFlags = {
  name: string
  description: string
  agent: string
  workdir: string
  model?: string
  systemPrompt: string
  fileAccess?: string
}
type AgentShareFlags = Partial<Omit<AgentDefinitionFlags, 'description' | 'workdir'>> & {
  agentId?: string
  description: string
  workdir?: string
  anonymous?: boolean
  requireLogin?: boolean
}

function parseBoolean(value: string): boolean {
  if (value === 'true') return true
  if (value === 'false') return false
  invalid('publication_anonymous_invalid', 'Use true or false for --allowed.')
}

async function createShareWorkDir(): Promise<string> {
  // Keep the workspace beside (not inside) credentials. In containers with
  // SHENNIAN_HOME=/data/shennian, this stays on the existing /data volume.
  const root = path.join(path.dirname(getShennianDir()), 'shennian-agent-workspaces')
  await fs.mkdir(root, { recursive: true, mode: 0o700 })
  const entry = await fs.lstat(root)
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    invalid('agent_workdir_invalid', 'The Agent workspace root is unavailable.')
  }
  return fs.mkdtemp(path.join(root, 'agent-'))
}

function positiveVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    invalid('invalid_server_response', 'Shennian returned an invalid publication version.')
  }
  return value
}
type AgentUpdateFlags = Partial<AgentDefinitionFlags> & { clearModel?: boolean }

function definitionFromFlags(flags: AgentDefinitionFlags): Record<string, unknown> {
  const restrictedPolicy = restrictedPolicyFromFlags(flags)
  return {
    displayName: text(flags.name, 191, 'agent_name_invalid', true),
    description: text(flags.description, 1000, 'agent_description_invalid', true),
    runtimeAdapter: text(flags.agent, 64, 'agent_runtime_invalid', true),
    workDir: absolutePath(flags.workdir),
    modelId: flags.model ? text(flags.model, 191, 'agent_model_invalid', true) : null,
    systemPrompt: text(flags.systemPrompt, 20_000, 'agent_system_prompt_invalid'),
    ...(restrictedPolicy ? { permissionPolicy: restrictedPolicy } : {}),
  }
}

function restrictedPolicyFromFlags(flags: AgentDefinitionFlags) {
  if (flags.fileAccess === undefined) return null
  if (flags.agent !== 'codex' ||
    (flags.fileAccess !== 'workspace-read' && flags.fileAccess !== 'workspace-write')) {
    invalid('agent_file_access_invalid', '--file-access supports only Codex workspace-read or workspace-write.')
  }
  return {
    ...DEFAULT_RESTRICTED_MANAGED_AGENT_PERMISSION_POLICY,
    executionMode: 'restricted' as const,
    fileAccess: flags.fileAccess,
    externalCapabilities: {
      commandNetwork: false, webSearch: false, browser: false,
      computerUse: false, mcp: false,
    },
  }
}

function changesFromFlags(flags: AgentUpdateFlags): Record<string, unknown> {
  if (flags.clearModel && flags.model !== undefined) {
    invalid('agent_model_ambiguous', 'Use either --model or --clear-model, not both.')
  }
  return {
    ...(flags.name === undefined ? {} : { displayName: text(flags.name, 191, 'agent_name_invalid', true) }),
    ...(flags.description === undefined ? {} : { description: text(flags.description, 1000, 'agent_description_invalid', true) }),
    ...(flags.agent === undefined ? {} : { runtimeAdapter: text(flags.agent, 64, 'agent_runtime_invalid', true) }),
    ...(flags.workdir === undefined ? {} : { workDir: absolutePath(flags.workdir) }),
    ...(flags.model === undefined && !flags.clearModel
      ? {}
      : { modelId: flags.clearModel ? null : text(flags.model, 191, 'agent_model_invalid', true) }),
    ...(flags.systemPrompt === undefined ? {} : { systemPrompt: text(flags.systemPrompt, 20_000, 'agent_system_prompt_invalid') }),
  }
}

async function validateRuntime(
  value: Record<string, unknown>,
  callDaemon: typeof callDaemonIpc,
): Promise<void> {
  const runtimeAdapter = requiredString(value.runtimeAdapter, 'agent_runtime_invalid')
  const workDir = requiredString(value.workDir, 'agent_workdir_invalid')
  const modelId = typeof value.modelId === 'string' ? value.modelId : null
  const result = record(await callDaemon({
    method: 'agent.check',
    params: { agentType: runtimeAdapter, workDir, modelId },
    timeoutMs: 90_000,
  }), 'agent_check_invalid_response')
  if (result.ready !== true) {
    throw new DaemonIpcError('agent_check_invalid_response', 'The daemon did not confirm a successful hello reply.')
  }
}

function runtimeSignature(value: Record<string, unknown>): string {
  return JSON.stringify([
    value.runtimeAdapter ?? null,
    value.workDir ?? null,
    value.modelId ?? null,
    typeof value.systemPrompt === 'string' ? value.systemPrompt.trim() : '',
  ])
}

function agentRecord(value: Record<string, unknown>): Record<string, unknown> {
  return record(value.agent, 'invalid_server_response')
}

async function run(command: string, io: AgentCommandIo, operation: () => Promise<unknown>) {
  try {
    const result = await operation()
    io.write(`${JSON.stringify({ ok: true, command, result })}\n`)
  } catch (error) {
    if (error instanceof PublicAgentClientError) {
      writeError(io, error.code, error.message, error.nextAction)
      return
    }
    if (error instanceof DaemonIpcError) {
      writeError(io, error.code, error.message, null)
      return
    }
    writeError(io, 'agent_command_failed', 'Shennian Agent command failed.', null)
  }
}

function parseId(value: string, code: string): string {
  if (!/^[A-Za-z0-9_.:@/-]{1,191}$/.test(value)) invalid(code, 'Use the exact Agent id returned by Shennian.')
  return value
}

function parseRoomUrl(value: string): string {
  let url: URL
  try { url = new URL(value) } catch { invalid('invalid_room_ref', 'Use an official Room URL returned by Shennian.') }
  const match = url!.pathname.match(/^\/spaces\/([A-Za-z0-9_-]{1,191})$/)
  if (url!.protocol !== 'https:' || url!.hostname !== 'app.shennian.net' || url!.port
    || url!.username || url!.password || url!.hash || url!.search || !match) {
    invalid('invalid_room_ref', 'Use an official Room URL returned by Shennian.')
  }
  return match![1]!
}

function parseActivationMode(value: string): 'auto_follow' | 'mention_only' | 'paused' {
  if (value === 'auto_follow' || value === 'mention_only' || value === 'paused') return value
  invalid('invalid_activation_mode', '--mode must be auto_follow, mention_only, or paused.')
}

function absolutePath(value: string): string {
  const normalized = text(value, 1024, 'agent_workdir_invalid', true)
  if (!path.isAbsolute(normalized)) invalid('agent_workdir_invalid', 'Use an absolute working directory.')
  return normalized
}

function text(value: unknown, max: number, code: string, required = false): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if ((required && !normalized) || normalized.length > max || normalized.includes('\0')) {
    invalid(code, 'Agent field is invalid.')
  }
  return normalized
}

function requiredString(value: unknown, code: string): string {
  if (typeof value !== 'string' || !value) invalid(code, 'Shennian returned an invalid Agent response.')
  return value
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid(code, 'Shennian returned an invalid Agent response.')
  }
  return value as Record<string, unknown>
}

function invalid(code: string, message: string): never {
  throw new PublicAgentClientError(code, message)
}

function writeError(
  io: AgentCommandIo,
  error: string,
  message: string,
  nextAction: Record<string, string> | null,
) {
  io.write(`${JSON.stringify({ ok: false, error, message, nextAction })}\n`)
  io.fail()
}
