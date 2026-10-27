import fs from 'node:fs'
import { renameSyncWithRetry } from '../fs/atomic-rename.js'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import type {
  ManagedAgentRuntimePlatform,
  ManagedAgentRuntimeSecurityDeclaration,
} from '../security/managed-agent-runtime.js'

export function getShennianDir(): string {
  const customHome = process.env.SHENNIAN_HOME?.trim()
  if (customHome) return path.resolve(customHome)
  if (isVitestRuntimeWithoutExplicitHome()) {
    return path.join(
      os.tmpdir(),
      'shennian-vitest-runtime',
      `${process.pid}-${process.env.VITEST_WORKER_ID ?? 'main'}`,
    )
  }
  return path.join(os.homedir(), '.shennian')
}

export function resolveShennianPath(...parts: string[]): string {
  return path.join(getShennianDir(), ...parts)
}

export function getConfigPath(): string {
  return resolveShennianPath('config.json')
}

export const configPath = getConfigPath()

export type CustomAgentEntry = {
  command: string
  caps: {
    name: string
    model?: string
    models?: string[]
    defaultModel?: string
    mode: 'spawn' | 'stdio'
    proactive?: boolean
    resume?: boolean
    version?: string
    protocol?: 'shennian-node-stdio'
    protocolVersion?: 2
    modelDiscovery?: 'dynamic' | 'unavailable'
    systemPrompt?: boolean
    security?: CustomAgentSecurityDeclaration
  }
  source?: 'legacy-command' | 'local-node-adapter'
  entryPath?: string
}

/**
 * Optional managed-runtime attestation returned by a Custom Agent's /caps
 * probe. It is bound to one runtime version, executable digest and platform.
 * Missing or stale attestations leave the runtime unverified.
 */
export type CustomAgentSecurityDeclaration = {
  schemaVersion: 1
  declarationVersion: number
  policyProtocol: 'shennian-managed-policy-file-v1'
  runtimeVersion: string
  executablePath: string
  executableSha256: string
  conformance: {
    suiteVersion: string
    status: 'passed' | 'failed'
    platform: ManagedAgentRuntimePlatform
    testedAt: string
  }
  runtimeSecurity: ManagedAgentRuntimeSecurityDeclaration
}

export type ShennianConfig = {
  defaultProvider?: string
  defaultModel?: string
  apiKeys?: Record<string, string>
  machineId?: string
  machineToken?: string
  accountNamespaceId?: string
  accessToken?: string
  refreshToken?: string
  serverUrl?: string
  customAgents?: Record<string, CustomAgentEntry>
  /** Auto-upgrade policy. Missing values default to patch; legacy "minor" values stay disabled. */
  autoUpgrade?: 'none' | 'patch' | 'minor'
}

export type RuntimeAutoUpgradePolicy = 'none' | 'patch'

export function normalizeAutoUpgradePolicy(value: unknown): RuntimeAutoUpgradePolicy {
  if (value === undefined) return 'patch'
  return value === 'patch' ? 'patch' : 'none'
}

export function loadConfig(): ShennianConfig {
  try {
    const resolvedConfigPath = getConfigPath()
    if (!fs.existsSync(resolvedConfigPath)) return {}
    const config = JSON.parse(stripJsonBom(fs.readFileSync(resolvedConfigPath, 'utf-8'))) as ShennianConfig
    if (config.serverUrl?.includes('shennian.ai')) {
      config.serverUrl = 'https://shennian.net'
    }
    return config
  } catch {
    return {}
  }
}

export function saveConfig(config: ShennianConfig): void {
  const directory = getShennianDir()
  const target = getConfigPath()
  const contents = `${JSON.stringify(config, null, 2)}\n`
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') fs.chmodSync(directory, 0o700)

  if (process.platform === 'win32') {
    fs.writeFileSync(target, contents, { encoding: 'utf8', mode: 0o600 })
    return
  }
  const temp = `${target}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`
  try {
    fs.writeFileSync(temp, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    fs.chmodSync(temp, 0o600)
    renameSyncWithRetry(temp, target)
    fs.chmodSync(target, 0o600)
  } finally {
    try { fs.unlinkSync(temp) } catch {}
  }
}

export function ensureDir(): void {
  fs.mkdirSync(getShennianDir(), { recursive: true, mode: 0o700 })
  fs.mkdirSync(resolveShennianPath('sessions'), { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') {
    fs.chmodSync(getShennianDir(), 0o700)
    fs.chmodSync(resolveShennianPath('sessions'), 0o700)
  }
}

function isVitestRuntimeWithoutExplicitHome(): boolean {
  return (process.env.VITEST === 'true' || Boolean(process.env.VITEST_WORKER_ID)) && !process.env.SHENNIAN_HOME?.trim()
}

function stripJsonBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}
