// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/claude-managed-permissions.test.ts

import fs from 'node:fs'
import path from 'node:path'
import type { ManagedAgentEnforcement } from '@shennian/wire'
import { resolveProtectedShennianDirectories } from '../security/managed-agent-credential-paths.js'
import type { ManagedAgentRuntimeSecurityDeclaration } from '../security/managed-agent-runtime.js'

type JsonObject = Record<string, unknown>

export type ClaudeManagedPermissionOptions = {
  /** Exact runtime files required by Shennian's managed Room transport. */
  internalReadPaths?: readonly string[]
  /** Exact local sockets required by Shennian's managed Room transport. */
  internalUnixSockets?: readonly string[]
  shellSubprocessPolicy?: {
    inherit: 'none'
    allowedEnvKeys: readonly string[]
    deniedEnvKeys: readonly string[]
  }
}

export type ClaudeManagedPermissionConfig = {
  /** One-invocation-only settings passed inline through --settings. */
  settings: JsonObject
  args: string[]
}

const fullExternalCapabilitySupport = {
  commandNetwork: { allow: true, deny: true },
  webSearch: { allow: true, deny: true },
  browser: { allow: true, deny: true },
  // Claude Code's computer-use surface controls the real desktop and does not
  // currently expose a Shennian-verifiable, non-interactive permission gate.
  computerUse: { allow: false, deny: true },
  mcp: { allow: true, deny: true },
} as const

/**
 * v2.1.260 is the first evidence baseline used by Shennian: it includes
 * restricted mode, source isolation, fail-closed sandbox startup, credential
 * scrubbing, outside-workspace read blocking, and the macOS fix for that read
 * boundary. Unknown and older builds therefore resolve as unverified.
 */
export const CLAUDE_MANAGED_RUNTIME_SECURITY: ManagedAgentRuntimeSecurityDeclaration = {
  minimumRuntimeVersion: '2.1.260',
  maximumRuntimeVersionExclusive: '2.2.0',
  platforms: {
    darwin: {
      level: 'hard',
      fileAccess: { 'workspace-read': true, 'workspace-write': true, 'host-full': true },
      externalCapabilities: fullExternalCapabilitySupport,
    },
    linux: {
      level: 'partial',
      fileAccess: { 'workspace-read': true, 'workspace-write': true, 'host-full': true },
      externalCapabilities: fullExternalCapabilitySupport,
      knownGaps: ['internalTransport.unixSocketGranularity'],
    },
    wsl: {
      level: 'partial',
      fileAccess: { 'workspace-read': true, 'workspace-write': true, 'host-full': true },
      externalCapabilities: fullExternalCapabilitySupport,
      knownGaps: ['internalTransport.unixSocketGranularity'],
    },
    win32: {
      level: 'partial',
      fileAccess: { 'workspace-read': false, 'workspace-write': false, 'host-full': true },
      externalCapabilities: {
        commandNetwork: { allow: true, deny: false },
        webSearch: { allow: true, deny: true },
        browser: { allow: true, deny: true },
        computerUse: { allow: false, deny: true },
        mcp: { allow: true, deny: true },
      },
      knownGaps: ['sandbox.nativeWindowsUnavailable'],
    },
  },
}

const SENSITIVE_PERMISSION_PATHS = [
  '//**/.env',
  '//**/.env.*',
  '//**/*.key',
  '//**/*.pem',
  '~/.ssh/**',
  '~/.aws/**',
  '~/.azure/**',
  '~/.config/gcloud/**',
  '~/.netrc',
  '~/.npmrc',
  '~/.shennian/**',
] as const

const SENSITIVE_SANDBOX_PATHS = [
  '/**/.env',
  '/**/.env.*',
  '/**/*.key',
  '/**/*.pem',
  '~/.ssh',
  '~/.aws',
  '~/.azure',
  '~/.config/gcloud',
  '~/.netrc',
  '~/.npmrc',
] as const

const SHENNIAN_HOME_SANDBOX_PATH = '~/.shennian'

const READ_TOOLS = ['Read', 'Glob', 'Grep', 'LSP'] as const
const WRITE_TOOLS = ['Edit', 'Write', 'NotebookEdit'] as const

/**
 * Converts the daemon-verified effective policy into Claude Code's native,
 * invocation-scoped permission and sandbox configuration. It never writes to
 * ~/.claude or the project's .claude directory.
 */
export function compileClaudeManagedPermissions(
  enforcement: ManagedAgentEnforcement,
  resolvedWorkDir: string,
  options: ClaudeManagedPermissionOptions = {},
): ClaudeManagedPermissionConfig {
  const workDir = validateResolvedWorkDir(resolvedWorkDir)
  const policy = enforcement.effectivePolicy
  const hardSandbox = enforcement.platform !== 'win32'
  const internalReadPaths = normalizeAbsolutePaths(options.internalReadPaths)
  const internalUnixSockets = normalizeAbsolutePaths(options.internalUnixSockets)
  const fileRoot = normalizeForClaude(path.parse(workDir).root)
  const normalizedWorkDir = normalizeForClaude(workDir)
  const hostFull = policy.fileAccess === 'host-full'
  const workspaceWritable = policy.fileAccess === 'workspace-write'
  const shennianDirectories = resolveProtectedShennianDirectories()

  const allowRules: string[] = []
  if (workspaceWritable) allowRules.push('Edit(/**)')
  if (hostFull) allowRules.push('Read', 'Edit')
  if (policy.externalCapabilities.webSearch) allowRules.push('WebSearch', 'WebFetch')
  if (policy.externalCapabilities.mcp) allowRules.push('mcp__*')
  // Native Windows has no Bash sandbox. The compiler has already widened the
  // effective policy and required limited-protection confirmation before this
  // unsandboxed command surface can be reached.
  if (!hardSandbox) allowRules.push('Bash', 'PowerShell')

  const denyRules = [
    ...SENSITIVE_PERMISSION_PATHS.flatMap((entry) => [`Read(${entry})`, `Edit(${entry})`]),
    ...shennianDirectories.flatMap((entry) => [
      `Read(${toClaudeAbsolutePermissionPattern(entry)}/**)`,
      `Edit(${toClaudeAbsolutePermissionPattern(entry)}/**)`,
    ]),
    ...(!policy.externalCapabilities.webSearch ? ['WebSearch', 'WebFetch'] : []),
    ...(!policy.externalCapabilities.mcp ? ['mcp__*'] : []),
  ]

  const filesystem = hardSandbox
    ? {
        disabled: false,
        // Claude's sandbox allowRead entries take precedence over denyRead.
        // This keeps the product-owned directory opaque while restoring only
        // the exact daemon transport files needed by the scoped Room CLI.
        allowRead: [...new Set([normalizedWorkDir, ...internalReadPaths])],
        allowWrite: hostFull ? [fileRoot] : workspaceWritable ? [normalizedWorkDir] : [],
        denyRead: [
          ...SENSITIVE_SANDBOX_PATHS,
          SHENNIAN_HOME_SANDBOX_PATH,
          ...shennianDirectories,
        ],
        denyWrite: [
          ...SENSITIVE_SANDBOX_PATHS,
          SHENNIAN_HOME_SANDBOX_PATH,
          ...shennianDirectories,
          ...(!hostFull && !workspaceWritable ? [normalizedWorkDir] : []),
        ],
      }
    : undefined

  const network = hardSandbox
    ? {
        allowedDomains: policy.externalCapabilities.commandNetwork ? ['*'] : [],
        deniedDomains: policy.externalCapabilities.commandNetwork ? [] : ['*'],
        strictAllowlist: true,
        allowLocalBinding: policy.externalCapabilities.commandNetwork,
        allowUnixSockets: enforcement.platform === 'darwin' ? internalUnixSockets : [],
        // Linux/WSL only expose an all-or-nothing AF_UNIX switch. The
        // filesystem layer still exposes only the exact daemon path, but the
        // runtime declaration reports this platform as partial.
        allowAllUnixSockets:
          (enforcement.platform === 'linux' || enforcement.platform === 'wsl') &&
          internalUnixSockets.length > 0,
      }
    : undefined

  const settings: JsonObject = {
    permissions: {
      defaultMode: 'dontAsk',
      disableBypassPermissionsMode: 'disable',
      disableAutoMode: 'disable',
      blockReadsOutsideWorkingDirectories: !hostFull,
      allow: [...new Set(allowRules)].sort(),
      deny: [...new Set(denyRules)].sort(),
    },
    disableArtifact: true,
    disableRemoteControl: true,
    disableWorkflows: true,
    disableClaudeAiConnectors: !policy.externalCapabilities.mcp,
    ...(hardSandbox
      ? {
          sandbox: {
            enabled: true,
            failIfUnavailable: true,
            autoAllowBashIfSandboxed: true,
            allowUnsandboxedCommands: false,
            excludedCommands: [],
            allowAppleEvents: false,
            filesystem,
            network,
            credentials: {
              files: SENSITIVE_SANDBOX_PATHS.map((entry) => ({ path: entry, mode: 'deny' })),
              envVars: normalizeEnvKeys(options.shellSubprocessPolicy?.deniedEnvKeys).map(
                (name) => ({ name, mode: 'deny' }),
              ),
            },
          },
        }
      : {}),
  }

  const tools = [
    'Bash',
    ...READ_TOOLS,
    ...(workspaceWritable || hostFull ? WRITE_TOOLS : []),
    ...(policy.externalCapabilities.webSearch ? ['WebSearch', 'WebFetch'] : []),
  ]

  const args = [
    '--restricted',
    '--setting-sources',
    '',
    '--settings',
    JSON.stringify(settings),
    '--permission-mode',
    'dontAsk',
    '--tools',
    [...new Set(tools)].join(','),
    policy.externalCapabilities.browser ? '--chrome' : '--no-chrome',
  ]

  if (hostFull) args.push('--add-dir', fileRoot)
  if (!policy.externalCapabilities.mcp) {
    args.push('--strict-mcp-config', '--mcp-config', JSON.stringify({ mcpServers: {} }))
  }

  return { settings, args }
}

function validateResolvedWorkDir(value: string): string {
  const normalized = path.normalize(value.trim())
  if (!normalized || !path.isAbsolute(normalized)) {
    throw new Error('claude_managed_workdir_invalid')
  }
  let realPath: string
  try {
    realPath = fs.realpathSync(normalized)
  } catch {
    throw new Error('claude_managed_workdir_unavailable')
  }
  if (path.normalize(realPath) !== normalized) {
    throw new Error('claude_managed_workdir_not_realpath')
  }
  return normalized
}

function normalizeAbsolutePaths(values?: readonly string[]): string[] {
  return [...new Set(values ?? [])]
    .map((entry) => path.normalize(entry.trim()))
    .filter((entry) => entry && path.isAbsolute(entry))
    .map(normalizeForClaude)
    .sort()
}

function normalizeForClaude(value: string): string {
  return value.replaceAll('\\', '/')
}

function toClaudeAbsolutePermissionPattern(value: string): string {
  const normalized = normalizeForClaude(value)
  return normalized.startsWith('/') ? `/${normalized}` : `//${normalized}`
}

function normalizeEnvKeys(values?: readonly string[]): string[] {
  return [...new Set(values ?? [])].filter((value) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)).sort()
}
