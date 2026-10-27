// @arch open-source/docs/cli-runtime.md
// @covers src/agents/opencode-managed-permissions.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManagedAgentEnforcement, ManagedAgentPermissionPolicy } from '@shennian/wire'
import {
  compileOpenCodeManagedPermissions,
  createOpenCodeManagedConfigDirectory,
  disposeOpenCodeManagedConfigDirectory,
  OPENCODE_MANAGED_RUNTIME_SECURITY,
} from '../agents/opencode-managed-permissions.js'
import { resolveManagedAgentRuntimeProtection } from '../security/managed-agent-runtime.js'

function enforcement(
  fileAccess: ManagedAgentPermissionPolicy['fileAccess'],
  webSearch = false,
): ManagedAgentEnforcement {
  return {
    level: 'partial',
    effectivePolicy: {
      version: 1,
      fileAccess,
      externalCapabilities: {
        commandNetwork: false,
        webSearch,
        browser: false,
        computerUse: false,
        mcp: false,
      },
    },
    unsupportedCapabilities: ['sandbox.toolPermissionOnly'],
    runtimeVersion: '1.18.26',
    platform: process.platform,
  }
}

describe('OpenCode managed tool permissions', () => {
  let workDir: string

  beforeEach(() => {
    workDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-opencode-policy-test-')),
    )
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    fs.rmSync(workDir, { recursive: true, force: true })
  })

  it('honestly resolves as partial rather than an OS sandbox', () => {
    expect(
      resolveManagedAgentRuntimeProtection({
        agentType: 'opencode',
        runtimeVersion: '1.18.26',
        securityDeclaration: OPENCODE_MANAGED_RUNTIME_SECURITY,
      }),
    ).toMatchObject({
      level: 'partial',
      unsupportedCapabilities: expect.arrayContaining([
        'sandbox.toolPermissionOnly',
        'externalCapabilities.commandNetwork',
        'externalCapabilities.mcp',
      ]),
    })
    expect(
      resolveManagedAgentRuntimeProtection({
        agentType: 'opencode',
        runtimeVersion: '1.19.0',
        securityDeclaration: OPENCODE_MANAGED_RUNTIME_SECURITY,
      }),
    ).toMatchObject({ level: 'unverified' })
    expect(
      resolveManagedAgentRuntimeProtection({
        agentType: 'opencode',
        runtimeVersion: '2.0.0',
        securityDeclaration: OPENCODE_MANAGED_RUNTIME_SECURITY,
      }),
    ).toMatchObject({ level: 'unverified' })
  })

  it('allows workspace reads but denies edits, shell, network tools and sensitive files', () => {
    const result = compileOpenCodeManagedPermissions(enforcement('workspace-read'), workDir)
    const permission = result.config.permission as Record<string, unknown>

    expect(result.args).toEqual(['--pure', '--auto'])
    expect(result.config).toMatchObject({
      default_agent: 'build',
      share: 'disabled',
      subagent_depth: 0,
      autoupdate: false,
      formatter: false,
      lsp: false,
      agent: { build: { permission: { bash: 'deny', task: 'deny' } } },
    })
    expect(permission).toMatchObject({
      '*': 'deny',
      edit: 'deny',
      external_directory: 'deny',
      bash: 'deny',
      webfetch: 'deny',
      websearch: 'deny',
      task: 'deny',
      skill: 'deny',
    })
    expect(permission.lsp).toBeUndefined()
    expect(permission.read).toMatchObject({
      '*': 'allow',
      '**/.env': 'deny',
      '~/.ssh/**': 'deny',
      '~/.shennian/**': 'deny',
      [`${path.join(os.homedir(), '.shennian').replaceAll('\\', '/')}/**`]: 'deny',
    })
  })

  it('keeps an invocation prompt in the native agent config instead of the visitor message', () => {
    const result = compileOpenCodeManagedPermissions(enforcement('workspace-read'), workDir, {
      systemPrompt: 'Answer only from the current isolated workspace.', publicTurn: true,
    })
    expect(result.config.agent).toMatchObject({ build: {
      prompt: 'Answer only from the current isolated workspace.',
      permission: { read: 'deny', glob: 'deny', grep: 'deny', list: 'deny',
        edit: 'deny', bash: 'deny', external_directory: 'deny' },
    } })
  })

  it('maps workspace writes and web search without enabling unknown tools', () => {
    const result = compileOpenCodeManagedPermissions(enforcement('workspace-write', true), workDir)
    const permission = result.config.permission as Record<string, unknown>

    expect(permission.edit).toMatchObject({ '*': 'allow', '**/*.pem': 'deny' })
    expect(permission).toMatchObject({
      '*': 'deny',
      external_directory: 'deny',
      bash: 'deny',
      webfetch: 'allow',
      websearch: 'allow',
      codesearch: 'allow',
    })
  })

  it('denies a custom SHENNIAN_HOME nested below an otherwise writable workspace', () => {
    const customHome = path.join(workDir, 'custom-product-state')
    const canonicalHome = path.join(workDir, 'canonical-product-state')
    fs.mkdirSync(canonicalHome)
    fs.symlinkSync(canonicalHome, customHome, process.platform === 'win32' ? 'junction' : 'dir')
    vi.stubEnv('SHENNIAN_HOME', customHome)
    const result = compileOpenCodeManagedPermissions(enforcement('workspace-write'), workDir)
    const permission = result.config.permission as Record<string, unknown>
    const read = permission.read as Record<string, unknown>
    const edit = permission.edit as Record<string, unknown>
    const normalized = `${customHome.replaceAll('\\', '/')}/**`
    const canonical = `${fs.realpathSync(canonicalHome).replaceAll('\\', '/')}/**`

    expect(read[normalized]).toBe('deny')
    expect(edit[normalized]).toBe('deny')
    expect(read[canonical]).toBe('deny')
    expect(edit[canonical]).toBe('deny')
  })

  it('refuses capabilities OpenCode cannot isolate', () => {
    const withCapability = (capability: 'commandNetwork' | 'browser' | 'mcp') => {
      const value = enforcement('workspace-write')
      value.effectivePolicy.externalCapabilities[capability] = true
      return value
    }

    expect(() =>
      compileOpenCodeManagedPermissions(withCapability('commandNetwork'), workDir),
    ).toThrow('opencode_managed_command_network_unavailable')
    expect(() => compileOpenCodeManagedPermissions(withCapability('browser'), workDir)).toThrow(
      'opencode_managed_interactive_tools_unavailable',
    )
    expect(() => compileOpenCodeManagedPermissions(withCapability('mcp'), workDir)).toThrow(
      'opencode_managed_mcp_allowlist_unavailable',
    )
  })

  it('creates private temporary config and refuses broad cleanup targets', async () => {
    const config = compileOpenCodeManagedPermissions(enforcement('workspace-write'), workDir)
    const isolated = await createOpenCodeManagedConfigDirectory(config)

    expect(JSON.parse(fs.readFileSync(isolated.configPath, 'utf8'))).toMatchObject({
      permission: { bash: 'deny', external_directory: 'deny' },
      plugin: [],
    })
    if (process.platform !== 'win32') {
      expect(fs.statSync(isolated.directory).mode & 0o777).toBe(0o700)
      expect(fs.statSync(isolated.configPath).mode & 0o777).toBe(0o600)
      expect(fs.statSync(isolated.cacheDir).mode & 0o777).toBe(0o700)
      expect(fs.statSync(isolated.stateDir).mode & 0o777).toBe(0o700)
    }
    expect(isolated.cacheDir).not.toBe(isolated.stateDir)
    expect(path.dirname(isolated.cacheDir)).toBe(isolated.directory)
    expect(path.dirname(isolated.stateDir)).toBe(isolated.directory)
    await expect(disposeOpenCodeManagedConfigDirectory(workDir)).rejects.toThrow(
      'opencode_managed_config_cleanup_refused',
    )
    await disposeOpenCodeManagedConfigDirectory(isolated.directory)
    expect(fs.existsSync(isolated.directory)).toBe(false)
    expect(fs.existsSync(isolated.cacheDir)).toBe(false)
    expect(fs.existsSync(isolated.stateDir)).toBe(false)
  })
})
