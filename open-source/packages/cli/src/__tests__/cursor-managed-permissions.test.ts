// @arch open-source/docs/cli-runtime.md
// @covers src/agents/cursor-managed-permissions.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ManagedAgentEnforcement } from '@shennian/wire'
import {
  compileCursorManagedPermissions,
  createCursorManagedConfigDirectory,
  CURSOR_MANAGED_RUNTIME_SECURITY,
  disposeCursorManagedConfigDirectory,
} from '../agents/cursor-managed-permissions.js'
import { resolveManagedAgentRuntimeProtection } from '../security/managed-agent-runtime.js'

const cleanupPaths: string[] = []

afterEach(() => {
  vi.unstubAllEnvs()
  for (const entry of cleanupPaths.splice(0)) {
    fs.rmSync(entry, { recursive: true, force: true })
  }
})

function workspace(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-managed-test-'))
  const resolved = fs.realpathSync(directory)
  cleanupPaths.push(resolved)
  return resolved
}

function enforcement(
  workDir: string,
  fileAccess: ManagedAgentEnforcement['effectivePolicy']['fileAccess'] = 'workspace-write',
  capabilities: Partial<ManagedAgentEnforcement['effectivePolicy']['externalCapabilities']> = {},
  platform = 'darwin',
): { workDir: string; value: ManagedAgentEnforcement } {
  return {
    workDir,
    value: {
      level: 'partial',
      effectivePolicy: {
        version: 3,
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
      unsupportedCapabilities: [],
      runtimeVersion: '2026.08.31-4057e58',
      platform,
    },
  }
}

describe('Cursor managed permissions', () => {
  it('declares Cursor as partial and reports the real workspace and MCP gaps', () => {
    const result = resolveManagedAgentRuntimeProtection({
      agentType: 'cursor',
      runtimeVersion: '2026.08.31-4057e58',
      platform: 'darwin',
      securityDeclaration: CURSOR_MANAGED_RUNTIME_SECURITY,
    })

    expect(result.level).toBe('partial')
    expect(result.unsupportedCapabilities).toEqual(expect.arrayContaining([
      'fileAccess.workspaceRead',
      'fileAccess.workspaceWrite',
      'fileAccess.workspaceBoundaryUnenforced',
      'fileAccess.outsideWorkspaceRead',
      'externalCapabilities.commandNetwork',
      'externalCapabilities.mcp',
      'externalCapabilities.projectMcpStartup',
      'externalCapabilities.browser',
      'externalCapabilities.computerUse',
    ]))
  })

  it('treats builds older than the evidence baseline as unverified', () => {
    const result = resolveManagedAgentRuntimeProtection({
      agentType: 'cursor',
      runtimeVersion: '2026.08.30-a1',
      platform: 'darwin',
      securityDeclaration: CURSOR_MANAGED_RUNTIME_SECURITY,
    })

    expect(result.level).toBe('unverified')
  })

  it('keeps Shell disabled while using best-effort workspace and WebFetch controls', () => {
    const { workDir, value } = enforcement(workspace(), 'workspace-write', {
      commandNetwork: false,
      webSearch: true,
      mcp: false,
    })
    const config = compileCursorManagedPermissions(value, workDir)
    const permissions = config.cliConfig.permissions as { allow: string[]; deny: string[] }

    expect(config.args).toEqual([
      '--trust',
      '--workspace',
      workDir,
      '--sandbox',
      'enabled',
    ])
    expect(config.sandboxConfig).toMatchObject({
      type: 'workspace_readwrite',
      readBoundary: 'workspace',
      disableTmpWrite: true,
      additionalReadwritePaths: [],
      additionalReadonlyPaths: [],
      networkPolicy: { default: 'deny', allow: [], deny: ['*'] },
    })
    expect(permissions.allow).toEqual(expect.arrayContaining([
      'Read(**)',
      'Write(**)',
      'WebFetch(*)',
    ]))
    expect(permissions.allow).not.toContain('Mcp(*:*)')
    expect(permissions.deny).toEqual(expect.arrayContaining([
      'Shell(*)',
      'Mcp(*:*)',
      'Read(.env)',
      'Read(**/.env.*)',
      `Read(${path.join(os.homedir(), '.shennian').replaceAll('\\', '/')}/**)`,
      `Write(${path.join(os.homedir(), '.shennian').replaceAll('\\', '/')}/**)`,
    ]))
  })

  it('uses Cursor ask mode plus a read-only sandbox for workspace-read', () => {
    const { workDir, value } = enforcement(workspace(), 'workspace-read')
    const config = compileCursorManagedPermissions(value, workDir)
    const permissions = config.cliConfig.permissions as { allow: string[]; deny: string[] }

    expect(config.args).toEqual(expect.arrayContaining(['--mode', 'ask']))
    expect(config.sandboxConfig).toMatchObject({ type: 'workspace_readonly' })
    expect(permissions.allow).not.toContain('Write(**)')
    expect(permissions.deny).toContain('Write(**)')
  })

  it('removes file tools from public visitor turns after real outside-read probes', () => {
    const { workDir, value } = enforcement(workspace(), 'workspace-read')
    const config = compileCursorManagedPermissions(value, workDir, { publicTurn: true })
    const permissions = config.cliConfig.permissions as { allow: string[]; deny: string[] }
    expect(permissions.allow).not.toContain('Read(**)')
    expect(permissions.deny).toEqual(expect.arrayContaining([
      'Read(**)', 'Write(**)', 'Shell(*)', 'Mcp(*:*)',
    ]))
    expect(config.sandboxConfig).toMatchObject({ type: 'workspace_readonly',
      networkPolicy: { default: 'deny' } })
  })

  it('rejects command networking because Cursor Shell can widen its own network grant', () => {
    const { workDir, value } = enforcement(workspace(), 'workspace-write', {
      commandNetwork: true,
      webSearch: false,
      mcp: false,
    })
    expect(() => compileCursorManagedPermissions(value, workDir))
      .toThrow('cursor_managed_command_network_unavailable')
  })

  it('rejects MCP because project discovery is not invocation-isolated', () => {
    const { workDir, value } = enforcement(workspace(), 'workspace-write', { mcp: true })
    expect(() => compileCursorManagedPermissions(value, workDir))
      .toThrow('cursor_managed_mcp_isolation_unavailable')
  })

  it('fails closed for combinations Cursor cannot enforce', () => {
    const directory = workspace()
    const browserEnabled = enforcement(directory, 'workspace-write', { browser: true })
    const nativeWindowsRestricted = enforcement(directory, 'workspace-write', {}, 'win32')

    expect(() => compileCursorManagedPermissions(browserEnabled.value, directory))
      .toThrow('cursor_managed_native_interactive_tool_control_unavailable')
    expect(() => compileCursorManagedPermissions(nativeWindowsRestricted.value, directory))
      .toThrow('cursor_managed_native_windows_sandbox_unavailable')
  })

  it('supports offline host-full through built-in file tools while keeping Shell denied', () => {
    const { workDir, value } = enforcement(workspace(), 'host-full')
    const config = compileCursorManagedPermissions(value, workDir)
    const permissions = config.cliConfig.permissions as { allow: string[]; deny: string[] }

    expect(config.args).toContain('--force')
    expect(config.args).toContain('disabled')
    expect(permissions.deny).toContain('Shell(*)')
    expect(config.cliConfig.sandbox).toMatchObject({ mode: 'disabled' })
  })

  it('denies a custom SHENNIAN_HOME nested below an allowed host root', () => {
    const directory = workspace()
    const customHome = path.join(directory, 'custom-product-state')
    const canonicalHome = path.join(directory, 'canonical-product-state')
    fs.mkdirSync(canonicalHome)
    fs.symlinkSync(canonicalHome, customHome, process.platform === 'win32' ? 'junction' : 'dir')
    vi.stubEnv('SHENNIAN_HOME', customHome)
    const { value } = enforcement(directory, 'host-full')
    const config = compileCursorManagedPermissions(value, directory)
    const permissions = config.cliConfig.permissions as { deny: string[] }
    const normalized = customHome.replaceAll('\\', '/')
    const canonical = fs.realpathSync(canonicalHome).replaceAll('\\', '/')

    expect(permissions.deny).toEqual(expect.arrayContaining([
      `Read(${normalized}/**)`,
      `Write(${normalized}/**)`,
      `Read(${canonical}/**)`,
      `Write(${canonical}/**)`,
    ]))
  })

  it('rejects a project sandbox that broadens access outside the workspace', () => {
    const directory = workspace()
    fs.mkdirSync(path.join(directory, '.cursor'))
    fs.writeFileSync(
      path.join(directory, '.cursor', 'sandbox.json'),
      JSON.stringify({ additionalReadonlyPaths: ['/private'] }),
    )
    const { value } = enforcement(directory)

    expect(() => compileCursorManagedPermissions(value, directory))
      .toThrow('cursor_managed_project_sandbox_broadens_access')
  })

  it('rejects workspace-read when a higher-priority project policy requests read/write', () => {
    const directory = workspace()
    fs.mkdirSync(path.join(directory, '.cursor'))
    fs.writeFileSync(
      path.join(directory, '.cursor', 'sandbox.json'),
      JSON.stringify({ type: 'workspace_readwrite' }),
    )
    const { value } = enforcement(directory, 'workspace-read')

    expect(() => compileCursorManagedPermissions(value, directory))
      .toThrow('cursor_managed_project_sandbox_broadens_access')
  })

  it('requires the daemon-resolved real workspace path', () => {
    const directory = workspace()
    const alias = `${directory}-alias`
    fs.symlinkSync(directory, alias)
    cleanupPaths.push(alias)
    const { value } = enforcement(directory)

    expect(() => compileCursorManagedPermissions(value, alias))
      .toThrow('cursor_managed_workdir_not_realpath')
  })

  it('writes private invocation-only config and removes only its own temp directory', async () => {
    const { workDir, value } = enforcement(workspace())
    const config = compileCursorManagedPermissions(value, workDir)
    const configDir = await createCursorManagedConfigDirectory(config)

    expect(path.basename(configDir)).toMatch(/^shennian-cursor-managed-/)
    expect(fs.statSync(configDir).mode & 0o777).toBe(0o700)
    expect(fs.statSync(path.join(configDir, 'cli-config.json')).mode & 0o777).toBe(0o600)
    expect(fs.statSync(path.join(configDir, 'sandbox.json')).mode & 0o777).toBe(0o600)
    expect(JSON.parse(fs.readFileSync(path.join(configDir, 'sandbox.json'), 'utf8')))
      .toEqual(config.sandboxConfig)

    await disposeCursorManagedConfigDirectory(configDir)
    expect(fs.existsSync(configDir)).toBe(false)
    await expect(disposeCursorManagedConfigDirectory(workDir))
      .rejects.toThrow('cursor_managed_config_cleanup_refused')
  })
})
