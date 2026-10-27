// @covers open-source/packages/cli/src/agents/codex-managed-permissions.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ManagedAgentEnforcement } from '@shennian/wire'
import {
  assertCodexManagedPermissionProfile,
  CODEX_MANAGED_PERMISSION_PROFILE_ID,
  CODEX_MANAGED_RUNTIME_SECURITY,
  compileCodexManagedPermissions,
  extractCodexMcpServerNames,
} from '../agents/codex-managed-permissions.js'

const tempDirs: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function workDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-codex-policy-'))
  tempDirs.push(directory)
  return fs.realpathSync(directory)
}

function enforcement(
  fileAccess: ManagedAgentEnforcement['effectivePolicy']['fileAccess'],
  capabilities: Partial<ManagedAgentEnforcement['effectivePolicy']['externalCapabilities']> = {},
  platform = 'darwin',
): ManagedAgentEnforcement {
  return {
    level: 'hard',
    runtimeVersion: '0.152.1',
    platform,
    unsupportedCapabilities: [],
    effectivePolicy: {
      version: 7,
      fileAccess,
      externalCapabilities: {
        commandNetwork: false,
        webSearch: false,
        browser: false,
        computerUse: false,
        mcp: false,
        ...capabilities,
      },
    },
  }
}

function profile(config: ReturnType<typeof compileCodexManagedPermissions>) {
  return (config.threadConfig.permissions as Record<string, Record<string, unknown>>)[
    CODEX_MANAGED_PERMISSION_PROFILE_ID
  ]!
}

describe('compileCodexManagedPermissions', () => {
  it('fails closed when a workspace sandbox loses hard enforcement', () => {
    const directory = workDir()
    expect(() => compileCodexManagedPermissions({
      ...enforcement('workspace-write'), level: 'partial',
    }, directory)).toThrow('codex_managed_hard_isolation_unavailable')
    expect(() => compileCodexManagedPermissions({
      ...enforcement('workspace-write'), unsupportedCapabilities: ['sandbox.symlinkEscape'],
    }, directory)).toThrow('codex_managed_hard_isolation_unavailable')
  })
  it('grants only the current Room Session attachment directory for restricted file reads', () => {
    const directory = workDir()
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'managed-attachment-permissions-'))
    const attachmentRoot = path.join(parent, 'attachments')
    try {
    const result = compileCodexManagedPermissions(enforcement('workspace-read'), directory, {
      roomAttachmentSessionId: 'session-a',
      roomAttachmentBaseDirectory: attachmentRoot,
    })
    const filesystem = profile(result).filesystem as Record<string, unknown>
    const grants = Object.entries(filesystem).filter(([entry, access]) => entry.startsWith(`${attachmentRoot}${path.sep}`) && access === 'read')
    expect(grants).toHaveLength(1)
    expect(grants[0]![0]).not.toContain('session-a')
    expect(filesystem[path.join(os.homedir(), '.shennian')]).toBe('deny')
    } finally { fs.rmSync(parent, { recursive: true, force: true }) }
  })

  it('limits read-only Agents to the real workspace without Room transport grants', () => {
    const directory = workDir()
    const result = compileCodexManagedPermissions(enforcement('workspace-read'), directory, {
      configuredMcpServerNames: ['github', 'filesystem'],
      shellSubprocessPolicy: {
        inherit: 'none',
        allowedEnvKeys: ['PATH', 'SHENNIAN_MANAGED_ROOM_CONTEXT', 'SHENNIAN_MANAGED_ROOM_IPC_ROOT'],
        deniedEnvKeys: ['OPENAI_API_KEY'],
      },
    })

    expect(result.threadConfig.default_permissions).toBe(CODEX_MANAGED_PERMISSION_PROFILE_ID)
    const permissions = profile(result)
    // `:workspace` carries Codex's local execution tool surface; the explicit
    // rules below still compile to a read-only sandbox with no writable root.
    expect(permissions.extends).toBe(':workspace')
    expect(permissions.workspace_roots).toEqual({ [directory]: true })
    expect(permissions.filesystem).toMatchObject({
      ':root': 'deny',
      ':minimal': 'read',
      ':tmpdir': 'deny',
      ':slash_tmp': 'deny',
      [path.join(os.homedir(), '.shennian')]: 'deny',
      ':workspace_roots': {
        '.': 'read',
        '.env': 'deny',
        '**/.env.*': 'deny',
        '**/*.key': 'deny',
      },
    })
    if (fs.existsSync('/System/Library/OpenSSL')) {
      expect(permissions.filesystem).toMatchObject({
        '/System/Library/OpenSSL': 'read',
      })
    }
    expect(permissions.network).toEqual({
      enabled: true,
      domains: {},
      unix_sockets: {},
      allow_local_binding: false,
      dangerously_allow_all_unix_sockets: false,
    })
    expect(result.threadConfig.web_search).toBe('disabled')
    expect(result.threadConfig.features).toMatchObject({
      network_proxy: true,
      apps: false,
      plugins: false,
      hooks: false,
      browser_use: false,
      computer_use: false,
    })
    expect(result.threadConfig.mcp_servers).toEqual({
      filesystem: { enabled: false },
      github: { enabled: false },
    })
    expect(result.threadConfig.shell_environment_policy).toEqual({
      inherit: 'all',
      experimental_use_profile: false,
      ignore_default_excludes: true,
      filters: {
        OPENAI_API_KEY: 'exclude',
        PATH: 'include',
      },
    })
  })

  it('allows workspace writes and only the explicitly selected external capabilities', () => {
    const directory = workDir()
    const result = compileCodexManagedPermissions(
      enforcement('workspace-write', {
        commandNetwork: true,
        webSearch: true,
        browser: true,
        computerUse: true,
        mcp: true,
      }),
      directory,
    )
    const permissions = profile(result)

    expect(permissions.extends).toBe(':workspace')
    expect(permissions.filesystem).toMatchObject({
      ':root': 'deny',
      ':tmpdir': 'deny',
      ':slash_tmp': 'deny',
      ':workspace_roots': { '.': 'write', '.env': 'deny' },
    })
    expect(permissions.network).toMatchObject({
      enabled: true,
      domains: { '*': 'allow' },
      allow_local_binding: true,
      dangerously_allow_all_unix_sockets: false,
    })
    expect(result.threadConfig.web_search).toBe('live')
    expect(result.threadConfig.features).toMatchObject({
      apps: true,
      plugins: true,
      hooks: true,
      browser_use: true,
      browser_use_external: true,
      browser_use_full_cdp_access: false,
      computer_use: true,
    })
    expect(result.threadConfig).not.toHaveProperty('mcp_servers')
  })

  it('keeps host file access independent from command networking', () => {
    const result = compileCodexManagedPermissions(
      enforcement('host-full', {}, 'win32'),
      workDir(),
    )
    expect(profile(result).filesystem).toMatchObject({
      ':root': 'write',
      [path.join(os.homedir(), '.shennian')]: 'deny',
      [path.join(os.homedir(), '.ssh')]: 'deny',
      [path.join(os.homedir(), '.aws')]: 'deny',
      [path.join(os.homedir(), '.netrc')]: 'deny',
      glob_scan_max_depth: 8,
      ':workspace_roots': {
        '.': 'write',
        '**/.env': 'deny',
        '**/*.key': 'deny',
      },
    })
    expect(profile(result)).not.toHaveProperty('extends')
    expect(profile(result).network).toMatchObject({
      enabled: true,
      domains: {},
      unix_sockets: {},
    })
    expect(result.threadConfig.windows).toEqual({ sandbox: 'elevated' })
  })

  it('denies the effective Shennian data directory even when SHENNIAN_HOME is customized', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-codex-home-'))
    tempDirs.push(parent)
    const canonicalHome = path.join(parent, 'canonical')
    const shennianHome = path.join(parent, 'configured')
    fs.mkdirSync(canonicalHome)
    fs.symlinkSync(canonicalHome, shennianHome, process.platform === 'win32' ? 'junction' : 'dir')
    vi.stubEnv('SHENNIAN_HOME', shennianHome)

    const result = compileCodexManagedPermissions(enforcement('host-full'), workDir())

    expect(profile(result).filesystem).toMatchObject({
      [shennianHome]: 'deny',
      [fs.realpathSync(canonicalHome)]: 'deny',
    })
  })

  it('omits impossible nested deny mounts when a workspace path component is a file', () => {
    const directory = workDir()
    fs.writeFileSync(path.join(directory, '.config'), 'project config')
    vi.spyOn(os, 'homedir').mockReturnValue(directory)

    const result = compileCodexManagedPermissions(enforcement('workspace-write', {}, 'linux'), directory)
    const filesystem = profile(result).filesystem as Record<string, unknown>
    const workspaceRules = filesystem[':workspace_roots'] as Record<string, unknown>

    expect(filesystem).not.toHaveProperty(path.join(directory, '.config', 'gcloud'))
    expect(workspaceRules).not.toHaveProperty('.config/gcloud')
    expect(workspaceRules['**/.config/gcloud']).toBe('deny')
    expect(workspaceRules['**/.env']).toBe('deny')
  })

  it('rejects a symlink or unavailable path instead of widening access', () => {
    const directory = workDir()
    const alias = `${directory}-alias`
    fs.symlinkSync(directory, alias)
    tempDirs.push(alias)

    expect(() => compileCodexManagedPermissions(enforcement('workspace-read'), alias)).toThrow(
      'codex_managed_workdir_not_realpath',
    )
    expect(() =>
      compileCodexManagedPermissions(enforcement('workspace-read'), `${directory}/missing`),
    ).toThrow('codex_managed_workdir_unavailable')
  })
})

describe('Codex permission profile protocol guards', () => {
  it('does not advertise unverified WSL or unsafe Windows file boundaries', () => {
    expect(CODEX_MANAGED_RUNTIME_SECURITY.platforms.wsl).toBeUndefined()
    expect(CODEX_MANAGED_RUNTIME_SECURITY.platforms.win32).toMatchObject({
      level: 'partial',
      fileAccess: {
        'workspace-read': false,
        'workspace-write': false,
        'host-full': false,
      },
      knownGaps: ['sandbox.nativeWindowsReadIsolationUnavailable'],
    })
  })

  it('extracts every configured MCP id exactly so none remain enabled', () => {
    expect(
      extractCodexMcpServerNames({
        config: {
          mcp_servers: {
            github: { enabled: true },
            filesystem: { enabled: true },
            'bad\nname': { enabled: true },
          },
        },
      }),
    ).toEqual(['bad\nname', 'filesystem', 'github'])
  })

  it('fails closed when config/read cannot prove the configured MCP set', () => {
    expect(() => extractCodexMcpServerNames({})).toThrow('codex_managed_config_read_invalid')
    expect(() => extractCodexMcpServerNames({ config: { mcp_servers: [] } })).toThrow(
      'codex_managed_config_read_invalid',
    )
  })

  it('fails closed unless app-server confirms the selected profile', () => {
    expect(() =>
      assertCodexManagedPermissionProfile({
        activePermissionProfile: { id: CODEX_MANAGED_PERMISSION_PROFILE_ID },
      }),
    ).not.toThrow()
    expect(() =>
      assertCodexManagedPermissionProfile({
        sandbox: { type: 'readOnly' },
      }),
    ).toThrow('codex_managed_permission_profile_unavailable')
  })
})
