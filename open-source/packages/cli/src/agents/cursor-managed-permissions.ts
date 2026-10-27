// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/cursor-managed-permissions.test.ts

import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ManagedAgentEnforcement } from '@shennian/wire'
import { resolveProtectedShennianDirectories } from '../security/managed-agent-credential-paths.js'
import type { ManagedAgentRuntimeSecurityDeclaration } from '../security/managed-agent-runtime.js'

type JsonObject = Record<string, unknown>

const CURSOR_MANAGED_CONFIG_PREFIX = 'shennian-cursor-managed-'
const MAX_PROJECT_SANDBOX_CONFIG_BYTES = 1024 * 1024

const BASE_SENSITIVE_READ_RULES = [
  'Read(.env)',
  'Read(.env.*)',
  'Read(**/.env)',
  'Read(**/.env.*)',
  'Read(*.key)',
  'Read(**/*.key)',
  'Read(*.pem)',
  'Read(**/*.pem)',
  'Read(~/.shennian/**)',
  'Read($HOME/.shennian/**)',
] as const

const supportedExternalCapabilities = {
  // Cursor's shell can request a one-off network permission and retry a
  // denied command in non-interactive mode. Managed mode therefore keeps the
  // entire Shell tool disabled; it cannot safely offer command networking.
  commandNetwork: { allow: false, deny: true },
  webSearch: { allow: true, deny: true },
  // Cursor CLI does not expose non-interactive Browser or computer-use
  // permission switches. Keeping them unavailable is safer than pretending
  // that MCP/WebFetch rules control the native tools.
  browser: { allow: false, deny: true },
  computerUse: { allow: false, deny: true },
  // Project MCP discovery happens outside the invocation-only config and can
  // start before a tool permission is evaluated.
  mcp: { allow: false, deny: false },
} as const

/**
 * Evidence baseline: Cursor Agent 2026.08.31 exposes --sandbox, --mode=ask,
 * CURSOR_CONFIG_DIR, sandbox.json network policy, and CLI permission tokens.
 *
 * The profile is deliberately partial. Real 2026.08.31 probes showed that
 * Read can cross the workspace boundary, and that an allowed Shell can read
 * outside files, write temporary files, and request network access despite a
 * deny policy. Project MCP discovery also lacks a strict invocation-scoped
 * disable switch. Shell is therefore disabled in managed mode.
 *
 * 2026-09-26: a real public-turn boundary probe (fake visitor data, no
 * production traffic) showed that Cursor also mirrors the full turn
 * transcript into `~/.cursor/projects/<sanitized-workdir-path>/agent-
 * transcripts/`, a location `CURSOR_CONFIG_DIR` does not redirect. Every
 * distinct public conversation workDir therefore leaves a permanent,
 * never-cleaned copy of visitor/AI text in the machine owner's real Cursor
 * install, outside Shennian's own retention/deletion controls. No documented
 * CLI flag or env var relocates or disables it; redirecting HOME would also
 * hide Cursor's native login store, which managed Cursor deliberately still
 * relies on. Recorded as a known gap rather than silently accepted.
 */
export const CURSOR_MANAGED_RUNTIME_SECURITY: ManagedAgentRuntimeSecurityDeclaration = {
  minimumRuntimeVersion: '2026.08.31',
  maximumRuntimeVersionExclusive: '2026.09.01',
  platforms: {
    darwin: {
      level: 'partial',
      fileAccess: { 'workspace-read': false, 'workspace-write': false, 'host-full': true },
      externalCapabilities: supportedExternalCapabilities,
      knownGaps: [
        'fileAccess.workspaceBoundaryUnenforced',
        'fileAccess.outsideWorkspaceRead',
        'fileAccess.globalProjectHistoryPersisted',
        'sandbox.shellDisabled',
        'externalCapabilities.webSearchToolGranularity',
        'externalCapabilities.projectMcpStartup',
      ],
    },
    linux: {
      level: 'partial',
      fileAccess: { 'workspace-read': false, 'workspace-write': false, 'host-full': true },
      externalCapabilities: supportedExternalCapabilities,
      knownGaps: [
        'fileAccess.workspaceBoundaryUnenforced',
        'fileAccess.outsideWorkspaceRead',
        'fileAccess.globalProjectHistoryPersisted',
        'sandbox.shellDisabled',
        'externalCapabilities.webSearchToolGranularity',
        'externalCapabilities.projectMcpStartup',
      ],
    },
    wsl: {
      level: 'partial',
      fileAccess: { 'workspace-read': false, 'workspace-write': false, 'host-full': true },
      externalCapabilities: supportedExternalCapabilities,
      knownGaps: [
        'fileAccess.workspaceBoundaryUnenforced',
        'fileAccess.outsideWorkspaceRead',
        'fileAccess.globalProjectHistoryPersisted',
        'sandbox.shellDisabled',
        'externalCapabilities.webSearchToolGranularity',
        'externalCapabilities.projectMcpStartup',
      ],
    },
    win32: {
      level: 'partial',
      fileAccess: { 'workspace-read': false, 'workspace-write': false, 'host-full': true },
      externalCapabilities: {
        commandNetwork: { allow: true, deny: false },
        webSearch: { allow: true, deny: true },
        browser: { allow: false, deny: true },
        computerUse: { allow: false, deny: true },
        mcp: { allow: true, deny: true },
      },
      knownGaps: [
        'sandbox.nativeWindowsUnverified',
        'fileAccess.globalProjectHistoryPersisted',
        'sandbox.shellDisabled',
        'externalCapabilities.projectMcpStartup',
      ],
    },
  },
}

export type CursorManagedPermissionConfig = {
  args: string[]
  cliConfig: JsonObject
  sandboxConfig: JsonObject
}

/**
 * Compiles one Cursor invocation policy. The returned JSON is written only to
 * an isolated CURSOR_CONFIG_DIR created for the child process; neither the
 * user's ~/.cursor directory nor the workspace is modified.
 */
export function compileCursorManagedPermissions(
  enforcement: ManagedAgentEnforcement,
  resolvedWorkDir: string,
  options: { publicTurn?: boolean } = {},
): CursorManagedPermissionConfig {
  const workDir = validateResolvedWorkDir(resolvedWorkDir)
  const policy = enforcement.effectivePolicy
  const hostFull = policy.fileAccess === 'host-full'
  const workspaceReadOnly = policy.fileAccess === 'workspace-read'
  // Cursor 2026.09.02 read a sibling fake visitor file by both absolute path
  // and an in-workspace symlink under the ordinary restricted allowlist.
  // Public workspaces start empty, so public turns get no file tools at all.
  // This is not an OS-level isolation claim.
  const publicTurn = options.publicTurn === true
  const sensitiveReadRules = resolveSensitiveReadRules()
  const sensitiveWriteRules = sensitiveReadRules.map((rule) =>
    rule.replace(/^Read\(/, 'Write('),
  )

  if (policy.externalCapabilities.commandNetwork) {
    throw new Error('cursor_managed_command_network_unavailable')
  }
  if (policy.externalCapabilities.mcp) {
    throw new Error('cursor_managed_mcp_isolation_unavailable')
  }
  if (policy.externalCapabilities.browser || policy.externalCapabilities.computerUse) {
    throw new Error('cursor_managed_native_interactive_tool_control_unavailable')
  }
  if (enforcement.platform === 'win32' && !hostFull) {
    throw new Error('cursor_managed_native_windows_sandbox_unavailable')
  }

  if (!hostFull) assertProjectSandboxCannotBroadenPolicy(workDir, workspaceReadOnly)

  const allow = publicTurn ? [] : ['Read(**)']
  if (!publicTurn && !workspaceReadOnly) allow.push('Write(**)')
  if (policy.externalCapabilities.webSearch) allow.push('WebFetch(*)')
  if (policy.externalCapabilities.mcp) allow.push('Mcp(*:*)')

  const deny = [
    ...sensitiveReadRules,
    ...sensitiveWriteRules,
    ...(publicTurn ? ['Read(**)', 'Write(**)'] : []),
    'Shell(*)',
    ...(workspaceReadOnly ? ['Write(**)'] : []),
    ...(!policy.externalCapabilities.webSearch ? ['WebFetch(*)'] : []),
    ...(!policy.externalCapabilities.mcp ? ['Mcp(*:*)'] : []),
  ]

  const networkAllowed = policy.externalCapabilities.commandNetwork
  const cliConfig: JsonObject = {
    version: 1,
    editor: { vimMode: false },
    approvalMode: hostFull ? 'unrestricted' : 'allowlist',
    sandbox: {
      mode: hostFull ? 'disabled' : 'enabled',
      networkAccess: networkAllowed ? 'allow_all' : 'user_config_only',
      readBoundary: hostFull ? 'system' : 'workspace',
    },
    permissions: {
      allow: [...new Set(allow)].sort(),
      deny: [...new Set(deny)].sort(),
    },
    notifications: false,
    hints: false,
    suggestNextPrompt: false,
    attribution: {
      attributeCommitsToAgent: false,
      attributePRsToAgent: false,
    },
  }

  const sandboxConfig: JsonObject = {
    type: hostFull
      ? 'insecure_none'
      : workspaceReadOnly
        ? 'workspace_readonly'
        : 'workspace_readwrite',
    additionalReadwritePaths: [],
    additionalReadonlyPaths: [],
    disableTmpWrite: true,
    enableSharedBuildCache: false,
    networkPolicy: networkAllowed
      ? { default: 'allow', allow: [], deny: [] }
      : { default: 'deny', allow: [], deny: ['*'] },
    networkPolicyStrict: !networkAllowed,
    readBoundary: hostFull ? 'system' : 'workspace',
  }

  return {
    args: [
      '--trust',
      '--workspace',
      workDir,
      '--sandbox',
      hostFull ? 'disabled' : 'enabled',
      ...(workspaceReadOnly ? ['--mode', 'ask'] : []),
      ...(policy.externalCapabilities.mcp ? ['--approve-mcps'] : []),
      ...(hostFull ? ['--force'] : []),
    ],
    cliConfig,
    sandboxConfig,
  }
}

export async function createCursorManagedConfigDirectory(
  config: CursorManagedPermissionConfig,
): Promise<string> {
  const configDir = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), CURSOR_MANAGED_CONFIG_PREFIX),
  )
  try {
    await fsPromises.chmod(configDir, 0o700)
    await Promise.all([
      writePrivateJson(path.join(configDir, 'cli-config.json'), config.cliConfig),
      writePrivateJson(path.join(configDir, 'sandbox.json'), config.sandboxConfig),
    ])
    return configDir
  } catch (error) {
    await disposeCursorManagedConfigDirectory(configDir).catch(() => {})
    throw new Error('cursor_managed_config_initialization_failed', { cause: error })
  }
}

export async function disposeCursorManagedConfigDirectory(configDir: string): Promise<void> {
  const resolved = path.resolve(configDir)
  const tempRoot = path.resolve(os.tmpdir())
  if (
    path.dirname(resolved) !== tempRoot ||
    !path.basename(resolved).startsWith(CURSOR_MANAGED_CONFIG_PREFIX)
  ) {
    throw new Error('cursor_managed_config_cleanup_refused')
  }
  await fsPromises.rm(resolved, { recursive: true, force: true })
}

function assertProjectSandboxCannotBroadenPolicy(
  workDir: string,
  workspaceReadOnly: boolean,
): void {
  const projectConfigPath = path.join(workDir, '.cursor', 'sandbox.json')
  if (!fs.existsSync(projectConfigPath)) return

  let raw: string
  try {
    const stat = fs.statSync(projectConfigPath)
    if (!stat.isFile() || stat.size > MAX_PROJECT_SANDBOX_CONFIG_BYTES) {
      throw new Error('invalid_project_sandbox')
    }
    raw = fs.readFileSync(projectConfigPath, 'utf8')
  } catch (error) {
    throw new Error('cursor_managed_project_sandbox_unverifiable', { cause: error })
  }

  let parsed: Record<string, unknown>
  try {
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('invalid_project_sandbox')
    }
    parsed = value as Record<string, unknown>
  } catch (error) {
    throw new Error('cursor_managed_project_sandbox_unverifiable', { cause: error })
  }

  if (parsed.type === 'insecure_none') {
    throw new Error('cursor_managed_project_sandbox_broadens_access')
  }
  if (workspaceReadOnly && parsed.type === 'workspace_readwrite') {
    throw new Error('cursor_managed_project_sandbox_broadens_access')
  }
  if (hasConfiguredPaths(parsed.additionalReadwritePaths) || hasConfiguredPaths(parsed.additionalReadonlyPaths)) {
    throw new Error('cursor_managed_project_sandbox_broadens_access')
  }
}

function hasConfiguredPaths(value: unknown): boolean {
  if (value == null) return false
  return !Array.isArray(value) || value.length > 0
}

function normalizeForCursor(value: string): string {
  return value.replaceAll('\\', '/')
}

function resolveSensitiveReadRules(): string[] {
  const shennianDirectories = resolveProtectedShennianDirectories()
    .map((entry) => normalizeForCursor(path.normalize(entry)))
    .filter((entry) => path.isAbsolute(entry))
  return [...new Set([
    ...BASE_SENSITIVE_READ_RULES,
    ...shennianDirectories.map((entry) => `Read(${entry}/**)`),
  ])]
}

function validateResolvedWorkDir(value: string): string {
  const normalized = path.normalize(value.trim())
  if (!normalized || !path.isAbsolute(normalized)) {
    throw new Error('cursor_managed_workdir_invalid')
  }
  let realPath: string
  try {
    realPath = fs.realpathSync(normalized)
  } catch {
    throw new Error('cursor_managed_workdir_unavailable')
  }
  if (path.normalize(realPath) !== normalized) {
    throw new Error('cursor_managed_workdir_not_realpath')
  }
  return normalized
}

async function writePrivateJson(filePath: string, value: JsonObject): Promise<void> {
  await fsPromises.writeFile(filePath, `${JSON.stringify(value)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  })
}
