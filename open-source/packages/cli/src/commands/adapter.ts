// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/adapter-command.test.ts

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Command } from 'commander'
import {
  ADAPTER_SUBMISSION_FILENAME,
  ADAPTER_SUBMISSION_MAX_BYTES,
  scanAdapterSubmissionSource,
} from '@shennian/wire'
import { AdapterCheckError, checkNodeAdapter } from '../adapter-kit/check.js'
import { findOfficialAdapter, OFFICIAL_ADAPTERS, readOfficialAdapterDoc } from '../adapter-kit/official-adapters.js'
import {
  AdapterSubmissionClientError,
  HttpAdapterSubmissionClient,
  type AdapterSubmissionClient,
} from '../adapter-kit/submission-client.js'
import {
  getNodeAdapter,
  getPassedCheck,
  listNodeAdapters,
  recordPassedCheck,
  registerNodeAdapter,
  removeNodeAdapter,
} from '../adapter-kit/registry.js'
import { loadConfig } from '../config/index.js'

const ADAPTER_CHECK_MAX_ATTEMPTS = 3

export type AdapterCommandOptions = {
  hostPath?: string
  /** Only used by tests to run the bundled host straight from TS source via `--import tsx`. */
  hostNodeArgs?: string[]
  submissionClient?: AdapterSubmissionClient
  clientVersion?: string
}

export function registerAdapterCommand(program: Command, options: AdapterCommandOptions = {}): void {
  const adapter = program.command('adapter').description('Create, check and manage local Shennian Node Adapters (protocol V1)')
  const hostPath = options.hostPath ?? resolveBundledHostPath()
  const hostNodeArgs = options.hostNodeArgs ?? []
  const submissionClient = options.submissionClient ?? new HttpAdapterSubmissionClient()

  adapter
    .command('init <directory>')
    .description('Create a dependency-free Node Adapter V1 template')
    .requiredOption('--name <name>', 'Display name for the adapter')
    .action((directory: string, opts: { name: string }) => {
      const targetDir = path.resolve(directory)
      const target = path.join(targetDir, 'adapter.mjs')
      if (fs.existsSync(target)) {
        writeError('adapter_file_exists', `Refusing to overwrite ${target}`)
        return
      }
      fs.mkdirSync(targetDir, { recursive: true })
      fs.writeFileSync(target, renderAdapterTemplate(opts.name), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      writeSuccess('adapter.init', {
        entry: target,
        protocolVersion: 1,
        requiredMethods: ['listModels', 'start', 'send', 'stop', 'resume'],
        maxCheckAttempts: ADAPTER_CHECK_MAX_ATTEMPTS,
      }, {
        type: 'implement_and_check',
        entry: target,
        workDir: targetDir,
        command: 'shennian adapter check <entry> --workdir <allowed-project-directory>',
        rules: [
          'Inspect only non-sensitive installation, version and machine-interface facts.',
          'Never read or print provider credentials or environment values.',
          'Pass systemPrompt through a real system/instructions channel; never prepend it to user text.',
          `Stop after ${ADAPTER_CHECK_MAX_ATTEMPTS} failed check iterations and explain the remaining stage/error to the user.`,
        ],
      })
    })

  adapter
    .command('check <entry>')
    .description('Run the full protocol V1 completeness check through the bundled Adapter Runtime')
    .option('--workdir <directory>', 'Working directory', process.cwd())
    .option('--model <id>', 'Preferred model ID; falls back to the dynamic default model')
    .option('--timeout <ms>', 'Timeout per step in milliseconds', '60000')
    .action(async (entry: string, opts: { workdir: string; model?: string; timeout: string }) => {
      const timeoutMs = Number.parseInt(opts.timeout, 10)
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300_000) {
        writeError('invalid_timeout', 'Timeout must be between 1000 and 300000 milliseconds.')
        return
      }
      const entryPath = path.resolve(entry)
      if (!fs.statSync(entryPath, { throwIfNoEntry: false })?.isFile()) {
        writeError('adapter_entry_not_found', `Adapter entry does not exist: ${entryPath}`)
        return
      }
      try {
        const report = await checkNodeAdapter({
          hostPath,
          entryPath,
          workDir: path.resolve(opts.workdir),
          modelId: opts.model,
          timeoutMs,
          nodeArgs: hostNodeArgs,
        })
        recordPassedCheck(entryPath, {
          name: report.name,
          version: report.version,
          workDir: path.resolve(opts.workdir),
          models: report.models,
          defaultModel: report.defaultModel,
        })
        writeSuccess('adapter.check', {
          stage: 'passed',
          name: report.name,
          version: report.version,
          models: report.models,
          defaultModel: report.defaultModel,
          modelId: report.modelId,
          systemPromptVerified: report.systemPromptVerified,
          resumeVerified: report.resumeVerified,
          maxCheckAttempts: ADAPTER_CHECK_MAX_ATTEMPTS,
        }, {
          type: 'register_adapter',
          entry: entryPath,
          command: 'shennian adapter add <stable-name> --entry <entry>',
          after: 'shennian agent discover --refresh',
        })
      } catch (error) {
        if (error instanceof AdapterCheckError) {
          writeStagedError(error.stage, error.code)
          return
        }
        writeError(
          'adapter_check_failed',
          'Adapter V1 check could not complete. Raw Runtime output was withheld because it may contain private machine data.',
          adapterCheckNextAction('start', 'adapter_check_failed'),
        )
      }
    })

  adapter
    .command('add <name>')
    .description('Register a local Node Adapter that already passed `adapter check` with an unchanged file')
    .requiredOption('--entry <file>', 'Path to adapter.mjs')
    .action((name: string, opts: { entry: string }) => {
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        writeError('invalid_adapter_name', 'Adapter name may contain only letters, numbers, hyphens, and underscores.')
        return
      }
      if (loadConfig().customAgents?.[name]) {
        writeError(
          'adapter_name_conflict',
          `A legacy custom runtime already uses the name "${name}". Choose a different stable name.`,
          { type: 'choose_adapter_name', rule: 'letters, numbers, hyphens and underscores only' },
        )
        return
      }
      const entryPath = path.resolve(opts.entry)
      if (!fs.statSync(entryPath, { throwIfNoEntry: false })?.isFile()) {
        writeError('adapter_entry_not_found', `Adapter entry does not exist: ${entryPath}`)
        return
      }
      const passed = getPassedCheck(entryPath)
      if (!passed) {
        writeError(
          'adapter_not_checked',
          'Run `shennian adapter check` on this exact file first; `add` only accepts an adapter whose passing check still matches the current file contents.',
        )
        return
      }
      const registration = registerNodeAdapter(name, entryPath, passed)
      writeSuccess('adapter.add', {
        adapterRef: `custom:${name}`,
        name: registration.name,
        version: registration.version,
        models: registration.models,
        defaultModel: registration.defaultModel,
      }, {
        type: 'refresh_discovery',
        command: 'shennian agent discover --refresh',
        expectedAgentRef: `custom:${name}`,
      })
    })

  adapter
    .command('list')
    .description('List official Adapters and locally registered Node Adapters')
    .action(() => {
      const official = OFFICIAL_ADAPTERS.map((info) => ({ kind: 'official' as const, id: info.id, name: info.name }))
      const local = Object.entries(listNodeAdapters()).map(([name, entry]) => ({
        kind: 'local' as const,
        id: `custom:${name}`,
        name: entry.name,
        version: entry.version,
        models: entry.models,
        defaultModel: entry.defaultModel,
        registeredAt: entry.registeredAt,
      }))
      writeSuccess('adapter.list', { adapters: [...official, ...local] })
    })

  adapter
    .command('show <adapter-id>')
    .description('Show an official Adapter\'s Markdown detail, or a local adapter\'s registration summary')
    .action((adapterId: string) => {
      const localName = adapterId.startsWith('custom:') ? adapterId.slice('custom:'.length) : adapterId
      const local = getNodeAdapter(localName)
      if (local) {
        writeSuccess('adapter.show', {
          kind: 'local',
          id: `custom:${localName}`,
          name: local.name,
          version: local.version,
          models: local.models,
          defaultModel: local.defaultModel,
          entryPath: local.entryPath,
          registeredAt: local.registeredAt,
          checkedAt: local.checkedAt,
        })
        return
      }
      const official = findOfficialAdapter(adapterId)
      if (!official) {
        writeError('adapter_not_found', `No official or local adapter named "${adapterId}" exists.`)
        return
      }
      const doc = readOfficialAdapterDoc(adapterId)
      if (!doc) {
        writeError('adapter_doc_missing', `Detail document for "${adapterId}" is not available in this build.`)
        return
      }
      writeSuccess('adapter.show', { kind: 'official', id: official.id, name: official.name, doc })
    })

  adapter
    .command('remove <name>')
    .description('Unregister a local Node adapter without deleting its source')
    .action((name: string) => {
      if (!removeNodeAdapter(name)) {
        writeError('adapter_not_found', `No local Node adapter named "${name}" exists.`)
        return
      }
      writeSuccess('adapter.remove', { adapterRef: `custom:${name}`, sourceDeleted: false })
    })

  adapter
    .command('submit <entry>')
    .description('Submit one checked adapter.mjs to Shennian for private official review')
    .requiredOption('--agent <name>', 'General upstream Agent that this implementation adapts')
    .option('--general-purpose', 'Confirm this is a reusable public Agent adapter, not private or project-specific')
    .option('--confirm-share', 'Confirm the user explicitly approved sharing this source with Shennian')
    .action(async (
      entry: string,
      opts: { agent: string; generalPurpose?: boolean; confirmShare?: boolean },
    ) => {
      if (!opts.generalPurpose) {
        writeError(
          'adapter_submission_not_general',
          'Private, organization-internal or project-specific adapters must not be submitted.',
          { type: 'stop', reason: 'Keep the Adapter local.' },
        )
        return
      }
      if (!opts.confirmShare) {
        writeError(
          'adapter_submission_consent_required',
          'Ask the user for explicit approval before sharing adapter.mjs with Shennian.',
          { type: 'ask_user', question: 'Submit this reusable adapter.mjs to Shennian for official review?' },
        )
        return
      }
      const entryPath = path.resolve(entry)
      if (
        path.basename(entryPath) !== ADAPTER_SUBMISSION_FILENAME ||
        !fs.statSync(entryPath, { throwIfNoEntry: false })?.isFile()
      ) {
        writeError(
          'adapter_submission_file_invalid',
          'Submission accepts exactly one text file named adapter.mjs.',
        )
        return
      }
      const passed = getPassedCheck(entryPath)
      if (!passed) {
        writeError(
          'adapter_not_checked',
          'Run `shennian adapter check` on this exact file first; submission requires the unchanged passing fingerprint.',
        )
        return
      }
      let content: string
      try {
        const bytes = fs.readFileSync(entryPath)
        content = bytes.toString('utf8')
        if (!Buffer.from(content, 'utf8').equals(bytes)) {
          writeError('adapter_submission_file_invalid', 'adapter.mjs must be valid UTF-8 text.')
          return
        }
      } catch {
        writeError('adapter_submission_file_invalid', 'adapter.mjs could not be read.')
        return
      }
      const scan = scanAdapterSubmissionSource(content)
      if (scan.byteSize === 0 || scan.byteSize > ADAPTER_SUBMISSION_MAX_BYTES) {
        writeError(
          'adapter_submission_size_invalid',
          `adapter.mjs must contain 1-${ADAPTER_SUBMISSION_MAX_BYTES} UTF-8 bytes.`,
        )
        return
      }
      if (!scan.ok) {
        writeError(
          'adapter_submission_sensitive_content',
          'Remove credentials, environment values, absolute paths and private business content before submission.',
          { type: 'generate_clean_single_file', issues: scan.issues },
        )
        return
      }
      const targetAgent = opts.agent.trim()
      if (!targetAgent || targetAgent.length > 191) {
        writeError('adapter_submission_agent_invalid', 'Agent name must contain 1-191 characters.')
        return
      }
      try {
        const response = await submissionClient.submit({
          filename: ADAPTER_SUBMISSION_FILENAME,
          content,
          sha256: passed.entrySha256,
          targetAgent,
          adapterName: passed.name,
          adapterVersion: passed.version,
          checkedAt: passed.checkedAt,
          models: passed.models,
          defaultModel: passed.defaultModel,
          clientVersion: options.clientVersion ?? 'unknown',
          platform: process.platform,
        })
        writeSuccess('adapter.submit', {
          submissionId: response.submissionId,
          status: response.status,
          sha256: passed.entrySha256,
          duplicate: response.duplicate === true,
          officialAdapterRegistered: false,
        })
      } catch (error) {
        if (error instanceof AdapterSubmissionClientError) {
          writeError(error.code, error.message)
          return
        }
        writeError(
          'adapter_submission_failed',
          'Adapter submission failed without exposing local source or credentials.',
        )
      }
    })
}

function resolveBundledHostPath(): string {
  return fileURLToPath(new URL('../../bin/shennian-adapter-host.js', import.meta.url))
}

function renderAdapterTemplate(name: string): string {
  return `/**
 * Shennian Adapter 协议 V1.
 * 独立安装的 Shennian Client 自带 Adapter Runtime，在自己的子进程里加载
 * 这个文件；不需要 npm install，也不需要理解 JSON Lines。
 *
 * 五个函数全部必需：listModels / start / send / stop / resume。
 */
export default {
  name: ${JSON.stringify(name.trim() || 'My Adapter')},
  version: '0.1.0',

  async listModels({ workDir }) {
    // 从当前上游 SDK / CLI / app-server 动态查询模型；每次真实调用，
    // 不要把某次探测结果写死进源码。
    void workDir
    return { models: [], defaultModel: '' }
  },

  async start({ sessionId, workDir, modelId, systemPrompt }) {
    // 在这里创建上游 SDK 客户端、app-server 连接或 CLI 会话。
    // systemPrompt 必须通过上游真实的 system / instructions 参数注入，
    // 禁止拼接进第一条用户消息。
    void sessionId; void workDir; void modelId; void systemPrompt
    throw new Error('Implement start() before checking this adapter.')
  },

  async send({ session, text, modelId, reasoningEffort, attachments, signal, output }) {
    // text 只是当前用户消息，不包含系统提示词。用 output.delta(...) 流式
    // 输出正文，最后必须调用 output.final() 或 output.error(...)。
    void session; void text; void modelId; void reasoningEffort
    void attachments; void signal
    output.error('Implement send() before checking this adapter.', 'send_failed')
  },

  async stop({ session, reason }) {
    // 中断当前上游请求并释放本地资源。
    void session; void reason
  },

  async resume({ sessionId, nativeSessionId, workDir, modelId, systemPrompt }) {
    // 必须恢复这个精确的 nativeSessionId，禁止恢复“最近一次”。
    void sessionId; void workDir; void modelId; void systemPrompt
    throw new Error(\`Implement resume() to restore native session \${nativeSessionId}.\`)
  },
}
`
}

function writeSuccess(command: string, result: unknown, nextAction?: unknown): void {
  process.stdout.write(`${JSON.stringify({ ok: true, command, result, ...(nextAction ? { nextAction } : {}) })}\n`)
}

function writeError(code: string, message: string, nextAction: unknown = null): void {
  process.stdout.write(`${JSON.stringify({ ok: false, error: code, message, nextAction })}\n`)
  process.exitCode = 1
}

function writeStagedError(stage: string, code: string): void {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    command: 'adapter.check',
    stage,
    error: code,
    message: safeCheckMessage(stage, code),
    nextAction: adapterCheckNextAction(stage, code),
  })}\n`)
  process.exitCode = 1
}

function safeCheckMessage(stage: string, code: string): string {
  if (code === 'adapter_contract_invalid') return 'The Adapter V1 module contract is incomplete or could not be loaded.'
  if (code === 'models_invalid') return 'Dynamic model discovery did not return a valid non-empty model list and default model.'
  if (code === 'system_prompt_unsupported') return 'The upstream did not prove that systemPrompt uses a real system/instructions channel.'
  if (code === 'stop_failed') return 'The Adapter did not stop the checked session cleanly.'
  if (code === 'resume_failed') return 'The Adapter did not resume the exact checked native session.'
  return `Adapter V1 check failed at the ${stage} stage (${code}).`
}

function adapterCheckNextAction(stage: string, code: string): Record<string, unknown> {
  const guidance: Record<string, string> = {
    contract: 'Keep one default-export object with non-empty name/version and all five required functions. Do not restore protocolVersion 2.',
    models: 'Query the installed upstream machine interface dynamically; return unique non-empty model ids and a defaultModel from that list.',
    start: 'Check only the upstream executable, version, login state and documented machine interface, then implement start with workDir, modelId and systemPrompt.',
    systemPrompt: 'Map systemPrompt to the upstream system/instructions parameter. Never concatenate it with the user message.',
    send: 'Send only the user text and attachments, forward output events, and produce exactly one terminal result.',
    stop: 'Abort the active upstream turn and release the process or connection before returning.',
    resume: 'Restore the exact nativeSessionId and the same systemPrompt; never select a recent or latest session.',
  }
  return {
    type: 'edit_and_retry',
    stage,
    error: code,
    guidance: guidance[stage] ?? 'Inspect the Adapter V1 implementation and retry the same check once.',
    command: 'Retry the same shennian adapter check command after editing adapter.mjs.',
    maxAttempts: ADAPTER_CHECK_MAX_ATTEMPTS,
    safety: 'Do not read, print or copy credentials, environment values, private project content or full provider logs.',
  }
}
