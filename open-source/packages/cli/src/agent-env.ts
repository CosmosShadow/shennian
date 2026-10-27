// @arch open-source/docs/cli-runtime.md
// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/agent-env.test.ts

import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import type { AgentType } from '@shennian/wire'
import { buildAugmentedPath } from './env-path.js'
import { buildWindowsSystemEnv, resolveWindowsPowerShellPath } from './windows-shell.js'

const SHELL_ENV_START = '__SHENNIAN_AGENT_ENV_START__'
const SHELL_ENV_END = '__SHENNIAN_AGENT_ENV_END__'

const POSIX_MANAGED_AGENT_ENV_KEYS = [
  'HOME',
  'USER',
  'LOGNAME',
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'TMP',
  'TEMP',
  'TZ',
] as const

const WINDOWS_MANAGED_AGENT_ENV_KEYS = [
  'SystemRoot',
  'WINDIR',
  'ComSpec',
  'PATHEXT',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'TEMP',
  'TMP',
  'TZ',
] as const

const MANAGED_AGENT_RUNTIME_ENV_KEYS = ['NO_COLOR', 'PI_CODING_AGENT_DIR'] as const

/**
 * Session-scoped Shennian capabilities that are intentionally available to a
 * managed Agent. Any new entry is a security boundary change and must have a
 * matching authorization test before being added here.
 */
export const MANAGED_AGENT_SESSION_ENV_KEYS = [
  'SHENNIAN_MANAGED_ROOM_CONTEXT',
  'SHENNIAN_MANAGED_ROOM_IPC_ROOT',
] as const

const MANAGED_AGENT_MANAGER_SESSION_ENV_KEYS = [
  'SHENNIAN_MANAGER_SESSION_ID',
  'SHENNIAN_MANAGER_AGENT_SESSION_ID',
  'SHENNIAN_MANAGER_WORKDIR',
  'SHENNIAN_MANAGER_MODEL',
  'SHENNIAN_MANAGER_IPC_URL',
  'SHENNIAN_MANAGER_IPC_TOKEN',
] as const

const MANAGED_AGENT_PROVIDER_ENV_KEYS: Partial<Record<AgentType, readonly string[]>> = {
  codex: ['OPENAI_BASE_URL', 'OPENAI_API_KEY'],
  claude: ['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY'],
  // Cursor Agent has no verified, invocation-scoped way to remove provider
  // credentials from Shell subprocesses. Managed Cursor therefore relies on
  // Cursor's native login store and receives no provider credential env vars.
  pi: ['DASHSCOPE_BASE_URL', 'DASHSCOPE_API_KEY'],
}

export function getManagedAgentProviderEnvKeys(agentType: AgentType): readonly string[] {
  return MANAGED_AGENT_PROVIDER_ENV_KEYS[agentType] ?? []
}

export function getManagedAgentSessionEnvKeys(agentType: AgentType): readonly string[] {
  return agentType === 'codex' || agentType === 'claude' || agentType === 'pi-coding-agent'
    ? [...MANAGED_AGENT_SESSION_ENV_KEYS, ...MANAGED_AGENT_MANAGER_SESSION_ENV_KEYS]
    : MANAGED_AGENT_SESSION_ENV_KEYS
}

export function getManagedAgentBaseEnvKeys(
  platform: NodeJS.Platform = process.platform,
): readonly string[] {
  return [
    'PATH',
    ...(platform === 'win32' ? WINDOWS_MANAGED_AGENT_ENV_KEYS : POSIX_MANAGED_AGENT_ENV_KEYS),
    ...MANAGED_AGENT_RUNTIME_ENV_KEYS,
  ]
}

export type ManagedAgentProcessEnvInput = {
  agentType: AgentType
  /** The daemon snapshot is read only for explicitly allowlisted OS values. */
  daemonEnv?: NodeJS.ProcessEnv
  /** Provider credentials already selected by Shennian's provider config. */
  providerEnv?: NodeJS.ProcessEnv
  /** Short-lived Room or Manager capabilities issued for this exact session. */
  sessionEnv?: NodeJS.ProcessEnv
  /** Harmless process behavior flags such as NO_COLOR. */
  runtimeEnv?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}

function quotePosix(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function parseEnvJson(stdout: string): NodeJS.ProcessEnv | null {
  const start = stdout.indexOf(SHELL_ENV_START)
  const end = stdout.indexOf(SHELL_ENV_END, start + SHELL_ENV_START.length)
  if (start === -1 || end === -1) return null
  const json = stdout.slice(start + SHELL_ENV_START.length, end)
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>
    const env: NodeJS.ProcessEnv = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') env[key] = value
    }
    return env
  } catch {
    return null
  }
}

function readPosixShellEnv(): NodeJS.ProcessEnv | null {
  const shell = process.env.SHELL?.trim() || '/bin/sh'
  const script = [
    `printf ${quotePosix(SHELL_ENV_START)}`,
    `${quotePosix(process.execPath)} -e ${quotePosix('process.stdout.write(JSON.stringify(process.env))')}`,
    `printf ${quotePosix(SHELL_ENV_END)}`,
  ].join('; ')

  for (const args of [
    ['-ilc', script],
    ['-lc', script],
  ]) {
    const result = spawnSync(shell, args, {
      env: process.env,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1500,
      windowsHide: true,
    })
    const parsed = typeof result.stdout === 'string' ? parseEnvJson(result.stdout) : null
    if (parsed) return parsed
  }

  return null
}

function readWindowsGlobalEnv(): NodeJS.ProcessEnv | null {
  const script = `
$envs = @{}
[Environment]::GetEnvironmentVariables('Machine').GetEnumerator() | ForEach-Object { $envs[$_.Key] = [string]$_.Value }
[Environment]::GetEnvironmentVariables('User').GetEnumerator() | ForEach-Object { $envs[$_.Key] = [string]$_.Value }
Write-Output '${SHELL_ENV_START}'
$envs | ConvertTo-Json -Compress
Write-Output '${SHELL_ENV_END}'
`
  const result = spawnSync(resolveWindowsPowerShellPath(), ['-NoProfile', '-Command', script], {
    env: {
      ...process.env,
      ...buildWindowsSystemEnv(process.env),
    },
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 1500,
    windowsHide: true,
  })
  return typeof result.stdout === 'string' ? parseEnvJson(result.stdout) : null
}

export function readLatestUserEnv(): NodeJS.ProcessEnv {
  const env = os.platform() === 'win32' ? readWindowsGlobalEnv() : readPosixShellEnv()
  return env ?? {}
}

export function mergeAgentProcessEnv(input: {
  daemonEnv: NodeJS.ProcessEnv
  userEnv: NodeJS.ProcessEnv
  extra?: NodeJS.ProcessEnv
}): NodeJS.ProcessEnv {
  const env = {
    ...input.daemonEnv,
    ...input.userEnv,
    ...input.extra,
  }
  if (process.platform === 'win32') Object.assign(env, buildWindowsSystemEnv(env))
  env.PATH = mergePathEnv(input.daemonEnv, input.userEnv, input.extra, env)
  delete env.Path
  delete env.path
  return env
}

export function buildAgentProcessEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = mergeAgentProcessEnv({
    daemonEnv: process.env,
    userEnv: readLatestUserEnv(),
    extra,
  })
  // Only an explicit per-session grant (the steward) may carry this; strip any stale
  // value inherited from a login shell or the daemon's own environment otherwise.
  if (!extra.SHENNIAN_SCHEDULE_CONTEXT) delete env.SHENNIAN_SCHEDULE_CONTEXT
  prepareDesktopAgentEnvironment(env)
  return env
}

/**
 * Reuses the ordinary Agent environment while keeping daemon/account secrets
 * out of an automatically activated managed Room process. Only the explicit,
 * short-lived Room and Manager capabilities may cross this boundary.
 */
export function buildManagedNativeFullProcessEnv(
  extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const env = buildAgentProcessEnv(extra)
  const allowed = new Set<string>([
    ...MANAGED_AGENT_SESSION_ENV_KEYS,
    ...MANAGED_AGENT_MANAGER_SESSION_ENV_KEYS,
  ])
  for (const key of Object.keys(env)) {
    if (key.startsWith('SHENNIAN_') && !allowed.has(key)) delete env[key]
  }
  return env
}

/**
 * Builds the environment for an automatically activated managed Agent.
 *
 * Unlike buildAgentProcessEnv(), this function never starts a login shell and
 * never merges the daemon environment wholesale. Provider and Shennian
 * capability values must be supplied in their dedicated buckets; unexpected
 * keys are dropped instead of silently broadening the child's authority.
 */
export function buildManagedAgentProcessEnv(input: ManagedAgentProcessEnvInput): NodeJS.ProcessEnv {
  const daemonEnv = input.daemonEnv ?? process.env
  const platform = input.platform ?? process.platform
  const env: NodeJS.ProcessEnv = {}

  copyAllowlistedEnv(
    env,
    daemonEnv,
    platform === 'win32' ? WINDOWS_MANAGED_AGENT_ENV_KEYS : POSIX_MANAGED_AGENT_ENV_KEYS,
    platform,
  )
  copyAllowlistedEnv(
    env,
    input.providerEnv,
    getManagedAgentProviderEnvKeys(input.agentType),
    platform,
  )
  copyAllowlistedEnv(
    env,
    input.sessionEnv,
    getManagedAgentSessionEnvKeys(input.agentType),
    platform,
  )
  copyAllowlistedEnv(env, input.runtimeEnv, MANAGED_AGENT_RUNTIME_ENV_KEYS, platform)

  if (platform === 'win32') {
    Object.assign(env, buildWindowsSystemEnv({ ...daemonEnv, ...env }))
  }

  env.PATH = buildManagedAgentPath(daemonEnv, env, platform)
  prepareDesktopAgentEnvironment(env)
  delete env.Path
  delete env.path
  return env
}

function prepareDesktopAgentEnvironment(env: NodeJS.ProcessEnv): void {
  // Electron flags belong to the CLI launcher, not to third-party Electron hosts.
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_NO_ASAR
  delete env.SHENNIAN_DESKTOP_CLI_SCRIPT
  delete env.SHENNIAN_DESKTOP_CLI_BRIDGE
  delete env.SHENNIAN_DESKTOP_CLI_COMMAND
}

function copyAllowlistedEnv(
  destination: NodeJS.ProcessEnv,
  source: NodeJS.ProcessEnv | undefined,
  allowedKeys: readonly string[],
  platform: NodeJS.Platform,
): void {
  if (!source) return
  const sourceEntries = Object.entries(source)
  for (const allowedKey of allowedKeys) {
    const match =
      platform === 'win32'
        ? sourceEntries.find(([key]) => key.toUpperCase() === allowedKey.toUpperCase())
        : sourceEntries.find(([key]) => key === allowedKey)
    const value = match?.[1]
    if (typeof value === 'string' && value.length > 0) destination[allowedKey] = value
  }
}

function buildManagedAgentPath(
  daemonEnv: NodeJS.ProcessEnv,
  filteredEnv: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string {
  const delimiter = platform === 'win32' ? path.win32.delimiter : path.posix.delimiter
  const parts: string[] = []
  const append = (value: string | undefined, front = false) => {
    if (!value) return
    for (const part of value.split(delimiter)) {
      if (!part || parts.includes(part)) continue
      if (front) parts.unshift(part)
      else parts.push(part)
    }
  }

  append(readPathValue(daemonEnv))
  append(path.dirname(process.execPath), true)

  if (platform === 'win32') {
    const system = buildWindowsSystemEnv({ ...daemonEnv, ...filteredEnv })
    const systemRoot = system.SystemRoot ?? system.WINDIR ?? 'C:\\Windows'
    append(path.win32.join(systemRoot, 'System32'))
    append(path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0'))
    append(systemRoot)
  } else {
    append('/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin')
  }

  return parts.join(delimiter)
}

function readPathValue(env: NodeJS.ProcessEnv | undefined): string | undefined {
  return env?.PATH ?? env?.Path ?? env?.path
}

function mergePathEnv(
  daemonEnv: NodeJS.ProcessEnv,
  userEnv: NodeJS.ProcessEnv,
  extra: NodeJS.ProcessEnv | undefined,
  mergedEnv: NodeJS.ProcessEnv,
): string {
  const parts: string[] = []
  for (const value of [readPathValue(daemonEnv), readPathValue(userEnv), readPathValue(extra)]) {
    for (const part of (value ?? '').split(path.delimiter)) {
      if (part && !parts.includes(part)) parts.push(part)
    }
  }

  if (process.platform === 'win32') {
    const systemRoot =
      mergedEnv.SystemRoot ||
      mergedEnv.WINDIR ||
      process.env.SystemRoot ||
      process.env.WINDIR ||
      'C:\\Windows'
    for (const candidate of [
      path.win32.join(systemRoot, 'System32'),
      path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0'),
      path.win32.join(systemRoot),
    ]) {
      if (candidate && !parts.includes(candidate)) parts.push(candidate)
    }
  }

  const nodeDir = path.dirname(process.execPath)
  if (nodeDir && !parts.includes(nodeDir)) parts.unshift(nodeDir)

  return buildAugmentedPath({
    pathValue: parts.join(path.delimiter),
    env: mergedEnv,
  })
}
