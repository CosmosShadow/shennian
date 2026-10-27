// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/codex-managed-permissions.test.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  ManagedAgentEnforcement,
  ManagedAgentExternalCapabilities,
} from '@shennian/wire'
import type { ManagedAgentRuntimeSecurityDeclaration } from '../security/managed-agent-runtime.js'
import { resolveProtectedShennianDirectories } from '../security/managed-agent-credential-paths.js'
import { managedAttachmentDirectory } from '../room/managed-attachment-directory.js'

export const CODEX_MANAGED_PERMISSION_PROFILE_ID = 'shennian-managed'

const SENSITIVE_WORKSPACE_RULES = {
  '.env': 'deny',
  '.env.*': 'deny',
  '**/.env': 'deny',
  '**/.env.*': 'deny',
  '*.key': 'deny',
  '**/*.key': 'deny',
  '*.pem': 'deny',
  '**/*.pem': 'deny',
  '.ssh': 'deny',
  '**/.ssh': 'deny',
  '.aws': 'deny',
  '**/.aws': 'deny',
  '.azure': 'deny',
  '**/.azure': 'deny',
  '.config/gcloud': 'deny',
  '**/.config/gcloud': 'deny',
} as const

type JsonObject = Record<string, unknown>

export type CodexManagedPermissionOptions = {
  /** Effective MCP server ids read from Codex before the thread starts. */
  configuredMcpServerNames?: readonly string[]
  /** Only the current managed Room Session's verified attachment files are readable. */
  roomAttachmentSessionId?: string
  /** Test-only root override; production always uses the private user-level attachment root. */
  roomAttachmentBaseDirectory?: string
  shellSubprocessPolicy?: {
    inherit: 'none'
    allowedEnvKeys: readonly string[]
    deniedEnvKeys: readonly string[]
  }
}

export type CodexManagedPermissionConfig = {
  profileId: typeof CODEX_MANAGED_PERMISSION_PROFILE_ID
  threadConfig: JsonObject
}

const allExternalCapabilities = (allow: boolean) => ({
  commandNetwork: { allow, deny: true },
  webSearch: { allow, deny: true },
  browser: { allow, deny: true },
  computerUse: { allow, deny: true },
  mcp: { allow, deny: true },
})

/**
 * Codex 0.138+ permission profiles are available on all supported local
 * platforms. A profile is still verified at thread start; registration alone
 * never permits a silent fallback to a legacy sandbox.
 */
export const CODEX_MANAGED_RUNTIME_SECURITY: ManagedAgentRuntimeSecurityDeclaration = {
  minimumRuntimeVersion: '0.138.0',
  platforms: {
    darwin: {
      level: 'hard',
      fileAccess: { 'workspace-read': true, 'workspace-write': true, 'host-full': true },
      externalCapabilities: allExternalCapabilities(true),
    },
    linux: {
      level: 'hard',
      fileAccess: { 'workspace-read': true, 'workspace-write': true, 'host-full': true },
      externalCapabilities: allExternalCapabilities(true),
    },
    win32: {
      // Codex 0.150.1 elevated on Windows 11 enforces workspace writes and
      // command-network denial, but its native ACL sandbox still permits broad
      // reads (including workspace secret globs and symlink targets). Never
      // present that version as equivalent to macOS/Linux hard isolation or
      // allow a managed thread to start with a falsely advertised file mode.
      level: 'partial',
      fileAccess: { 'workspace-read': false, 'workspace-write': false, 'host-full': false },
      externalCapabilities: allExternalCapabilities(true),
      knownGaps: ['sandbox.nativeWindowsReadIsolationUnavailable'],
    },
  },
}

/**
 * Compile one immutable Codex thread configuration from daemon-verified
 * effective permissions. The config is passed only as an app-server thread
 * override and never written into the user's global Codex configuration.
 */
export function compileCodexManagedPermissions(
  enforcement: ManagedAgentEnforcement,
  resolvedWorkDir: string,
  options: CodexManagedPermissionOptions = {},
): CodexManagedPermissionConfig {
  const workDir = validateResolvedWorkDir(resolvedWorkDir)
  const policy = enforcement.effectivePolicy
  if (policy.fileAccess !== 'host-full' &&
    (enforcement.level !== 'hard' || enforcement.unsupportedCapabilities.length > 0)) {
    throw new Error('codex_managed_hard_isolation_unavailable')
  }
  const runtimeReadPaths = normalizeAbsolutePaths(codexRuntimeReadPaths(enforcement.platform))
  const attachmentReadPath = options.roomAttachmentSessionId
    ? managedAttachmentDirectory(options.roomAttachmentSessionId, options.roomAttachmentBaseDirectory)
    : null
  const workspaceAccess = policy.fileAccess === 'workspace-write' ? 'write' : 'read'
  const parentProfile = policy.fileAccess === 'workspace-read'
    // GPT-5.6 Codex turns provisioned from `:read-only` receive no local
    // execution tool, even when a child profile reopens exact read paths.
    // Inherit the workspace tool surface, then replace every filesystem and
    // network grant below. The effective sandbox remains read-only because
    // this profile contains no write entry.
    ? ':workspace'
    : policy.fileAccess === 'workspace-write'
      ? ':workspace'
      : null

  const filesystem = {
    ':root': policy.fileAccess === 'host-full' ? 'write' : 'deny',
    ...(policy.fileAccess === 'host-full'
      ? {}
      : {
          ':minimal': 'read',
          // `:workspace` normally grants temp writes. Managed Agents only get
          // their verified workspace plus fixed operating-system runtime paths.
          ':tmpdir': 'deny',
          ':slash_tmp': 'deny',
          ...Object.fromEntries(runtimeReadPaths.map((entry) => [entry, 'read'])),
        }),
    // These product-owned credentials must remain invisible even when the
    // selected file mode would otherwise allow their parent directory. Keep
    // this after internal path grants so callers cannot accidentally override
    // the deny with a broad daemon runtime path.
    ...hostSensitivePathRules(),
    ...(attachmentReadPath ? { [attachmentReadPath]: 'read' } : {}),
    // Workspace secret rules remain active even in the explicit host-full mode.
    // This preserves the product's separate "sensitive files default deny" rule.
    glob_scan_max_depth: 8,
    ':workspace_roots': {
      '.': policy.fileAccess === 'host-full' ? 'write' : workspaceAccess,
      ...workspaceSensitivePathRules(workDir),
    },
  }

  const commandNetwork = policy.externalCapabilities.commandNetwork
  const network = {
    // Keep the proxy enabled when command networking is off so Codex can
    // enforce the empty host allowlist. Managed Room tools use app-server RPC,
    // never a Unix socket visible to the Agent.
    enabled: true,
    domains: commandNetwork ? { '*': 'allow' } : {},
    unix_sockets: {},
    allow_local_binding: commandNetwork,
    dangerously_allow_all_unix_sockets: false,
  }

  return {
    profileId: CODEX_MANAGED_PERMISSION_PROFILE_ID,
    threadConfig: {
      default_permissions: CODEX_MANAGED_PERMISSION_PROFILE_ID,
      permissions: {
        [CODEX_MANAGED_PERMISSION_PROFILE_ID]: {
          description: 'Shennian managed Agent permissions',
          ...(parentProfile ? { extends: parentProfile } : {}),
          workspace_roots: { [workDir]: true },
          filesystem,
          network,
        },
      },
      web_search: policy.externalCapabilities.webSearch ? 'live' : 'disabled',
      features: codexFeatureOverrides(policy.externalCapabilities),
      allow_login_shell: false,
      shell_environment_policy: codexShellEnvironmentPolicy(options.shellSubprocessPolicy),
      ...mcpServerOverrides(policy.externalCapabilities.mcp, options.configuredMcpServerNames),
      ...(enforcement.platform === 'win32' ? { windows: { sandbox: 'elevated' } } : {}),
    },
  }
}

function codexRuntimeReadPaths(platform: string): string[] {
  // NVM/Homebrew Node on macOS consults this system-owned OpenSSL directory at
  // process startup. Codex's current `:minimal` set does not include it, which
  // otherwise prevents even an allowed Node command from starting. This is a
  // fixed read-only operating-system path, not a user or daemon environment.
  if (platform === 'darwin' && fs.existsSync('/System/Library/OpenSSL')) {
    return ['/System/Library/OpenSSL']
  }
  return []
}

function hostSensitivePathRules(): Record<string, 'deny'> {
  const home = path.normalize(os.homedir())
  const roots = [
    ...resolveProtectedShennianDirectories(),
    ...(home && path.isAbsolute(home)
      ? ['.shennian', '.ssh', '.aws', '.azure', path.join('.config', 'gcloud'), '.netrc', '.npmrc']
          .map((entry) => path.join(home, entry))
      : []),
  ].filter((entry) => entry && path.isAbsolute(entry) && hasDirectoryParents(entry))
  return Object.fromEntries([...new Set(roots)].map((entry) => [entry, 'deny']))
}

function workspaceSensitivePathRules(workDir: string): Record<string, 'deny'> {
  return Object.fromEntries(
    Object.entries(SENSITIVE_WORKSPACE_RULES).filter(([entry]) =>
      entry.includes('*') || hasDirectoryParents(path.join(workDir, entry)),
    ),
  )
}

/**
 * Codex materializes exact deny rules as synthetic bubblewrap mount targets on
 * Linux. An absent target below an existing file (for example when `.config`
 * is a project file rather than a directory) cannot exist and makes bwrap fail
 * before the Agent starts. Omitting that impossible child does not widen
 * access; the filesystem itself prevents traversing through the file.
 */
function hasDirectoryParents(target: string): boolean {
  let parent = path.dirname(target)
  while (parent !== path.dirname(parent)) {
    try {
      return fs.statSync(parent).isDirectory()
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        parent = path.dirname(parent)
        continue
      }
      if (code === 'ENOTDIR') return false
      // Unknown or permission-denied parents must remain protected.
      return true
    }
  }
  return true
}

function codexShellEnvironmentPolicy(
  policy: CodexManagedPermissionOptions['shellSubprocessPolicy'],
): JsonObject {
  const allowed = [...new Set(policy?.allowedEnvKeys ?? [
    'PATH',
    'HOME',
    'USERPROFILE',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'TMPDIR',
    'TMP',
    'TEMP',
  ])]
    .filter(isSafeEnvKey)
    .filter((key) => !CODEX_FORBIDDEN_ROOM_TRANSPORT_ENV.has(key))
    .sort()
  const denied = [...new Set(policy?.deniedEnvKeys ?? [
    'OPENAI_BASE_URL',
    'OPENAI_API_KEY',
  ])].filter(isSafeEnvKey).sort()
  return {
    // Codex needs to select the explicitly allowed values from its already
    // minimized Agent process environment. The include filters reduce the
    // effective child environment to that set; no values are serialized into
    // the persisted thread config.
    inherit: 'all',
    experimental_use_profile: false,
    // The include rules below form the complete allowlist, so Codex's broad
    // default secret-name heuristics are unnecessary and cannot accidentally
    // change which exact Room context keys reach a Shell subprocess.
    ignore_default_excludes: true,
    filters: {
      ...Object.fromEntries(allowed.map((key) => [key, 'include'])),
      ...Object.fromEntries(denied.map((key) => [key, 'exclude'])),
    },
  }
}

const CODEX_FORBIDDEN_ROOM_TRANSPORT_ENV = new Set([
  'SHENNIAN_MANAGED_ROOM_CONTEXT',
  'SHENNIAN_MANAGED_ROOM_IPC_ROOT',
])

function isSafeEnvKey(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
}

export function extractCodexMcpServerNames(configReadResponse: unknown): string[] {
  if (!configReadResponse || typeof configReadResponse !== 'object') {
    throw new Error('codex_managed_config_read_invalid')
  }
  const config = (configReadResponse as { config?: unknown }).config
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('codex_managed_config_read_invalid')
  }
  const servers = (config as Record<string, unknown>).mcp_servers
  if (servers === undefined) return []
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
    throw new Error('codex_managed_config_read_invalid')
  }
  return Object.keys(servers).sort()
}

export function assertCodexManagedPermissionProfile(
  response: unknown,
  expectedProfileId = CODEX_MANAGED_PERMISSION_PROFILE_ID,
): void {
  const profile = response && typeof response === 'object'
    ? (response as { activePermissionProfile?: { id?: unknown } }).activePermissionProfile
    : undefined
  if (profile?.id !== expectedProfileId) {
    throw new Error('codex_managed_permission_profile_unavailable')
  }
}

function codexFeatureOverrides(capabilities: ManagedAgentExternalCapabilities): JsonObject {
  return {
    network_proxy: true,
    apps: capabilities.mcp,
    plugins: capabilities.mcp,
    hooks: capabilities.mcp,
    request_permissions_tool: false,
    browser_use: capabilities.browser,
    browser_use_external: capabilities.browser,
    // Full CDP reaches browser internals beyond the product's single Browser
    // permission, so keep it disabled even when normal browser use is enabled.
    browser_use_full_cdp_access: false,
    computer_use: capabilities.computerUse,
  }
}

function mcpServerOverrides(enabled: boolean, names?: readonly string[]): JsonObject {
  if (enabled) return {}
  const uniqueNames = [...new Set(names ?? [])].filter(Boolean).sort()
  if (!uniqueNames.length) return {}
  return {
    mcp_servers: Object.fromEntries(uniqueNames.map((name) => [name, { enabled: false }])),
  }
}

function validateResolvedWorkDir(value: string): string {
  const normalized = path.normalize(value.trim())
  if (!normalized || !path.isAbsolute(normalized)) {
    throw new Error('codex_managed_workdir_invalid')
  }
  let realPath: string
  try {
    realPath = fs.realpathSync(normalized)
  } catch {
    throw new Error('codex_managed_workdir_unavailable')
  }
  if (path.normalize(realPath) !== normalized) {
    throw new Error('codex_managed_workdir_not_realpath')
  }
  return normalized
}

function normalizeAbsolutePaths(values?: readonly string[]): string[] {
  const normalized = [...new Set(values ?? [])]
    .map((entry) => path.normalize(entry.trim()))
    .filter((entry) => entry && path.isAbsolute(entry))
    .flatMap((entry) => {
      try {
        // macOS commonly exposes TMPDIR through /var while Seatbelt evaluates
        // the same socket as /private/var. Keep both spellings: the filesystem
        // sandbox canonicalizes, while the Unix-socket proxy matches the path
        // string used by the client.
        const realPath = fs.realpathSync(entry)
        return realPath === entry ? [entry] : [entry, realPath]
      } catch {
        try {
          // Some fixed runtime entries may not exist until startup, but their
          // containing directory can still have a canonical platform spelling.
          const realParent = fs.realpathSync(path.dirname(entry))
          const realPath = path.join(realParent, path.basename(entry))
          return realPath === entry ? [entry] : [entry, realPath]
        } catch {
          return [entry]
        }
      }
    })
  return [...new Set(normalized)].sort()
}
