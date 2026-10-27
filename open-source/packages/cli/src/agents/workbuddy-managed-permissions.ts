// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/workbuddy-managed-permissions.test.ts

import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ManagedAgentEnforcement } from '@shennian/wire'
import { resolveProtectedShennianDirectories } from '../security/managed-agent-credential-paths.js'
import type { ManagedAgentRuntimeSecurityDeclaration } from '../security/managed-agent-runtime.js'

type JsonObject = Record<string, unknown>

const WORKBUDDY_MANAGED_CONFIG_PREFIX = 'shennian-workbuddy-managed-'

const READ_TOOLS = ['Read', 'Glob', 'Grep', 'LSP', 'Bash', 'TaskOutput', 'TaskStop'] as const
const WRITE_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'] as const
const WEB_TOOLS = ['WebSearch', 'WebFetch'] as const
const COMPUTER_USE_TOOLS = ['ComputerUse'] as const

const BASE_SENSITIVE_PATHS = [
  '.env',
  '.env.*',
  '**/.env',
  '**/.env.*',
  '*.key',
  '**/*.key',
  '*.pem',
  '**/*.pem',
  '~/.ssh/**',
  '~/.aws/**',
  '~/.azure/**',
  '~/.config/gcloud/**',
  '~/.netrc',
  '~/.npmrc',
  '~/.workbuddy/**',
  '~/.codebuddy/**',
  '~/.claude/**',
  '~/.codex/**',
  '~/.shennian/**',
] as const

const unsupportedInteractiveCapabilities = {
  browser: { allow: false, deny: true },
  mcp: { allow: false, deny: true },
} as const

/**
 * Evidence baseline: WorkBuddy / CodeBuddy 2.115.0 exposes invocation-scoped
 * settings, tool allow/deny rules, strict MCP isolation, and the native Bash
 * sandbox backed by Seatbelt on macOS and bubblewrap on Linux.
 *
 * The profile is deliberately partial. CodeBuddy's sandbox starts from
 * host-readable defaults and a runtime write allowlist, so it cannot express a
 * complete "only this workspace is readable" boundary. Windows has no native
 * Bash/PowerShell OS sandbox. Browser and isolated opt-in MCP configuration are
 * not available through the current non-interactive adapter.
 *
 * 2026-09-26: a real public-turn probe showed CodeBuddy also writes traces,
 * per-process session files, and local-storage entries into the real user's
 * `~/.codebuddy/` on every invocation regardless of `--no-session-persistence`
 * (confirmed by fresh files appearing there during the probe run); no
 * documented flag/env var relocates it, so this is recorded as a gap rather
 * than silently accepted. Separately, `codebuddy --help` documents a real
 * `--sandbox [container|e2b-url]` mode that runs the whole session inside a
 * Docker/Podman container or an E2B sandbox — a stronger boundary than the
 * Bash-only Seatbelt/bubblewrap sandbox this profile currently assumes, and
 * not yet evaluated. A local feasibility check could not get past `docker
 * pull node:20-alpine` (registry unreachable in this environment; this
 * machine's other images all come through China-region mirrors, so the same
 * pull may also fail for a real publisher on a similar network) — the mode is
 * real but its actual isolation, credential/network plumbing, and
 * cross-network image availability are unverified. Worth a dedicated
 * follow-up rather than folding into routine per-Provider hardening.
 */
export const WORKBUDDY_MANAGED_RUNTIME_SECURITY: ManagedAgentRuntimeSecurityDeclaration = {
  minimumRuntimeVersion: '2.115.0',
  maximumRuntimeVersionExclusive: '2.143.0',
  platforms: {
    darwin: {
      level: 'partial',
      fileAccess: { 'workspace-read': false, 'workspace-write': false, 'host-full': true },
      externalCapabilities: {
        commandNetwork: { allow: true, deny: true },
        webSearch: { allow: true, deny: true },
        ...unsupportedInteractiveCapabilities,
        computerUse: { allow: true, deny: true },
      },
      knownGaps: [
        'fileAccess.outsideWorkspaceRead',
        'fileAccess.sandboxRuntimeWriteAllowlist',
        'fileAccess.hostFullSensitiveFilesViaShell',
        'fileAccess.globalAppHomePersisted',
      ],
    },
    linux: {
      level: 'partial',
      fileAccess: { 'workspace-read': false, 'workspace-write': false, 'host-full': true },
      externalCapabilities: {
        commandNetwork: { allow: true, deny: true },
        webSearch: { allow: true, deny: true },
        ...unsupportedInteractiveCapabilities,
        computerUse: { allow: false, deny: true },
      },
      knownGaps: [
        'fileAccess.outsideWorkspaceRead',
        'fileAccess.sandboxRuntimeWriteAllowlist',
        'fileAccess.hostFullSensitiveFilesViaShell',
        'fileAccess.globalAppHomePersisted',
        'internalTransport.unixSocketGranularity',
      ],
    },
    wsl: {
      level: 'partial',
      fileAccess: { 'workspace-read': false, 'workspace-write': false, 'host-full': true },
      externalCapabilities: {
        commandNetwork: { allow: true, deny: true },
        webSearch: { allow: true, deny: true },
        ...unsupportedInteractiveCapabilities,
        computerUse: { allow: false, deny: true },
      },
      knownGaps: [
        'fileAccess.outsideWorkspaceRead',
        'fileAccess.sandboxRuntimeWriteAllowlist',
        'fileAccess.hostFullSensitiveFilesViaShell',
        'fileAccess.globalAppHomePersisted',
        'internalTransport.unixSocketGranularity',
      ],
    },
    win32: {
      level: 'partial',
      fileAccess: { 'workspace-read': false, 'workspace-write': false, 'host-full': true },
      externalCapabilities: {
        commandNetwork: { allow: true, deny: false },
        webSearch: { allow: true, deny: true },
        ...unsupportedInteractiveCapabilities,
        computerUse: { allow: false, deny: true },
      },
      knownGaps: [
        'sandbox.nativeWindowsUnavailable',
        'fileAccess.shellUncontained',
        'fileAccess.hostFullSensitiveFilesViaShell',
        'fileAccess.globalAppHomePersisted',
      ],
    },
  },
}

export type WorkBuddyManagedPermissionOptions = {
  /** Exact local daemon socket required by the scoped managed Room CLI. */
  internalUnixSockets?: readonly string[]
  /** Public visitor turns must not expose host file or shell tools. */
  publicTurn?: boolean
}

export type WorkBuddyManagedPermissionConfig = {
  settings: JsonObject
  toolNames: string[]
  runtimeEnv: NodeJS.ProcessEnv
}

export type WorkBuddyManagedConfigFiles = {
  directory: string
  settingsPath: string
}

/**
 * Builds one invocation-only WorkBuddy policy. User/project/local settings are
 * excluded by the adapter, so their hooks, trusted allow rules, plugins, and
 * sandbox exceptions cannot widen this configuration.
 */
export function compileWorkBuddyManagedPermissions(
  enforcement: ManagedAgentEnforcement,
  resolvedWorkDir: string,
  options: WorkBuddyManagedPermissionOptions = {},
): WorkBuddyManagedPermissionConfig {
  const workDir = validateResolvedWorkDir(resolvedWorkDir)
  const policy = enforcement.effectivePolicy
  const platform = enforcement.platform

  if (enforcement.level === 'unverified') {
    throw new Error('workbuddy_managed_runtime_unverified')
  }
  if (platform !== 'darwin' && platform !== 'linux' && platform !== 'wsl' && platform !== 'win32') {
    throw new Error('workbuddy_managed_platform_unsupported')
  }
  if (policy.externalCapabilities.browser) {
    throw new Error('workbuddy_managed_browser_unavailable')
  }
  if (policy.externalCapabilities.mcp) {
    throw new Error('workbuddy_managed_mcp_isolation_unavailable')
  }
  if (policy.externalCapabilities.computerUse && platform !== 'darwin') {
    throw new Error('workbuddy_managed_computer_use_unavailable')
  }
  if (policy.fileAccess === 'host-full' && !policy.externalCapabilities.commandNetwork) {
    throw new Error('workbuddy_managed_host_full_network_isolation_unavailable')
  }

  const sandboxEnabled = platform !== 'win32' && policy.fileAccess !== 'host-full'
  const workspaceReadOnly = policy.fileAccess === 'workspace-read'
  const publicTurn = options.publicTurn === true
  if (publicTurn && (policy.fileAccess !== 'workspace-read' || options.internalUnixSockets?.length)) {
    throw new Error('workbuddy_public_turn_policy_invalid')
  }
  const sensitivePaths = resolveSensitivePaths()
  const toolNames = [
    ...(!publicTurn ? READ_TOOLS : []),
    ...(!workspaceReadOnly ? WRITE_TOOLS : []),
    ...(policy.externalCapabilities.webSearch ? WEB_TOOLS : []),
    ...(policy.externalCapabilities.computerUse ? COMPUTER_USE_TOOLS : []),
  ]
  const normalizedWorkDir = normalizeForWorkBuddy(workDir)
  const allow = [
    // Bash is safe to auto-run only because the native sandbox is mandatory on
    // supported hosts. Native Windows remains an explicitly disclosed gap.
    ...(!publicTurn ? ['Bash'] : []),
    ...(!workspaceReadOnly
      ? WRITE_TOOLS.map((tool) =>
          policy.fileAccess === 'host-full' ? tool : `${tool}(${normalizedWorkDir}/**)`,
        )
      : []),
    ...(policy.externalCapabilities.webSearch ? WEB_TOOLS : []),
    ...(policy.externalCapabilities.computerUse ? COMPUTER_USE_TOOLS : []),
  ]
  const deny = [
    ...(publicTurn ? [...READ_TOOLS, ...WRITE_TOOLS] : []),
    ...(workspaceReadOnly ? WRITE_TOOLS : []),
    ...(!policy.externalCapabilities.webSearch ? WEB_TOOLS : []),
    ...(!policy.externalCapabilities.computerUse ? COMPUTER_USE_TOOLS : []),
    'Agent',
    'TeamCreate',
    'Workflow',
    'Artifact',
    'ArtifactControl',
    'VideoGen',
    'Skill',
    'SlashCommand',
    'Browser',
    'Chrome',
    'mcp__*',
    ...sensitivePermissionRules(sensitivePaths),
  ]

  const internalUnixSockets = normalizeAbsolutePaths(options.internalUnixSockets)
  const networkAllowed = policy.externalCapabilities.commandNetwork
  const denyWrite = [
    ...sensitivePaths,
    ...(workspaceReadOnly ? [workDir] : []),
  ]

  const settings: JsonObject = {
    permissions: {
      defaultMode: 'dontAsk',
      disableBypassPermissionsMode: 'disable',
      additionalDirectories: [],
      allow: unique(allow),
      ask: [],
      deny: unique(deny),
    },
    sandbox: {
      enabled: sandboxEnabled,
      autoAllowBashIfSandboxed: true,
      excludedCommands: [],
      allowUnsandboxedCommands: false,
      enableWeakerNestedSandbox: false,
      network: {
        allowedDomains: networkAllowed ? ['*'] : [],
        deniedDomains: networkAllowed ? [] : ['*'],
        allowLocalBinding: networkAllowed,
        allowUnixSockets: platform === 'darwin' ? internalUnixSockets : [],
        // CodeBuddy's Linux sandbox does not expose a per-socket allowlist.
        // The managed Room CLI needs the daemon socket, so this unavoidable
        // widening is declared as a partial-protection gap above.
        allowAllUnixSockets: platform === 'linux' || platform === 'wsl',
      },
      filesystem: {
        denyRead: [...sensitivePaths],
        allowWrite: policy.fileAccess === 'workspace-write' ? [workDir] : [],
        denyWrite: unique(denyWrite),
      },
    },
  }

  return {
    settings,
    toolNames: unique(toolNames),
    runtimeEnv: {
      CODEBUDDY_DISABLE_SHELL_SNAPSHOT: '1',
      CODEBUDDY_SKIP_BUILTIN_MARKETPLACE: '1',
      CODEBUDDY_AUTO_UPDATE_THIRD_PARTY_MARKETPLACES: '0',
      CODEBUDDY_DISABLE_CRON: '1',
      CODEBUDDY_PUSH_NOTIFICATION_ENABLED: '0',
      CODEBUDDY_ARTIFACT_ENABLED: '0',
      CODEBUDDY_SHARE_LINK_ENABLED: '0',
      CODEBUDDY_WAIT_FOR_MCP_SERVERS_ENABLED: '0',
      CODEBUDDY_DISABLE_AUTO_MEMORY: '1',
      CODEBUDDY_MEMORY_ENABLED: '0',
      CODEBUDDY_TEAM_MEMORY_ENABLED: '0',
      CODEBUDDY_COMPUTER_USE_ENABLED: policy.externalCapabilities.computerUse ? '1' : '0',
    },
  }
}

export async function createWorkBuddyManagedConfigFiles(
  config: WorkBuddyManagedPermissionConfig,
): Promise<WorkBuddyManagedConfigFiles> {
  const directory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), WORKBUDDY_MANAGED_CONFIG_PREFIX),
  )
  const settingsPath = path.join(directory, 'settings.json')
  try {
    await fsPromises.chmod(directory, 0o700)
    const settings = protectGeneratedConfig(config.settings, directory)
    await fsPromises.writeFile(settingsPath, `${JSON.stringify(settings)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    })
    return { directory, settingsPath }
  } catch (error) {
    await disposeWorkBuddyManagedConfigFiles(directory).catch(() => {})
    throw new Error('workbuddy_managed_config_initialization_failed', { cause: error })
  }
}

export async function disposeWorkBuddyManagedConfigFiles(directory: string): Promise<void> {
  const resolved = path.resolve(directory)
  const tempRoot = path.resolve(os.tmpdir())
  if (
    path.dirname(resolved) !== tempRoot ||
    !path.basename(resolved).startsWith(WORKBUDDY_MANAGED_CONFIG_PREFIX)
  ) {
    throw new Error('workbuddy_managed_config_cleanup_refused')
  }
  await fsPromises.rm(resolved, { recursive: true, force: true })
}

function protectGeneratedConfig(settings: JsonObject, directory: string): JsonObject {
  const cloned = JSON.parse(JSON.stringify(settings)) as JsonObject
  const sandbox = cloned.sandbox as JsonObject
  const filesystem = sandbox.filesystem as JsonObject
  const permissions = cloned.permissions as JsonObject
  const configPattern = `${normalizeForWorkBuddy(directory)}/**`
  filesystem.denyRead = unique([...(filesystem.denyRead as string[]), configPattern])
  filesystem.denyWrite = unique([...(filesystem.denyWrite as string[]), configPattern])
  permissions.deny = unique([
    ...(permissions.deny as string[]),
    `Read(${configPattern})`,
    `Edit(${configPattern})`,
    `Write(${configPattern})`,
  ])
  return cloned
}

function sensitivePermissionRules(paths: readonly string[]): string[] {
  return paths.flatMap((entry) => [
    `Read(${toWorkBuddyPermissionPath(entry)})`,
    `Edit(${toWorkBuddyPermissionPath(entry)})`,
    `Write(${toWorkBuddyPermissionPath(entry)})`,
    `MultiEdit(${toWorkBuddyPermissionPath(entry)})`,
    `NotebookEdit(${toWorkBuddyPermissionPath(entry)})`,
  ])
}

function resolveSensitivePaths(): string[] {
  const directories = resolveProtectedShennianDirectories()
    .map((entry) => `${normalizeForWorkBuddy(path.normalize(entry))}/**`)
  return unique([...BASE_SENSITIVE_PATHS, ...directories])
}

function toWorkBuddyPermissionPath(value: string): string {
  if (!path.isAbsolute(value)) return value
  return value.startsWith('/') ? `/${value}` : `//${value}`
}

function validateResolvedWorkDir(value: string): string {
  const normalized = path.normalize(value.trim())
  if (!normalized || !path.isAbsolute(normalized)) {
    throw new Error('workbuddy_managed_workdir_invalid')
  }
  let realPath: string
  try {
    realPath = fs.realpathSync(normalized)
  } catch {
    throw new Error('workbuddy_managed_workdir_unavailable')
  }
  if (path.normalize(realPath) !== normalized) {
    throw new Error('workbuddy_managed_workdir_not_realpath')
  }
  return normalized
}

function normalizeAbsolutePaths(values?: readonly string[]): string[] {
  return [...new Set(values ?? [])]
    .map((entry) => path.normalize(entry.trim()))
    .filter((entry) => entry && path.isAbsolute(entry))
    .map(normalizeForWorkBuddy)
    .sort()
}

function normalizeForWorkBuddy(value: string): string {
  return value.replace(/\\/g, '/')
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort()
}
