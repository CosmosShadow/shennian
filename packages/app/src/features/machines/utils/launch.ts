// @arch docs/architecture/app/modular-features.md#机器-feature
// @test src/__tests__/machine-feature-utils.test.ts

import { AGENT_DISPLAY_NAME, getAgentDisplayName } from '@shennian/shared'
import { AVAILABLE_BUILTIN_AGENT_TYPES, type AgentType } from '@shennian/wire'

export type VersionChangeType = 'patch' | 'minor' | 'major'
export type VersionChange = 'none' | VersionChangeType
export type InstallableBuiltinAgentType = Exclude<
  (typeof AVAILABLE_BUILTIN_AGENT_TYPES)[number],
  'pi' | 'shennian'
>

export const MIN_RELAY_UPLOAD_CLI_VERSION = '0.2.75'

const INSTALLABLE_AGENT_TYPES = AVAILABLE_BUILTIN_AGENT_TYPES.filter(
  (agent): agent is InstallableBuiltinAgentType => agent !== 'pi' && agent !== 'shennian',
)
const INSTALLABLE_AGENT_TYPE_SET = new Set<InstallableBuiltinAgentType>(INSTALLABLE_AGENT_TYPES)

export function isInstallableBuiltinAgentType(agent: string): agent is InstallableBuiltinAgentType {
  return INSTALLABLE_AGENT_TYPE_SET.has(agent as InstallableBuiltinAgentType)
}

let latestCliVersionCache: string | null = null
let latestCliVersionRequest: Promise<string> | null = null

function getDesktopCliVersionLookup():
  | (() => Promise<{ ok: true; value: { version: string } } | { ok: false }>)
  | null {
  if (typeof window === 'undefined') return null
  const desktopWindow = window as Window & {
    shennianDesktop?: {
      app?: {
        getLatestCliVersion?: () => Promise<
          { ok: true; value: { version: string } } | { ok: false }
        >
      }
    }
  }
  return desktopWindow.shennianDesktop?.app?.getLatestCliVersion ?? null
}

export function getAgentLaunchLabel(agent: AgentType): string {
  return getAgentDisplayName(agent)
}

export function getDirLabel(workDir: string, homeLabel: string): string {
  return workDir === '~' ? homeLabel : workDir.replace(/^.*\//, '') || workDir
}

export function getMachineOsLabel(os: string): string {
  const normalized = os.trim().toLowerCase()
  if (normalized === 'macos' || normalized === 'darwin') return 'macOS'
  if (normalized === 'windows' || normalized === 'win32') return 'Windows'
  if (normalized === 'linux') return 'Linux'
  return os.trim() || 'Unknown OS'
}

export function getInstallableBuiltinAgents(
  installedAgents: readonly string[],
): InstallableBuiltinAgentType[] {
  const installed = new Set(installedAgents)
  return INSTALLABLE_AGENT_TYPES.filter((agent) => !installed.has(agent))
}

export function resolveInitialLaunchAgent(input: {
  agentList: AgentType[]
  initialAgentType?: AgentType
  lastAgentType?: AgentType | null
}): AgentType {
  if (input.initialAgentType && input.agentList.includes(input.initialAgentType)) {
    return input.initialAgentType
  }
  if (input.lastAgentType && input.agentList.includes(input.lastAgentType))
    return input.lastAgentType
  return input.agentList.find((agent) => agent !== 'pi') ?? 'codex'
}

export function buildAgentInstallPrompt(agent: InstallableBuiltinAgentType): string {
  const agentName = AGENT_DISPLAY_NAME[agent] ?? agent
  const command = getAgentCommand(agent)
  const piRequirements =
    agent === 'pi-coding-agent'
      ? [
          '2. 先确认实际用于启动 Pi 的 Node.js >= 22.19.0；版本不足时只升级用户级运行时，不破坏其他项目。',
          '3. 使用官方包 `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`，不要改当前项目依赖。',
        ]
      : [
          '2. 如果未安装，使用当前系统上最稳妥的官方方式完成安装，并处理 PATH、依赖、登录或首次初始化。',
        ]

  return [
    `请帮我在当前这台机器上安装 ${agentName} CLI，并直接执行安装，不要只给教程。`,
    '',
    '要求：',
    `1. 先检查 \`${command}\` 是否已经可用；如果已经安装，直接告诉我检测结果。`,
    ...piRequirements,
    `${agent === 'pi-coding-agent' ? 4 : 3}. 安装完成后验证 \`${command}\` 可以正常运行，并把版本号或验证结果告诉我。`,
    `${agent === 'pi-coding-agent' ? 5 : 4}. 全程用简短步骤汇报你正在做什么，让我能看懂整个安装过程。`,
    `${agent === 'pi-coding-agent' ? 6 : 5}. 结束前提醒我回到机器列表刷新 Agent 列表。`,
    buildReplyCheckInstallHint(),
  ].join('\n')
}

export function buildCatalogAgentInstallPrompt(input: { name: string; website?: string }): string {
  const source = input.website
    ? `官方页面：${input.website}`
    : '请从该 Agent 的官方渠道查找安装说明。'
  return [
    `请帮我在当前这台机器上安装 ${input.name}，并直接执行安装，不要只给教程。`,
    '',
    '要求：',
    `1. ${source}`,
    '2. 只使用官方发布渠道，确认系统与运行时要求后完成安装、登录或首次初始化。',
    '3. 安装完成后验证 Agent 可以正常启动，并把版本号或验证结果告诉我。',
    '4. 全程用简短步骤汇报你正在做什么，让我能看懂整个安装过程。',
    '5. 结束前提醒我回到神念的机器详情刷新 Agent 列表。',
    buildReplyCheckInstallHint(),
  ].join('\n')
}

function buildReplyCheckInstallHint(): string {
  return '接入验证：复用现有神念，执行 shennian agent discover，以返回的工具类型和模型为准；登录由我本人完成。确认我选择的项目绝对路径后，用 shennian agent check <工具类型> --workdir "项目绝对路径" 发送一次可用性测试，会使用我的模型额度。仅 ready=true 表示这次回复通过；失败给出原因与下一步，不反复发送。旧版不支持时按原来源升级或回神念测试，不安装第二份 Client，不创建群/智能体，不恢复主动暂停或停止已有任务。'
}

function getAgentCommand(agent: InstallableBuiltinAgentType): string {
  switch (agent) {
    case 'claude':
      return 'claude'
    case 'codex':
      return 'codex'
    case 'workbuddy':
      return 'codebuddy'
    // Gemini CLI is not installable from the product while support is dormant.
    // case 'gemini':
    //   return 'gemini'
    case 'cursor':
      return 'agent'
    case 'opencode':
      return 'opencode'
    case 'pi-coding-agent':
      return 'pi'
  }
}

export async function fetchLatestCliVersion(options: { force?: boolean } = {}): Promise<string> {
  if (!options.force && latestCliVersionCache) return latestCliVersionCache
  if (options.force) latestCliVersionRequest = null

  if (!latestCliVersionRequest) {
    const desktopLookup = getDesktopCliVersionLookup()
    latestCliVersionRequest = (desktopLookup
      ? desktopLookup().then((result) => {
          if (!result.ok) throw new Error('Desktop CLI release lookup failed')
          return result.value.version
        })
      : fetch(
          'https://registry.npmjs.org/shennian/latest',
          options.force ? { cache: 'no-store' } : undefined,
        ).then(async (response) => {
          const payload = (await response.json()) as { version: string }
          return payload.version
        }))
      .then((version) => {
        latestCliVersionCache = version
        return version
      })
      .catch((error) => {
        latestCliVersionRequest = null
        throw error
      })
  }

  return latestCliVersionRequest
}

export function compareVersions(current: string, latest: string): VersionChange {
  const currentParts = parseSemver(current)
  const latestParts = parseSemver(latest)
  if (!currentParts || !latestParts) return 'none'
  const [currentMajor, currentMinor, currentPatch] = currentParts
  const [latestMajor, latestMinor, latestPatch] = latestParts

  if (latestMajor > currentMajor) return 'major'
  if (latestMajor === currentMajor && latestMinor > currentMinor) return 'minor'
  if (latestMajor === currentMajor && latestMinor === currentMinor && latestPatch > currentPatch) {
    return 'patch'
  }
  return 'none'
}

function parseSemver(value: string | null | undefined): [number, number, number] | null {
  if (!value) return null
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  if (!match) return null
  return [
    Number.parseInt(match[1], 10),
    Number.parseInt(match[2], 10),
    Number.parseInt(match[3], 10),
  ]
}

function compareSemver(a: [number, number, number], b: [number, number, number]): number {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return 0
}

export function isMachineCliVersionBlocked(
  version: string | null | undefined,
  minVersion = MIN_RELAY_UPLOAD_CLI_VERSION,
): boolean {
  if (version == null || version.trim() === '') return false
  const parsedVersion = parseSemver(version)
  const parsedMinVersion = parseSemver(minVersion)
  if (!parsedVersion || !parsedMinVersion) return true
  return compareSemver(parsedVersion, parsedMinVersion) < 0
}
