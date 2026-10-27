// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/setup-command.test.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import chalk from 'chalk'
import type { Command } from 'commander'
import { loadConfig, resolveShennianPath, saveConfig } from '../config/index.js'
import { regionToUrl } from '../region.js'
import { detectAgents, type DetectedAgent } from '../agents/detect.js'
import { getUnavailableAcpAgents, type UnavailableAcpAgent } from '../agents/acp/discovery.js'
import { findOfficialAdapter } from '../adapter-kit/official-adapters.js'
import { installSkillForHosts, type SkillHostInstallResult } from '../skill/hosts.js'
import { getCurrentVersion } from '../upgrade/engine.js'
import {
  BrowserPairError,
  createBrowserPairIntent,
  openExternalUrl,
  waitForBrowserPairIntent,
  type BrowserPairIntent,
  type BrowserPairResult,
} from './pair-browser.js'
import { ensureDaemonStarted } from './daemon.js'
import { ensureStewardWorkspace } from '../steward/workspace.js'

/**
 * `shennian setup` is the single install entry for people and their AI. Every step is
 * idempotent: run it again at any time and it skips what is done. Pairing is the only
 * step that needs the person; when it is still waiting, setup exits with
 * `waiting_for_approval` and the link, and the next run resumes the same request.
 */

export const APP_DOWNLOAD_URL = 'https://shennian.net/#download'
const PENDING_PAIR_FILE = 'pending-pair.json'
/** Leave enough time for the person to open the link after a resumed run. */
const PENDING_MIN_REMAINING_MS = 60_000
const INTERACTIVE_WAIT_SECONDS = 600
/** Short enough to return inside common AI-host command timeouts. */
const NON_INTERACTIVE_WAIT_SECONDS = 25

export type SetupStepName = 'client' | 'workspace' | 'skill' | 'agents' | 'pair' | 'service'
export type SetupStepStatus = 'ok' | 'waiting' | 'attention' | 'failed'

export type SetupEvent =
  | { type: 'step'; step: SetupStepName; status: SetupStepStatus; message: string; [key: string]: unknown }
  | {
    type: 'done'
    status: 'ready' | 'waiting_for_approval' | 'needs_attention' | 'failed'
    message: string
    nextAction: string
    pairUrl?: string
  }

type AgentSummary = { type: string; name: string; state: 'ready' | 'login_required' }

export type SetupDeps = {
  clientVersion: () => string
  detectAgents: () => Promise<DetectedAgent[]>
  unavailableAgents: () => UnavailableAcpAgent[]
  installSkills: () => Promise<SkillHostInstallResult[]>
  createIntent: typeof createBrowserPairIntent
  waitForIntent: typeof waitForBrowserPairIntent
  openUrl: (url: string) => Promise<boolean>
  ensureDaemon: typeof ensureDaemonStarted
  now: () => number
}

const defaultDeps: SetupDeps = {
  clientVersion: getCurrentVersion,
  detectAgents: () => detectAgents(),
  unavailableAgents: getUnavailableAcpAgents,
  installSkills: () => installSkillForHosts({ clientVersion: getCurrentVersion() }),
  createIntent: createBrowserPairIntent,
  waitForIntent: waitForBrowserPairIntent,
  openUrl: openExternalUrl,
  ensureDaemon: ensureDaemonStarted,
  now: Date.now,
}

export async function runSetup(options: {
  server?: string
  name?: string
  waitSeconds?: number
  interactive: boolean
  emit: (event: SetupEvent) => void
  deps?: Partial<SetupDeps>
}): Promise<SetupEvent & { type: 'done' }> {
  const deps = { ...defaultDeps, ...options.deps }
  const emit = options.emit
  const finish = (event: Omit<SetupEvent & { type: 'done' }, 'type'>) => {
    const done = { type: 'done' as const, ...event }
    emit(done)
    return done
  }

  emit({
    type: 'step', step: 'client', status: 'ok',
    message: `神念 Client ${deps.clientVersion()} 已安装`,
    version: deps.clientVersion(),
  })

  try {
    const workspace = ensureStewardWorkspace()
    emit({ type: 'step', step: 'workspace', status: 'ok', message: '主 Agent 目录已准备好', workspace: workspace.dir, created: workspace.created })
  } catch {
    emit({ type: 'step', step: 'workspace', status: 'failed', message: '主 Agent 目录无法初始化' })
    return finish({ status: 'failed', message: '主 Agent 目录未准备好，安装尚未完成。', nextAction: '检查主 Agent 目录的访问权限；可用 shennian steward configure --workspace <绝对目录> 选择独立目录后重试 setup。' })
  }

  // Skill first: it needs no account, so the person's AI can use Shennian as soon as pairing ends.
  const skills = await deps.installSkills().catch(() => [] as SkillHostInstallResult[])
  emit(skillStep(skills))

  const agents = await deps.detectAgents().catch(() => [] as DetectedAgent[])
  const agentSummary = summarizeAgents(agents)
  const unavailable = deps.unavailableAgents()
  emit(agentStep(agentSummary, unavailable))

  const config = loadConfig()
  let justPaired = false
  if (config.machineToken && config.machineId) {
    emit({ type: 'step', step: 'pair', status: 'ok', message: '这台电脑已连接到你的神念账号' })
  } else {
    const serverUrl = (options.server ?? config.serverUrl ?? regionToUrl('cn')).replace(/\/+$/, '')
    let pairing: Awaited<ReturnType<typeof pairOnce>>
    try {
      pairing = await pairOnce({
        serverUrl,
        machineName: options.name ?? os.hostname(),
        agentList: agents.map((agent) => agent.type),
        waitSeconds: options.waitSeconds
          ?? (options.interactive ? INTERACTIVE_WAIT_SECONDS : NON_INTERACTIVE_WAIT_SECONDS),
        emit,
        deps,
      })
    } catch (error) {
      const code = error instanceof BrowserPairError ? error.code : 'PAIR_FAILED'
      emit({ type: 'step', step: 'pair', status: 'failed', message: pairFailureMessage(code), error: code })
      return finish({
        status: 'failed',
        message: pairFailureMessage(code),
        nextAction: code === 'PAIR_DENIED' || code === 'PAIR_TIMEOUT' || code === 'PAIR_EXPIRED'
          ? '再次运行 shennian setup 会生成新的确认链接。'
          : '检查网络后再次运行 shennian setup；仍失败请运行 shennian support ask 联系神念客服。',
      })
    }
    if (!pairing.result) {
      return finish({
        status: 'waiting_for_approval',
        pairUrl: pairing.url,
        message: `请打开这个链接，用手机号和验证码确认这台电脑：${pairing.url}`,
        nextAction: '把链接发给用户，等用户说已确认后再次运行 shennian setup；链接有效期内会继续同一个请求。',
      })
    }
    saveConfig({
      ...loadConfig(),
      machineToken: pairing.result.machineToken,
      machineId: pairing.result.machineId,
      accountNamespaceId: pairing.result.accountNamespaceId,
      serverUrl,
    })
    justPaired = true
    emit({ type: 'step', step: 'pair', status: 'ok', message: '已连接到你的神念账号' })
  }

  let serviceStatus: 'running' | 'started' | 'paused'
  try {
    serviceStatus = deps.ensureDaemon({ resumePaused: justPaired }).status
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    emit({ type: 'step', step: 'service', status: 'failed', message: '后台服务没有启动', error: reason })
    return finish({
      status: 'failed',
      message: '后台服务没有启动，手机暂时连不上这台电脑。',
      nextAction: '运行 shennian logs -n 100 查看原因；仍无法解决请运行 shennian support ask 联系神念客服。',
    })
  }
  if (serviceStatus === 'paused') {
    emit({ type: 'step', step: 'service', status: 'attention', message: '后台服务已被暂停（你之前主动暂停过）' })
  } else {
    emit({ type: 'step', step: 'service', status: 'ok', message: '后台服务正在运行，开机后会自动启动' })
  }

  const readyAgents = agentSummary.filter((agent) => agent.state === 'ready')
  const unavailableHint = unavailable.length
    ? ` 另外，${unavailable.map((item) => item.name).join('、')} 已安装但还没接上：询问用户是否要接入，同意后按 Shennian Skill 的“接入 AI”流程处理。`
    : ''
  if (serviceStatus === 'paused') {
    return finish({
      status: 'needs_attention',
      message: '安装已完成，但后台服务处于暂停状态。',
      nextAction: '询问用户是否恢复；用户同意后运行 shennian start。',
    })
  }
  if (readyAgents.length === 0) {
    return finish({
      status: 'needs_attention',
      message: agentSummary.length === 0
        ? '神念已装好，但这台电脑上还没有找到可用的 AI 工具。'
        : '神念已装好，找到的 AI 工具还需要先登录。',
      nextAction: (agentSummary.length === 0
        ? '询问用户想用哪个 AI（例如 Codex、Claude Code、Qwen Code、Kimi CLI、WorkBuddy），按它的官方方式安装并登录后再次运行 shennian setup；若用户已装了未列出的 AI，按 Shennian Skill 的“接入 AI”流程适配。'
        : `请用户按各自官方方式登录：${agentSummary.map((agent) => agent.name).join('、')}，然后再次运行 shennian setup。`)
        + unavailableHint,
    })
  }
  return finish({
    status: 'ready',
    message: `神念已就绪，可以使用：${readyAgents.map((agent) => agent.name).join('、')}。`,
    nextAction: `告诉用户：在手机上下载神念 App（${APP_DOWNLOAD_URL}）用同一个手机号登录，就能看到这台电脑并和这些 AI 对话；也可以直接在电脑上的 AI 里说“用神念……”。如果用户还有其他装了但没列出来的 AI，询问是否要接入。${unavailableHint}`,
  })
}

async function pairOnce(input: {
  serverUrl: string
  machineName: string
  agentList: string[]
  waitSeconds: number
  emit: (event: SetupEvent) => void
  deps: SetupDeps
}): Promise<{ url: string; result: BrowserPairResult | null }> {
  const { deps } = input
  let intent = readPendingPair(input.serverUrl, deps.now())
  const resumed = intent !== null
  if (!intent) {
    intent = await deps.createIntent({
      serverUrl: input.serverUrl,
      machineName: input.machineName,
      machineOs: osName(),
      agentList: input.agentList,
    })
    writePendingPair(intent)
  }
  input.emit({
    type: 'step', step: 'pair', status: 'waiting',
    message: `请用手机或电脑浏览器打开链接，输入手机号和验证码确认这台电脑：${intent.url}`,
    url: intent.url,
    expiresAt: intent.expiresAt,
    resumed,
  })
  // Open once per request; a resumed run must not keep spawning browser tabs.
  if (!resumed) await deps.openUrl(intent.url).catch(() => false)
  try {
    const result = await deps.waitForIntent(intent, {
      deadline: deps.now() + Math.max(0, input.waitSeconds) * 1000,
    })
    if (result) clearPendingPair()
    return { url: intent.url, result }
  } catch (error) {
    clearPendingPair()
    throw error
  }
}

function pendingPairPath(): string {
  return resolveShennianPath(PENDING_PAIR_FILE)
}

export function readPendingPair(serverUrl: string, now: number): BrowserPairIntent | null {
  try {
    const value = JSON.parse(fs.readFileSync(pendingPairPath(), 'utf8')) as Partial<BrowserPairIntent>
    if (
      value.serverUrl !== serverUrl ||
      typeof value.intentId !== 'string' || typeof value.url !== 'string' ||
      typeof value.expiresAt !== 'string' || typeof value.deviceSecret !== 'string' ||
      typeof value.actionPayloadHash !== 'string' || typeof value.machineName !== 'string'
    ) return null
    if (new Date(value.expiresAt).getTime() - now < PENDING_MIN_REMAINING_MS) return null
    return value as BrowserPairIntent
  } catch {
    return null
  }
}

function writePendingPair(intent: BrowserPairIntent): void {
  const filePath = pendingPairPath()
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
  const temporary = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(intent), { mode: 0o600 })
  fs.renameSync(temporary, filePath)
}

function clearPendingPair(): void {
  try { fs.unlinkSync(pendingPairPath()) } catch { /* already gone */ }
}

function osName(): string {
  const platform = os.platform()
  return platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : 'linux'
}

export function summarizeAgents(agents: DetectedAgent[]): AgentSummary[] {
  return agents.map((agent) => ({
    type: agent.type,
    name: agentName(agent),
    state: agent.authState === 'required' ? 'login_required' as const : 'ready' as const,
  }))
}

function agentName(agent: DetectedAgent): string {
  if (agent.display?.name) return agent.display.name
  if (agent.type.startsWith('custom:')) return agent.type.slice('custom:'.length)
  if (agent.type === 'gemini') return 'Gemini CLI'
  return findOfficialAdapter(agent.type)?.name ?? agent.type
}

const UNAVAILABLE_REASONS: Record<string, string> = {
  timeout: '启动超时',
  launch: '无法启动',
  version: '协议版本不兼容',
  invalid_protocol: '没有按 ACP 协议响应',
  output_limit: '输出异常',
}

function agentStep(agents: AgentSummary[], unavailable: UnavailableAcpAgent[]): SetupEvent {
  const ready = agents.filter((agent) => agent.state === 'ready').map((agent) => agent.name)
  const login = agents.filter((agent) => agent.state === 'login_required').map((agent) => agent.name)
  const broken = unavailable.map((item) => `${item.name}（${UNAVAILABLE_REASONS[item.reason] ?? '连接失败'}）`)
  const parts = [
    ready.length ? `可以使用：${ready.join('、')}` : '',
    login.length ? `需要先登录：${login.join('、')}` : '',
    broken.length ? `已安装但还没接上：${broken.join('、')}` : '',
  ].filter(Boolean)
  return {
    type: 'step', step: 'agents', status: ready.length && !broken.length ? 'ok' : 'attention',
    message: parts.length ? `找到本机 AI。${parts.join('；')}` : '没有找到可用的 AI 工具',
    agents,
    unavailable: unavailable.map((item) => ({
      type: item.type, name: item.name, command: [item.command, ...item.args].join(' '), reason: item.reason,
    })),
  }
}

function skillStep(results: SkillHostInstallResult[]): SetupEvent {
  const installed = results.filter((item) => item.ok && ['installed', 'updated', 'current', 'registered'].includes(item.result.status))
  const skipped = results.filter((item) => !installed.includes(item))
  const hosts = results.map((item) => ({
    id: item.id,
    names: item.names,
    path: item.path,
    status: item.ok ? item.result.status : 'failed',
    ...(item.ok ? {} : { error: item.error }),
  }))
  if (results.length === 0) {
    return {
      type: 'step', step: 'skill', status: 'attention', hosts,
      message: '没有找到需要安装神念 Skill 的 AI 工具；装好 AI 后再次运行 shennian setup',
    }
  }
  const names = installed.flatMap((item) => item.names)
  return {
    type: 'step', step: 'skill', status: skipped.length ? 'attention' : 'ok', hosts,
    message: [
      names.length ? `已为 ${names.join('、')} 装好神念 Skill（正在运行的 AI 需要新开一个对话才会生效）` : '',
      skipped.length ? `${skipped.flatMap((item) => item.names).join('、')} 的 Skill 未更新（本地文件被改过或下载失败），不影响使用` : '',
    ].filter(Boolean).join('；'),
  }
}

function pairFailureMessage(code: string): string {
  switch (code) {
    case 'PAIR_DENIED': return '确认请求被拒绝了。'
    case 'PAIR_TIMEOUT':
    case 'PAIR_EXPIRED': return '确认链接已过期。'
    case 'PAIR_ALREADY_CLAIMED': return '这个确认请求已经被使用过。'
    default: return '暂时无法连接神念服务器。'
  }
}

const STATUS_MARK: Record<SetupStepStatus, string> = {
  ok: chalk.green('✓'),
  waiting: chalk.cyan('…'),
  attention: chalk.yellow('!'),
  failed: chalk.red('✗'),
}

function printHuman(event: SetupEvent): void {
  if (event.type === 'step') {
    console.log(`${STATUS_MARK[event.status]} ${event.message}`)
    if (event.step === 'pair' && event.status === 'waiting') console.log(chalk.gray('  等待确认…（Ctrl+C 可随时退出，稍后再运行 shennian setup 会继续）'))
    return
  }
  console.log()
  const color = event.status === 'ready' ? chalk.green : event.status === 'failed' ? chalk.red : chalk.yellow
  console.log(color(event.message))
  if (event.status === 'ready') {
    console.log(`  在手机上下载神念 App：${APP_DOWNLOAD_URL}，用同一个手机号登录即可。`)
    console.log('  也可以直接在电脑上的 AI 里说：“用神念……”')
  } else if (event.status === 'waiting_for_approval') {
    console.log('  确认后再次运行：shennian setup')
  } else {
    console.log(`  ${event.nextAction}`)
  }
}

export function registerSetupCommand(program: Command): void {
  program
    .command('setup')
    .description('Install and connect Shennian in one step: Skill, AI discovery, pairing link and background service. Safe to run again.')
    .option('--json', 'Emit JSONL events; the last line is {"type":"done",...}')
    .option('--wait <seconds>', 'How long to wait for pairing approval before returning waiting_for_approval')
    .option('--server <url>', 'Server URL override')
    .option('--name <name>', 'Machine name', os.hostname())
    .action(async (opts: { json?: boolean; wait?: string; server?: string; name: string }) => {
      const json = Boolean(opts.json)
      const waitSeconds = opts.wait === undefined ? undefined : Number(opts.wait)
      if (waitSeconds !== undefined && (!Number.isFinite(waitSeconds) || waitSeconds < 0)) {
        console.error('--wait must be a non-negative number of seconds')
        process.exitCode = 1
        return
      }
      if (!json) console.log(chalk.bold('\n神念安装\n'))
      const done = await runSetup({
        server: opts.server,
        name: opts.name,
        waitSeconds,
        interactive: !json && Boolean(process.stdin.isTTY && process.stdout.isTTY),
        emit: json ? (event) => process.stdout.write(`${JSON.stringify(event)}\n`) : printHuman,
      })
      process.exitCode = done.status === 'failed' ? 1 : done.status === 'waiting_for_approval' ? 2 : 0
    })
}
