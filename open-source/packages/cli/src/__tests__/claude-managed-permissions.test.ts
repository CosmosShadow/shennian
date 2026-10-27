// @arch open-source/docs/cli-runtime.md
// @covers src/agents/claude-managed-permissions.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {
  ManagedAgentEnforcement,
  ManagedAgentFileAccess,
  ManagedAgentPermissionPolicy,
} from '@shennian/wire'
import {
  CLAUDE_MANAGED_RUNTIME_SECURITY,
  compileClaudeManagedPermissions,
} from '../agents/claude-managed-permissions.js'
import { resolveManagedRoomIpcPaths } from '../daemon-ipc/paths.js'
import { resolveManagedAgentRuntimeProtection } from '../security/managed-agent-runtime.js'

let workDir = ''

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'shennian-claude-policy-'))
})

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true })
})

function policy(
  fileAccess: ManagedAgentFileAccess,
  capabilities: Partial<ManagedAgentPermissionPolicy['externalCapabilities']> = {},
): ManagedAgentPermissionPolicy {
  return {
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
  }
}

function enforcement(
  fileAccess: ManagedAgentFileAccess,
  platform: ManagedAgentEnforcement['platform'] = 'darwin',
  capabilities: Partial<ManagedAgentPermissionPolicy['externalCapabilities']> = {},
): ManagedAgentEnforcement {
  return {
    level: platform === 'darwin' ? 'hard' : 'partial',
    effectivePolicy: policy(fileAccess, capabilities),
    unsupportedCapabilities: [],
    runtimeVersion: '2.1.260',
    platform,
  }
}

function permissionSettings(config: ReturnType<typeof compileClaudeManagedPermissions>) {
  return config.settings.permissions as {
    blockReadsOutsideWorkingDirectories: boolean
    allow: string[]
    deny: string[]
  }
}

function sandboxSettings(config: ReturnType<typeof compileClaudeManagedPermissions>) {
  return config.settings.sandbox as {
    enabled: boolean
    failIfUnavailable: boolean
    allowUnsandboxedCommands: boolean
    excludedCommands: string[]
    filesystem: {
      allowRead: string[]
      allowWrite: string[]
      denyRead: string[]
      denyWrite: string[]
    }
    network: {
      allowedDomains: string[]
      deniedDomains: string[]
      strictAllowlist: boolean
      allowLocalBinding: boolean
      allowUnixSockets: string[]
      allowAllUnixSockets: boolean
    }
    credentials: {
      files: Array<{ path: string; mode: string }>
      envVars: Array<{ name: string; mode: string }>
    }
  }
}

describe('Claude managed permissions', () => {
  it('keeps unknown and older Claude builds unverified', () => {
    expect(
      resolveManagedAgentRuntimeProtection({
        agentType: 'claude',
        runtimeVersion: undefined,
        platform: 'darwin',
        securityDeclaration: CLAUDE_MANAGED_RUNTIME_SECURITY,
      }).level,
    ).toBe('unverified')
    expect(
      resolveManagedAgentRuntimeProtection({
        agentType: 'claude',
        runtimeVersion: '2.1.259',
        platform: 'darwin',
        securityDeclaration: CLAUDE_MANAGED_RUNTIME_SECURITY,
      }).level,
    ).toBe('unverified')
    expect(
      resolveManagedAgentRuntimeProtection({
        agentType: 'claude',
        runtimeVersion: '2.1.260',
        platform: 'darwin',
        securityDeclaration: CLAUDE_MANAGED_RUNTIME_SECURITY,
      }).level,
    ).toBe('hard')
  })

  it('compiles workspace-read into a fail-closed macOS sandbox', () => {
    const config = compileClaudeManagedPermissions(enforcement('workspace-read'), workDir, {
      internalReadPaths: ['/var/run/shennian/daemon-ipc.secret'],
      internalUnixSockets: ['/var/run/shennian/daemon.sock'],
      shellSubprocessPolicy: {
        inherit: 'none',
        allowedEnvKeys: ['PATH', 'SHENNIAN_MANAGED_ROOM_CONTEXT', 'SHENNIAN_MANAGED_ROOM_IPC_ROOT'],
        deniedEnvKeys: ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'bad-key'],
      },
    })
    const permissions = permissionSettings(config)
    const sandbox = sandboxSettings(config)

    expect(config.args).toEqual(
      expect.arrayContaining([
        '--restricted',
        '--setting-sources',
        '',
        '--permission-mode',
        'dontAsk',
        '--no-chrome',
        '--strict-mcp-config',
      ]),
    )
    expect(config.args).not.toContain('--dangerously-skip-permissions')
    expect(config.args[config.args.indexOf('--tools') + 1]).toBe('Bash,Read,Glob,Grep,LSP')
    expect(permissions.blockReadsOutsideWorkingDirectories).toBe(true)
    expect(permissions.allow).not.toContain('Edit(/**)')
    expect(permissions.deny).toEqual(
      expect.arrayContaining([
        'Read(//**/.env)',
        'Edit(//**/*.key)',
        'Read(~/.shennian/**)',
        'Edit(~/.shennian/**)',
        'WebSearch',
        'WebFetch',
        'mcp__*',
      ]),
    )
    expect(sandbox).toMatchObject({
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      excludedCommands: [],
      network: {
        allowedDomains: [],
        deniedDomains: ['*'],
        strictAllowlist: true,
        allowLocalBinding: false,
        allowUnixSockets: ['/var/run/shennian/daemon.sock'],
        allowAllUnixSockets: false,
      },
    })
    expect(sandbox.filesystem.allowRead).toEqual(
      expect.arrayContaining([workDir, '/var/run/shennian/daemon-ipc.secret']),
    )
    expect(sandbox.filesystem.denyRead).toContain('~/.shennian')
    expect(sandbox.filesystem.denyWrite).toContain('~/.shennian')
    expect(sandbox.filesystem.allowWrite).toEqual([])
    expect(sandbox.filesystem.denyWrite).toContain(workDir)
    expect(sandbox.credentials.files).toContainEqual({ path: '/**/.env', mode: 'deny' })
    expect(sandbox.credentials.envVars).toEqual([
      { name: 'ANTHROPIC_API_KEY', mode: 'deny' },
      { name: 'ANTHROPIC_BASE_URL', mode: 'deny' },
    ])
  })

  it('allows writes only in the workspace and keeps sensitive files denied', () => {
    const config = compileClaudeManagedPermissions(enforcement('workspace-write'), workDir)
    const permissions = permissionSettings(config)
    const sandbox = sandboxSettings(config)

    expect(permissions.allow).toContain('Edit(/**)')
    expect(sandbox.filesystem.allowWrite).toEqual([workDir])
    expect(sandbox.filesystem.denyWrite).not.toContain(workDir)
    expect(sandbox.filesystem.denyRead).toEqual(expect.arrayContaining(['/**/.env', '~/.ssh']))
  })

  it('keeps the Shennian home denied while restoring only exact Room IPC reads', () => {
    const ipc = resolveManagedRoomIpcPaths(undefined, 'darwin')
    const secret = ipc.secretFile
    const socket = ipc.endpoint
    expect(path.resolve(secret).startsWith(path.join(os.homedir(), '.shennian'))).toBe(false)
    const config = compileClaudeManagedPermissions(enforcement('workspace-read'), workDir, {
      internalReadPaths: [secret, socket],
      internalUnixSockets: [socket],
    })
    const permissions = permissionSettings(config)
    const sandbox = sandboxSettings(config)

    expect(permissions.deny).toEqual(
      expect.arrayContaining(['Read(~/.shennian/**)', 'Edit(~/.shennian/**)']),
    )
    expect(sandbox.filesystem.denyRead).toContain('~/.shennian')
    expect(sandbox.filesystem.denyWrite).toContain('~/.shennian')
    expect(sandbox.filesystem.allowRead).toEqual(
      expect.arrayContaining([secret.replaceAll('\\', '/'), socket.replaceAll('\\', '/')]),
    )
    expect(sandbox.network.allowUnixSockets).toEqual([socket.replaceAll('\\', '/')])
  })

  it('denies a custom SHENNIAN_HOME nested below an otherwise allowed workspace', () => {
    const customHome = path.join(workDir, 'custom-product-state')
    const canonicalHome = path.join(workDir, 'canonical-product-state')
    fs.mkdirSync(canonicalHome, { recursive: true })
    fs.symlinkSync(canonicalHome, customHome, process.platform === 'win32' ? 'junction' : 'dir')
    const previous = process.env.SHENNIAN_HOME
    process.env.SHENNIAN_HOME = customHome
    try {
      const config = compileClaudeManagedPermissions(enforcement('workspace-write'), workDir)
      const normalized = customHome.replaceAll('\\', '/')
      const canonical = fs.realpathSync(canonicalHome).replaceAll('\\', '/')
      const permissionPattern = normalized.startsWith('/') ? `/${normalized}` : `//${normalized}`
      const canonicalPermissionPattern = canonical.startsWith('/') ? `/${canonical}` : `//${canonical}`
      const permissions = permissionSettings(config)
      const sandbox = sandboxSettings(config)

      expect(permissions.deny).toEqual(expect.arrayContaining([
        `Read(${permissionPattern}/**)`,
        `Edit(${permissionPattern}/**)`,
        `Read(${canonicalPermissionPattern}/**)`,
        `Edit(${canonicalPermissionPattern}/**)`,
      ]))
      expect(sandbox.filesystem.denyRead).toContain(normalized)
      expect(sandbox.filesystem.denyWrite).toContain(normalized)
      expect(sandbox.filesystem.denyRead).toContain(canonical)
      expect(sandbox.filesystem.denyWrite).toContain(canonical)
    } finally {
      if (previous === undefined) delete process.env.SHENNIAN_HOME
      else process.env.SHENNIAN_HOME = previous
    }
  })

  it('requires an explicit root addition for host-full while retaining secret denies', () => {
    const config = compileClaudeManagedPermissions(enforcement('host-full'), workDir)
    const permissions = permissionSettings(config)
    const sandbox = sandboxSettings(config)
    const root = path.parse(workDir).root.replaceAll('\\', '/')

    expect(permissions.blockReadsOutsideWorkingDirectories).toBe(false)
    expect(permissions.allow).toEqual(expect.arrayContaining(['Read', 'Edit']))
    expect(
      config.args.slice(config.args.indexOf('--add-dir'), config.args.indexOf('--add-dir') + 2),
    ).toEqual(['--add-dir', root])
    expect(sandbox.filesystem.allowWrite).toEqual([root])
    expect(sandbox.credentials.files).toContainEqual({ path: '~/.ssh', mode: 'deny' })
    expect(sandbox.credentials.files).not.toContainEqual({ path: '~/.shennian', mode: 'deny' })
  })

  it('enables each supported external surface without widening the others', () => {
    const config = compileClaudeManagedPermissions(
      enforcement('workspace-write', 'darwin', {
        commandNetwork: true,
        webSearch: true,
        browser: true,
        mcp: true,
      }),
      workDir,
    )
    const permissions = permissionSettings(config)
    const sandbox = sandboxSettings(config)

    expect(sandbox.network.allowedDomains).toEqual(['*'])
    expect(sandbox.network.deniedDomains).toEqual([])
    expect(sandbox.network.allowLocalBinding).toBe(true)
    expect(permissions.allow).toEqual(expect.arrayContaining(['WebSearch', 'WebFetch', 'mcp__*']))
    expect(config.args).toContain('--chrome')
    expect(config.args).not.toContain('--strict-mcp-config')
  })

  it('reports Linux/WSL socket granularity and native Windows as limited protection', () => {
    expect(CLAUDE_MANAGED_RUNTIME_SECURITY.platforms.linux).toMatchObject({
      level: 'partial',
      knownGaps: ['internalTransport.unixSocketGranularity'],
    })
    expect(CLAUDE_MANAGED_RUNTIME_SECURITY.platforms.wsl).toMatchObject({
      level: 'partial',
      knownGaps: ['internalTransport.unixSocketGranularity'],
    })
    expect(CLAUDE_MANAGED_RUNTIME_SECURITY.platforms.win32).toMatchObject({
      level: 'partial',
      fileAccess: { 'workspace-read': false, 'workspace-write': false, 'host-full': true },
      externalCapabilities: { commandNetwork: { allow: true, deny: false } },
    })

    const linux = compileClaudeManagedPermissions(
      enforcement('workspace-write', 'linux'),
      workDir,
      { internalUnixSockets: ['/var/run/shennian/daemon.sock'] },
    )
    expect(sandboxSettings(linux).network.allowAllUnixSockets).toBe(true)

    const windows = compileClaudeManagedPermissions(
      enforcement('host-full', 'win32', { commandNetwork: true }),
      workDir,
    )
    expect(windows.settings.sandbox).toBeUndefined()
    expect(permissionSettings(windows).allow).toEqual(
      expect.arrayContaining(['Bash', 'PowerShell']),
    )
    expect(windows.args).not.toContain('--dangerously-skip-permissions')
  })

  it('rejects a non-realpath workspace instead of broadening access', () => {
    expect(() =>
      compileClaudeManagedPermissions(
        enforcement('workspace-write'),
        path.join(workDir, 'missing'),
      ),
    ).toThrow('claude_managed_workdir_unavailable')
  })
})
