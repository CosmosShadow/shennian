// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/daemon-autostart.test.ts
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { resolveShennianPath } from '../config/index.js'
import { buildAugmentedPath } from '../env-path.js'
import { getPlatform, SHENNIAN_DIR } from './daemon-state.js'

const SAFE_SNAPSHOT_ENV_KEYS = new Set([
  'PATH',
  'SHENNIAN_CODEX_PATH',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'USERNAME',
  'USERDOMAIN',
  'COMPUTERNAME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'SSH_AUTH_SOCK',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'TEMP',
  'TMP',
  'APPDATA',
  'LOCALAPPDATA',
  'SHENNIAN_DESKTOP_SERVER_URL',
  'SHENNIAN_WECHAT_CHANNEL_HELPER_DIR',
  'SHENNIAN_HOME',
  'SHENNIAN_ACCOUNT_NAMESPACE_ID',
  'SHENNIAN_NATIVE_FUSION_DISABLED',
  'SHENNIAN_WECHAT_DELIVERABILITY_TRACE',
])

export function isSafeSnapshotEnvKey(key: string): boolean {
  return SAFE_SNAPSHOT_ENV_KEYS.has(key)
}

type ServiceLaunchMode = 'direct' | 'global-shim' | 'npx'
export type ServiceLaunchSpec = {
  command: string
  args: string[]
  mode: ServiceLaunchMode
}

export type DetachedLaunchSpec = {
  command: string
  args: string[]
  windowsVerbatimArguments?: boolean
}

export function isEphemeralCliPath(candidate: string): boolean {
  const normalized = candidate.replace(/\\/g, '/').toLowerCase()
  const tmp = os.tmpdir().replace(/\\/g, '/').toLowerCase()
  return (
    normalized.includes('/_npx/') ||
    normalized.includes('/npm-cache/_npx/') ||
    normalized.includes('/pnpm/dlx/') ||
    normalized.startsWith(tmp.endsWith('/') ? tmp : `${tmp}/`)
  )
}

export function resolveServiceLaunchSpec(input: {
  nodeExec: string
  scriptPath: string
  shennianCommandPath?: string | null
  npxPath?: string | null
}): ServiceLaunchSpec {
  if (
    fs.existsSync(input.scriptPath) &&
    (process.env.SHENNIAN_E2E_ISOLATED_DAEMON === '1' || !isEphemeralCliPath(input.scriptPath))
  ) {
    return {
      command: input.nodeExec,
      args: [input.scriptPath, 'run-service'],
      mode: 'direct',
    }
  }

  if (input.shennianCommandPath && !isEphemeralCliPath(input.shennianCommandPath)) {
    return {
      command: input.shennianCommandPath,
      args: ['run-service'],
      mode: 'global-shim',
    }
  }

  if (input.npxPath) {
    return {
      command: input.npxPath,
      args: ['--yes', 'shennian', 'run-service'],
      mode: 'npx',
    }
  }

  return {
    command: input.nodeExec,
    args: [input.scriptPath, 'run-service'],
    mode: 'direct',
  }
}

export function captureEnvForService(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const k of SAFE_SNAPSHOT_ENV_KEYS) {
    if (process.env[k]) env[k] = process.env[k]!
  }
  env.HOME ??= os.homedir()
  env.PATH = buildAugmentedPath({ pathValue: env.PATH, env })
  env.USER ??= os.userInfo().username
  if (getPlatform() === 'win32') {
    const tempDir = process.env.TEMP || process.env.TMP || os.tmpdir()
    const homeDir = os.homedir()
    env.USERPROFILE ??= homeDir
    const parsedHome = path.win32.parse(homeDir)
    env.HOMEDRIVE ??= parsedHome.root.replace(/[\\/]$/, '') || process.env.HOMEDRIVE || ''
    env.HOMEPATH ??= homeDir.slice((env.HOMEDRIVE || '').length) || process.env.HOMEPATH || ''
    env.USERNAME ??= process.env.USERNAME || os.userInfo().username
    env.COMPUTERNAME ??= process.env.COMPUTERNAME || ''
    env.TMPDIR ??= tempDir
    env.TEMP ??= tempDir
    env.TMP ??= tempDir
  } else {
    env.TMPDIR ??= '/tmp'
  }
  return env
}

/**
 * Save current env vars so the daemon can load them at startup.
 * This is critical for launchd/systemd which start with minimal env.
 */
export function saveEnvSnapshot(): void {
  fs.mkdirSync(SHENNIAN_DIR, { recursive: true })
  const snapshot: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && isSafeSnapshotEnvKey(k)) snapshot[k] = v
  }
  if (process.env.PATH ?? process.env.Path) snapshot.PATH = process.env.PATH ?? process.env.Path!
  fs.writeFileSync(resolveShennianPath('env.json'), JSON.stringify(snapshot, null, 2))
}
