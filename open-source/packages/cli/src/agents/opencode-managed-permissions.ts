// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/opencode-managed-permissions.test.ts

import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ManagedAgentEnforcement } from '@shennian/wire'
import { resolveProtectedShennianDirectories } from '../security/managed-agent-credential-paths.js'
import type { ManagedAgentRuntimeSecurityDeclaration } from '../security/managed-agent-runtime.js'

type JsonObject = Record<string, unknown>

const OPENCODE_MANAGED_CONFIG_PREFIX = 'shennian-opencode-managed-'

const BASE_SENSITIVE_PATH_RULES = [
  '.env',
  '.env.*',
  '**/.env',
  '**/.env.*',
  '*.key',
  '**/*.key',
  '*.pem',
  '**/*.pem',
  '~/.ssh/**',
  '$HOME/.ssh/**',
  '~/.aws/**',
  '$HOME/.aws/**',
  '~/.azure/**',
  '$HOME/.azure/**',
  '~/.config/gcloud/**',
  '$HOME/.config/gcloud/**',
  '~/.netrc',
  '$HOME/.netrc',
  '~/.npmrc',
  '$HOME/.npmrc',
  '~/.shennian/**',
  '$HOME/.shennian/**',
] as const

const supportedExternalCapabilities = {
  // OpenCode permissions can deny Bash completely, but they cannot constrain
  // Bash or child processes to a filesystem/network sandbox. Enabling command
  // networking is therefore unavailable in managed mode.
  commandNetwork: { allow: false, deny: true },
  webSearch: { allow: true, deny: true },
  browser: { allow: false, deny: true },
  computerUse: { allow: false, deny: true },
  // MCP tool names are server-defined. There is no safe generic allow rule
  // that excludes project/global custom tools, so managed mode keeps MCP off.
  mcp: { allow: false, deny: true },
} as const

/**
 * Evidence is intentionally limited to the locally exercised 1.18 release
 * line. The declaration is partial: it mainly describes tool dispatch
 * checks, not an OS sandbox. Shell execution is disabled rather than
 * presented as isolated. On darwin specifically, a public turn is now also
 * wrapped in a real macOS Seatbelt file-confinement layer (see
 * OpenCodeAdapter.buildMacosFileSandboxSpec / macos-file-sandbox.ts) that
 * denies file read/write anywhere under the home directory except the
 * turn's own workDir and a couple of real global dirs OpenCode itself still
 * needs — this is real host-level enforcement for file paths specifically,
 * layered under the `sandbox.toolPermissionOnly` gap below, not a
 * replacement for it: network, process spawn, and the still-unisolated
 * `~/.local/share/opencode`/`~/.config/opencode` remain uncontained, which
 * is why `level` here stays `partial` rather than `hard`.
 */
export const OPENCODE_MANAGED_RUNTIME_SECURITY: ManagedAgentRuntimeSecurityDeclaration = {
  minimumRuntimeVersion: '1.18.0',
  maximumRuntimeVersionExclusive: '1.19.0',
  platforms: Object.fromEntries(
    (['darwin', 'linux', 'wsl', 'win32'] as const).map((platform) => [
      platform,
      {
        level: 'partial' as const,
        fileAccess: {
          'workspace-read': true,
          'workspace-write': true,
          'host-full': true,
        },
        externalCapabilities: supportedExternalCapabilities,
        knownGaps: [
          'sandbox.toolPermissionOnly',
          'shell.unavailableInManagedMode',
          // XDG_CACHE_HOME/XDG_STATE_HOME are isolated per turn (see
          // createOpenCodeManagedConfigDirectory), but XDG_DATA_HOME still
          // resolves to the real user's `~/.local/share/opencode`, which may
          // hold authentication state. Isolating it needs a verified,
          // version-matched way to keep native login working without that
          // directory; until then this remains a real gap, not a formality.
          'config.globalAndAdministratorSourcesMayRemain',
        ],
      },
    ]),
  ),
}

export type OpenCodeManagedPermissionConfig = {
  args: string[]
  config: JsonObject
}

export type OpenCodeManagedConfigDirectory = {
  directory: string
  configPath: string
  /** XDG_CACHE_HOME override: keeps a public turn's model catalog/binary cache
   * out of the real user's shared `~/.cache/opencode`. */
  cacheDir: string
  /** XDG_STATE_HOME override: keeps a public turn's file locks out of the
   * real user's shared `~/.local/state/opencode`. */
  stateDir: string
}

/**
 * Compiles the effective policy into an invocation-scoped OpenCode config.
 * The global deny rule is deliberate: unknown/custom tools stay disabled.
 */
export function compileOpenCodeManagedPermissions(
  enforcement: ManagedAgentEnforcement,
  resolvedWorkDir: string,
  options: { systemPrompt?: string; publicTurn?: boolean } = {},
): OpenCodeManagedPermissionConfig {
  validateResolvedWorkDir(resolvedWorkDir)
  const policy = enforcement.effectivePolicy

  if (policy.externalCapabilities.commandNetwork) {
    throw new Error('opencode_managed_command_network_unavailable')
  }
  if (policy.externalCapabilities.browser || policy.externalCapabilities.computerUse) {
    throw new Error('opencode_managed_interactive_tools_unavailable')
  }
  if (policy.externalCapabilities.mcp) {
    throw new Error('opencode_managed_mcp_allowlist_unavailable')
  }

  const hostFull = policy.fileAccess === 'host-full'
  const workspaceWritable = policy.fileAccess === 'workspace-write'
  // Public visitor directories start empty. OpenCode 1.18's read tool follows
  // an in-workspace symlink to a sibling visitor directory despite its
  // external_directory deny. Remove file tools entirely for public turns;
  // this is defense in depth, not a substitute for a hard host sandbox.
  const publicTurn = options.publicTurn === true
  const sensitivePathRules = resolveSensitivePathRules()
  const permission: JsonObject = {
    '*': 'deny',
    read: publicTurn ? 'deny' : pathPermission('allow', sensitivePathRules),
    glob: publicTurn ? 'deny' : 'allow',
    grep: publicTurn ? 'deny' : 'allow',
    list: publicTurn ? 'deny' : 'allow',
    edit: !publicTurn && (workspaceWritable || hostFull) ? pathPermission('allow', sensitivePathRules) : 'deny',
    external_directory: !publicTurn && hostFull ? pathPermission('allow', sensitivePathRules) : 'deny',
    bash: 'deny',
    task: 'deny',
    skill: 'deny',
    question: 'allow',
    todoread: 'allow',
    todowrite: 'allow',
    webfetch: policy.externalCapabilities.webSearch ? 'allow' : 'deny',
    websearch: policy.externalCapabilities.webSearch ? 'allow' : 'deny',
    codesearch: policy.externalCapabilities.webSearch ? 'allow' : 'deny',
  }

  return {
    args: ['--pure', '--auto'],
    config: {
      $schema: 'https://opencode.ai/config.json',
      default_agent: 'build',
      share: 'disabled',
      subagent_depth: 0,
      autoupdate: false,
      formatter: false,
      lsp: false,
      permission,
      agent: {
        build: {
          permission,
          ...(options.systemPrompt?.trim() ? { prompt: options.systemPrompt.trim() } : {}),
        },
      },
      plugin: [],
      mcp: {},
      command: {},
      instructions: [],
    },
  }
}

export async function createOpenCodeManagedConfigDirectory(
  config: OpenCodeManagedPermissionConfig,
): Promise<OpenCodeManagedConfigDirectory> {
  const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), OPENCODE_MANAGED_CONFIG_PREFIX))
  const configPath = path.join(directory, 'opencode.json')
  const cacheDir = path.join(directory, 'cache')
  const stateDir = path.join(directory, 'state')
  try {
    await fsPromises.chmod(directory, 0o700)
    await fsPromises.writeFile(configPath, `${JSON.stringify(config.config)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    })
    if (process.platform !== 'win32') await fsPromises.chmod(configPath, 0o600)
    for (const dir of [cacheDir, stateDir]) {
      await fsPromises.mkdir(dir, { mode: 0o700 })
      if (process.platform !== 'win32') await fsPromises.chmod(dir, 0o700)
    }
    return { directory, configPath, cacheDir, stateDir }
  } catch (error) {
    await disposeOpenCodeManagedConfigDirectory(directory).catch(() => {})
    throw new Error('opencode_managed_config_initialization_failed', { cause: error })
  }
}

export async function disposeOpenCodeManagedConfigDirectory(directory: string): Promise<void> {
  const resolved = path.resolve(directory)
  const tempRoot = path.resolve(os.tmpdir())
  if (
    path.dirname(resolved) !== tempRoot ||
    !path.basename(resolved).startsWith(OPENCODE_MANAGED_CONFIG_PREFIX)
  ) {
    throw new Error('opencode_managed_config_cleanup_refused')
  }
  await fsPromises.rm(resolved, { recursive: true, force: true })
}

function pathPermission(
  defaultEffect: 'allow' | 'deny',
  sensitivePathRules: readonly string[],
): JsonObject {
  return {
    '*': defaultEffect,
    ...Object.fromEntries(sensitivePathRules.map((pattern) => [pattern, 'deny'])),
  }
}

function normalizeForOpenCode(value: string): string {
  return value.replaceAll('\\', '/')
}

function resolveSensitivePathRules(): string[] {
  const shennianDirectories = resolveProtectedShennianDirectories()
    .map((entry) => `${normalizeForOpenCode(path.normalize(entry))}/**`)
  return [...new Set([...BASE_SENSITIVE_PATH_RULES, ...shennianDirectories])]
}

function validateResolvedWorkDir(value: string): string {
  const normalized = path.normalize(value.trim())
  if (!normalized || !path.isAbsolute(normalized)) {
    throw new Error('opencode_managed_workdir_invalid')
  }
  let realPath: string
  try {
    realPath = fs.realpathSync(normalized)
  } catch {
    throw new Error('opencode_managed_workdir_unavailable')
  }
  if (path.normalize(realPath) !== normalized) {
    throw new Error('opencode_managed_workdir_not_realpath')
  }
  return normalized
}
