// @arch open-source/docs/cli-runtime.md
// @covers src/agents/workbuddy-managed-permissions.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ManagedAgentEnforcement,
  ManagedAgentExternalCapabilities,
} from '@shennian/wire'
import { resolveManagedAgentRuntimeProtection } from '../security/managed-agent-runtime.js'
import {
  compileWorkBuddyManagedPermissions,
  createWorkBuddyManagedConfigFiles,
  disposeWorkBuddyManagedConfigFiles,
  WORKBUDDY_MANAGED_RUNTIME_SECURITY,
} from '../agents/workbuddy-managed-permissions.js'

const cleanup = new Set<string>()

afterEach(async () => {
  vi.unstubAllEnvs()
  for (const directory of cleanup) {
    await fs.promises.rm(directory, { recursive: true, force: true })
  }
  cleanup.clear()
})

function createWorkDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workbuddy-managed-test-'))
  cleanup.add(directory)
  return fs.realpathSync(directory)
}

function capabilities(
  input: Partial<ManagedAgentExternalCapabilities> = {},
): ManagedAgentExternalCapabilities {
  return {
    commandNetwork: false,
    webSearch: false,
    browser: false,
    computerUse: false,
    mcp: false,
    ...input,
  }
}

function enforcement(input: {
  fileAccess?: ManagedAgentEnforcement['effectivePolicy']['fileAccess']
  externalCapabilities?: Partial<ManagedAgentExternalCapabilities>
  platform?: string
  level?: ManagedAgentEnforcement['level']
} = {}): ManagedAgentEnforcement {
  return {
    level: input.level ?? 'partial',
    effectivePolicy: {
      version: 1,
      fileAccess: input.fileAccess ?? 'workspace-write',
      externalCapabilities: capabilities(input.externalCapabilities),
    },
    unsupportedCapabilities: [],
    runtimeVersion: '2.115.0',
    platform: input.platform ?? 'darwin',
  }
}

function object(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>
}

describe('WorkBuddy managed permissions', () => {
  it('declares the verified WorkBuddy baseline honestly as partial', () => {
    const result = resolveManagedAgentRuntimeProtection({
      agentType: 'workbuddy',
      runtimeVersion: '2.115.0',
      platform: 'darwin',
      securityDeclaration: WORKBUDDY_MANAGED_RUNTIME_SECURITY,
    })

    expect(result.level).toBe('partial')
    expect(result.unsupportedCapabilities).toEqual(expect.arrayContaining([
      'externalCapabilities.browser',
      'externalCapabilities.mcp',
      'fileAccess.outsideWorkspaceRead',
      'fileAccess.sandboxRuntimeWriteAllowlist',
    ]))
  })

  it('uses the native sandbox without bypass or mutable setting sources', () => {
    const workDir = createWorkDir()
    const config = compileWorkBuddyManagedPermissions(
      enforcement(),
      workDir,
      { internalUnixSockets: ['/private/tmp/shennian/daemon.sock'] },
    )
    const permissions = object(config.settings.permissions)
    const sandbox = object(config.settings.sandbox)
    const network = object(sandbox.network)
    const filesystem = object(sandbox.filesystem)

    expect(permissions).toMatchObject({
      defaultMode: 'dontAsk',
      disableBypassPermissionsMode: 'disable',
      additionalDirectories: [],
      ask: [],
    })
    expect(permissions.allow).toEqual(expect.arrayContaining([
      'Bash',
      `Edit(${workDir.replace(/\\/g, '/')}/**)`,
      `Write(${workDir.replace(/\\/g, '/')}/**)`,
    ]))
    expect(permissions.deny).toEqual(expect.arrayContaining([
      'Agent',
      'Skill',
      'WebFetch',
      'ComputerUse',
      'Read(**/.env)',
    ]))
    expect(sandbox).toMatchObject({
      enabled: true,
      excludedCommands: [],
      allowUnsandboxedCommands: false,
      enableWeakerNestedSandbox: false,
    })
    expect(network).toMatchObject({
      allowedDomains: [],
      deniedDomains: ['*'],
      allowLocalBinding: false,
      allowUnixSockets: ['/private/tmp/shennian/daemon.sock'],
      allowAllUnixSockets: false,
    })
    expect(filesystem.allowWrite).toEqual([workDir])
    expect(filesystem.denyRead).toEqual(expect.arrayContaining([
      '**/.env',
      '~/.ssh/**',
      '~/.shennian/**',
    ]))
    expect(filesystem.denyWrite).toContain('~/.shennian/**')
    expect(permissions.deny).toEqual(expect.arrayContaining([
      'Read(~/.shennian/**)',
      'Edit(~/.shennian/**)',
      'Write(~/.shennian/**)',
    ]))
    expect(config.runtimeEnv).toMatchObject({
      CODEBUDDY_DISABLE_SHELL_SNAPSHOT: '1',
      CODEBUDDY_COMPUTER_USE_ENABLED: '0',
      CODEBUDDY_DISABLE_AUTO_MEMORY: '1',
    })
    expect(config.runtimeEnv.CODEBUDDY_IS_SANDBOX).toBeUndefined()
  })

  it('denies a custom SHENNIAN_HOME nested below an otherwise writable workspace', () => {
    const workDir = createWorkDir()
    const customHome = path.join(workDir, 'custom-product-state')
    const canonicalHome = path.join(workDir, 'canonical-product-state')
    fs.mkdirSync(canonicalHome)
    fs.symlinkSync(canonicalHome, customHome, process.platform === 'win32' ? 'junction' : 'dir')
    vi.stubEnv('SHENNIAN_HOME', customHome)
    const config = compileWorkBuddyManagedPermissions(enforcement(), workDir)
    const permissions = object(config.settings.permissions)
    const filesystem = object(object(config.settings.sandbox).filesystem)
    const normalized = customHome.replaceAll('\\', '/')
    const canonical = fs.realpathSync(canonicalHome).replaceAll('\\', '/')
    const permissionPath = normalized.startsWith('/') ? `/${normalized}` : `//${normalized}`
    const canonicalPermissionPath = canonical.startsWith('/') ? `/${canonical}` : `//${canonical}`

    expect(filesystem.denyRead).toContain(`${normalized}/**`)
    expect(filesystem.denyWrite).toContain(`${normalized}/**`)
    expect(filesystem.denyRead).toContain(`${canonical}/**`)
    expect(filesystem.denyWrite).toContain(`${canonical}/**`)
    expect(permissions.deny).toEqual(expect.arrayContaining([
      `Read(${permissionPath}/**)`,
      `Edit(${permissionPath}/**)`,
      `Write(${permissionPath}/**)`,
      `Read(${canonicalPermissionPath}/**)`,
      `Edit(${canonicalPermissionPath}/**)`,
      `Write(${canonicalPermissionPath}/**)`,
    ]))
  })

  it('denies workspace writes in read-only mode at both tool and sandbox layers', () => {
    const workDir = createWorkDir()
    const config = compileWorkBuddyManagedPermissions(
      enforcement({ fileAccess: 'workspace-read' }),
      workDir,
    )
    const permissions = object(config.settings.permissions)
    const filesystem = object(object(config.settings.sandbox).filesystem)

    expect(config.toolNames).not.toEqual(expect.arrayContaining(['Edit', 'Write']))
    expect(permissions.deny).toEqual(expect.arrayContaining(['Edit', 'Write', 'NotebookEdit']))
    expect(filesystem.allowWrite).toEqual([])
    expect(filesystem.denyWrite).toEqual(expect.arrayContaining([workDir]))
  })

  it('removes host file and shell tools from public visitor turns', () => {
    const workDir = createWorkDir()
    const config = compileWorkBuddyManagedPermissions(
      enforcement({ fileAccess: 'workspace-read' }), workDir, { publicTurn: true },
    )
    const permissions = object(config.settings.permissions)
    expect(config.toolNames).toEqual([])
    expect(permissions.allow).toEqual([])
    expect(permissions.deny).toEqual(expect.arrayContaining([
      'Read', 'Glob', 'Grep', 'LSP', 'Bash', 'TaskOutput', 'TaskStop', 'Write',
    ]))
    expect(() => compileWorkBuddyManagedPermissions(
      enforcement(), workDir, { publicTurn: true },
    )).toThrow('workbuddy_public_turn_policy_invalid')
    expect(() => compileWorkBuddyManagedPermissions(
      enforcement({ fileAccess: 'workspace-read' }), workDir,
      { publicTurn: true, internalUnixSockets: ['/tmp/daemon.sock'] },
    )).toThrow('workbuddy_public_turn_policy_invalid')
  })

  it('separates command networking, web search, and macOS computer use', () => {
    const workDir = createWorkDir()
    const config = compileWorkBuddyManagedPermissions(
      enforcement({
        externalCapabilities: {
          commandNetwork: true,
          webSearch: true,
          computerUse: true,
        },
      }),
      workDir,
    )
    const sandbox = object(config.settings.sandbox)
    const network = object(sandbox.network)

    expect(network).toMatchObject({
      allowedDomains: ['*'],
      deniedDomains: [],
      allowLocalBinding: true,
    })
    expect(config.toolNames).toEqual(expect.arrayContaining(['Bash', 'WebSearch', 'WebFetch', 'ComputerUse']))
    expect(config.runtimeEnv.CODEBUDDY_COMPUTER_USE_ENABLED).toBe('1')
  })

  it('fails closed for capabilities the non-interactive adapter cannot isolate', () => {
    const workDir = createWorkDir()

    expect(() => compileWorkBuddyManagedPermissions(
      enforcement({ externalCapabilities: { browser: true } }),
      workDir,
    )).toThrow('workbuddy_managed_browser_unavailable')
    expect(() => compileWorkBuddyManagedPermissions(
      enforcement({ externalCapabilities: { mcp: true } }),
      workDir,
    )).toThrow('workbuddy_managed_mcp_isolation_unavailable')
    expect(() => compileWorkBuddyManagedPermissions(
      enforcement({ platform: 'linux', externalCapabilities: { computerUse: true } }),
      workDir,
    )).toThrow('workbuddy_managed_computer_use_unavailable')
    expect(() => compileWorkBuddyManagedPermissions(
      enforcement({ level: 'unverified' }),
      workDir,
    )).toThrow('workbuddy_managed_runtime_unverified')
  })

  it('keeps Windows explicitly partial and never pretends to enable a sandbox', () => {
    const workDir = createWorkDir()
    const protection = resolveManagedAgentRuntimeProtection({
      agentType: 'workbuddy',
      runtimeVersion: '2.115.0',
      platform: 'win32',
      securityDeclaration: WORKBUDDY_MANAGED_RUNTIME_SECURITY,
    })
    const config = compileWorkBuddyManagedPermissions(
      enforcement({ platform: 'win32' }),
      workDir,
    )

    expect(protection.level).toBe('partial')
    expect(protection.unsupportedCapabilities).toEqual(expect.arrayContaining([
      'sandbox.nativeWindowsUnavailable',
      'fileAccess.shellUncontained',
      'externalCapabilities.commandNetwork',
    ]))
    expect(object(config.settings.sandbox).enabled).toBe(false)
    expect(object(config.settings.permissions).disableBypassPermissionsMode).toBe('disable')
  })

  it('fails closed when host-full cannot preserve the requested network denial', () => {
    const workDir = createWorkDir()

    expect(() => compileWorkBuddyManagedPermissions(
      enforcement({ fileAccess: 'host-full' }),
      workDir,
    )).toThrow('workbuddy_managed_host_full_network_isolation_unavailable')

    const config = compileWorkBuddyManagedPermissions(
      enforcement({
        fileAccess: 'host-full',
        externalCapabilities: { commandNetwork: true },
      }),
      workDir,
    )
    expect(object(config.settings.sandbox).enabled).toBe(false)
  })

  it('creates a private invocation-only settings file and cleans it safely', async () => {
    const workDir = createWorkDir()
    const config = compileWorkBuddyManagedPermissions(enforcement(), workDir)
    const files = await createWorkBuddyManagedConfigFiles(config)
    cleanup.add(files.directory)
    const stat = await fs.promises.stat(files.settingsPath)
    const parsed = JSON.parse(await fs.promises.readFile(files.settingsPath, 'utf8')) as Record<string, unknown>
    const filesystem = object(object(parsed.sandbox).filesystem)

    expect(stat.mode & 0o777).toBe(0o600)
    expect(files.directory).toContain(`${path.sep}shennian-workbuddy-managed-`)
    expect(filesystem.denyRead).toEqual(expect.arrayContaining([
      `${files.directory.replace(/\\/g, '/')}/**`,
    ]))

    await disposeWorkBuddyManagedConfigFiles(files.directory)
    cleanup.delete(files.directory)
    await expect(fs.promises.stat(files.directory)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(disposeWorkBuddyManagedConfigFiles(workDir)).rejects.toThrow(
      'workbuddy_managed_config_cleanup_refused',
    )
  })
})
