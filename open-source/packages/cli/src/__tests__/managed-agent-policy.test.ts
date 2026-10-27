// @arch open-source/docs/cli-runtime.md
// @covers src/security/managed-agent-policy.ts
// @covers src/security/managed-agent-runtime.ts

import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_MANAGED_AGENT_PERMISSION_POLICY,
  type ManagedAgentPermissionPolicy,
} from '@shennian/wire'
import {
  compileManagedAgentPolicy,
} from '../security/managed-agent-policy.js'
import {
  collectPolicyEnforcementGaps,
  resolveManagedAgentRuntimeProtection,
  type ManagedAgentRuntimeSecurityDeclaration,
  type ManagedAgentRuntimeSecurityProfile,
} from '../security/managed-agent-runtime.js'

afterEach(() => vi.unstubAllEnvs())

const FULL_EXTERNAL_SUPPORT = {
  commandNetwork: { allow: true, deny: true },
  webSearch: { allow: true, deny: true },
  browser: { allow: true, deny: true },
  computerUse: { allow: true, deny: true },
  mcp: { allow: true, deny: true },
}

function securityDeclaration(
  profile: ManagedAgentRuntimeSecurityProfile,
): ManagedAgentRuntimeSecurityDeclaration {
  return {
    minimumRuntimeVersion: '1.0.0',
    maximumRuntimeVersionExclusive: '2.0.0',
    platforms: { darwin: profile, wsl: profile },
  }
}

function hardProfile(): ManagedAgentRuntimeSecurityProfile {
  return {
    level: 'hard',
    fileAccess: {
      'workspace-read': true,
      'workspace-write': true,
      'host-full': true,
    },
    externalCapabilities: structuredClone(FULL_EXTERNAL_SUPPORT),
  }
}

function policy(patch: Partial<ManagedAgentPermissionPolicy> = {}): ManagedAgentPermissionPolicy {
  return {
    ...structuredClone(DEFAULT_MANAGED_AGENT_PERMISSION_POLICY),
    ...patch,
  }
}

function compileInput(patch: Partial<Parameters<typeof compileManagedAgentPolicy>[0]> = {}) {
  const realWorkDir = path.resolve('/verified/workspace')
  return {
    agentType: 'codex' as const,
    runtimeVersion: '1.2.0',
    platform: 'darwin' as const,
    policy: policy(),
    workDir: path.resolve('/client/workspace'),
    securityDeclaration: securityDeclaration(hardProfile()),
    resolveWorkDir: async () => realWorkDir,
    ...patch,
  }
}

describe('managed Agent runtime resolver', () => {
  it('reports missing adapter evidence as unverified instead of inferring from provider name', () => {
    const protection = resolveManagedAgentRuntimeProtection({
      agentType: 'codex',
      runtimeVersion: '99.0.0',
      platform: 'darwin',
    })

    expect(protection).toEqual({
      level: 'unverified',
      runtimeVersion: '99.0.0',
      platform: 'darwin',
      unsupportedCapabilities: expect.arrayContaining([
        'fileAccess.workspaceRead',
        'fileAccess.workspaceWrite',
        'externalCapabilities.commandNetwork',
        'externalCapabilities.mcp',
      ]),
    })
  })

  it('requires a detected runtime version covered by the adapter declaration', () => {
    const declaration = securityDeclaration(hardProfile())

    expect(
      resolveManagedAgentRuntimeProtection({
        agentType: 'codex',
        runtimeVersion: '0.9.9',
        platform: 'darwin',
        securityDeclaration: declaration,
      }).level,
    ).toBe('unverified')
    expect(
      resolveManagedAgentRuntimeProtection({
        agentType: 'codex',
        platform: 'darwin',
        securityDeclaration: declaration,
      }).level,
    ).toBe('unverified')
    expect(
      resolveManagedAgentRuntimeProtection({
        agentType: 'codex',
        runtimeVersion: '2.0.0',
        platform: 'darwin',
        securityDeclaration: declaration,
      }).level,
    ).toBe('unverified')
  })

  it('does not advertise verified protection when the selected executable has no digest', () => {
    const declaration = securityDeclaration(hardProfile())
    const withoutFingerprint = resolveManagedAgentRuntimeProtection({
      agentType: 'codex',
      runtimeVersion: '1.2.0',
      platform: 'darwin',
      securityDeclaration: declaration,
      requireExecutableFingerprint: true,
    })
    const executableFingerprint = `sha256:${'a'.repeat(64)}`
    const withFingerprint = resolveManagedAgentRuntimeProtection({
      agentType: 'codex',
      runtimeVersion: '1.2.0',
      platform: 'darwin',
      securityDeclaration: declaration,
      requireExecutableFingerprint: true,
      executableFingerprint,
    })

    expect(withoutFingerprint.level).toBe('unverified')
    expect(withoutFingerprint.executableFingerprint).toBeUndefined()
    expect(withFingerprint).toMatchObject({ level: 'hard', executableFingerprint })
  })

  it('uses the separately declared WSL profile', () => {
    const protection = resolveManagedAgentRuntimeProtection({
      agentType: 'claude',
      runtimeVersion: '1.0.0',
      platform: 'linux',
      isWsl: true,
      securityDeclaration: securityDeclaration(hardProfile()),
    })

    expect(protection.level).toBe('hard')
    expect(protection.platform).toBe('wsl')
  })

  it('separates security overgrant from a requested capability that is unavailable', () => {
    const profile = hardProfile()
    profile.level = 'partial'
    profile.externalCapabilities.commandNetwork.deny = false
    profile.externalCapabilities.browser.allow = false

    const gaps = collectPolicyEnforcementGaps(
      policy({
        externalCapabilities: {
          ...policy().externalCapabilities,
          browser: true,
        },
      }),
      profile,
    )

    expect(gaps.overgrantedCapabilities).toContain('externalCapabilities.commandNetwork')
    expect(gaps.unavailableCapabilities).toContain('externalCapabilities.browser')
  })
})

describe('managed Agent policy compiler', () => {
  it('compiles native-full as an explicit ordinary-launch snapshot after confirmation', async () => {
    const result = await compileManagedAgentPolicy(
      compileInput({
        policy: policy({
          executionMode: 'native-full',
          fileAccess: 'host-full',
          externalCapabilities: {
            commandNetwork: true,
            webSearch: true,
            browser: true,
            computerUse: true,
            mcp: true,
          },
        }),
        hostFullAccessConfirmed: true,
      }),
    )

    expect(result).toMatchObject({
      ok: true,
      value: {
        executionMode: 'native-full',
        enforcement: { unsupportedCapabilities: [] },
      },
    })
  })

  it('compiles an immutable hard-enforcement snapshot from the verified real path', async () => {
    const executableFingerprint = `sha256:${'a'.repeat(64)}`
    const requestedPolicy = policy({ fileAccess: 'workspace-write' })
    const result = await compileManagedAgentPolicy(compileInput({
      executableFingerprint,
      policy: requestedPolicy,
    }))

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        enforcement: expect.objectContaining({
          level: 'hard',
          effectivePolicy: requestedPolicy,
          unsupportedCapabilities: [],
          runtimeVersion: '1.2.0',
          platform: 'darwin',
          executableFingerprint,
        }),
        adapterPolicy: {
          version: 1,
          workDir: path.resolve('/verified/workspace'),
          fileAccess: 'workspace-write',
          externalCapabilities: requestedPolicy.externalCapabilities,
          denySensitiveFiles: true,
          failClosed: true,
        },
        environmentPolicy: expect.objectContaining({
          inheritDaemonEnv: false,
          loadLoginShell: false,
          providerEnvKeys: ['OPENAI_BASE_URL', 'OPENAI_API_KEY'],
          sessionEnvKeys: expect.arrayContaining([
            'SHENNIAN_MANAGED_ROOM_CONTEXT',
            'SHENNIAN_MANAGER_SESSION_ID',
            'SHENNIAN_MANAGER_IPC_URL',
            'SHENNIAN_MANAGER_IPC_TOKEN',
          ]),
          shellSubprocess: expect.objectContaining({
            inherit: 'none',
            allowedEnvKeys: expect.arrayContaining([
              'PATH',
              'SHENNIAN_MANAGED_ROOM_CONTEXT',
              'SHENNIAN_MANAGER_SESSION_ID',
              'SHENNIAN_MANAGER_IPC_URL',
              'SHENNIAN_MANAGER_IPC_TOKEN',
            ]),
            deniedEnvKeys: ['OPENAI_BASE_URL', 'OPENAI_API_KEY'],
          }),
        }),
      }),
    })
  })

  it('fails closed for malformed policy input', async () => {
    const result = await compileManagedAgentPolicy(
      compileInput({
        policy: {
          version: 1,
          fileAccess: 'workspace-write',
          externalCapabilities: {},
        },
      }),
    )

    expect(result).toEqual({ ok: false, errorCode: 'managed_agent_policy_invalid' })
  })

  it('fails closed before runtime startup when the work directory is invalid or unavailable', async () => {
    await expect(
      compileManagedAgentPolicy(compileInput({ workDir: 'relative/project' })),
    ).resolves.toEqual({
      ok: false,
      errorCode: 'managed_agent_workdir_invalid',
    })
    await expect(
      compileManagedAgentPolicy(
        compileInput({
          resolveWorkDir: async () => {
            throw new Error('missing')
          },
        }),
      ),
    ).resolves.toEqual({
      ok: false,
      errorCode: 'managed_agent_workdir_unavailable',
    })
  })

  it('rejects a workspace that contains or sits inside the real credential root', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-policy-credentials-'))
    const workspace = path.join(root, 'workspace')
    const credentialRoot = path.join(workspace, '.private-shennian')
    const nestedWorkspace = path.join(credentialRoot, 'nested-workspace')
    fs.mkdirSync(nestedWorkspace, { recursive: true })
    vi.stubEnv('SHENNIAN_HOME', credentialRoot)

    try {
      await expect(
        compileManagedAgentPolicy(
          compileInput({ workDir: workspace, resolveWorkDir: async () => fs.realpathSync(workspace) }),
        ),
      ).resolves.toEqual({ ok: false, errorCode: 'managed_agent_workdir_invalid' })
      await expect(
        compileManagedAgentPolicy(
          compileInput({
            workDir: credentialRoot,
            resolveWorkDir: async () => fs.realpathSync(credentialRoot),
          }),
        ),
      ).resolves.toEqual({ ok: false, errorCode: 'managed_agent_workdir_invalid' })
      await expect(
        compileManagedAgentPolicy(
          compileInput({
            workDir: nestedWorkspace,
            resolveWorkDir: async () => fs.realpathSync(nestedWorkspace),
          }),
        ),
      ).resolves.toEqual({ ok: false, errorCode: 'managed_agent_workdir_invalid' })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('resolves a symlinked SHENNIAN_HOME before checking credential-root overlap', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-policy-symlink-'))
    const workspace = path.join(root, 'workspace')
    const credentialRoot = path.join(workspace, 'real-credentials')
    const credentialAlias = path.join(root, 'credential-alias')
    fs.mkdirSync(credentialRoot, { recursive: true })
    fs.symlinkSync(
      credentialRoot,
      credentialAlias,
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    vi.stubEnv('SHENNIAN_HOME', credentialAlias)

    try {
      await expect(
        compileManagedAgentPolicy(
          compileInput({
            workDir: workspace,
            resolveWorkDir: async () => fs.realpathSync(workspace),
          }),
        ),
      ).resolves.toEqual({ ok: false, errorCode: 'managed_agent_workdir_invalid' })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not let confirmed host-full access bypass credential-root overlap checks', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-policy-host-full-'))
    const credentialRoot = path.join(root, 'credentials')
    const workspace = path.join(credentialRoot, 'nested-workspace')
    fs.mkdirSync(workspace, { recursive: true })
    vi.stubEnv('SHENNIAN_HOME', credentialRoot)

    try {
      await expect(
        compileManagedAgentPolicy(
          compileInput({
            policy: policy({ fileAccess: 'host-full' }),
            hostFullAccessConfirmed: true,
            workDir: workspace,
            resolveWorkDir: async () => fs.realpathSync(workspace),
          }),
        ),
      ).resolves.toEqual({ ok: false, errorCode: 'managed_agent_workdir_invalid' })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('requires an explicit confirmation for host-wide file access', async () => {
    const result = await compileManagedAgentPolicy(
      compileInput({
        policy: policy({ fileAccess: 'host-full' }),
      }),
    )

    expect(result).toEqual({
      ok: false,
      errorCode: 'managed_agent_host_full_confirmation_required',
    })
  })

  it('allows confirmed host-full only when its workspace is disjoint from credential roots', async () => {
    const result = await compileManagedAgentPolicy(
      compileInput({
        policy: policy({ fileAccess: 'host-full' }),
        hostFullAccessConfirmed: true,
      }),
    )

    expect(result).toMatchObject({
      ok: true,
      value: {
        adapterPolicy: { fileAccess: 'host-full' },
        enforcement: { effectivePolicy: { fileAccess: 'host-full' } },
      },
    })
  })

  it('records a gap when an enabled capability cannot be provided', async () => {
    const profile = hardProfile()
    profile.externalCapabilities.browser.allow = false
    const result = await compileManagedAgentPolicy(
      compileInput({
        policy: policy({
          externalCapabilities: { ...policy().externalCapabilities, browser: true },
        }),
        securityDeclaration: securityDeclaration(profile),
      }),
    )

    expect(result).toMatchObject({ ok: true, value: { enforcement: {
      unsupportedCapabilities: ['externalCapabilities.browser'],
    } } })
  })

  it('records partial runtime gaps while preserving the requested ceiling', async () => {
    const profile = hardProfile()
    profile.level = 'partial'
    profile.externalCapabilities.commandNetwork.deny = false
    const result = await compileManagedAgentPolicy(
      compileInput({
        securityDeclaration: securityDeclaration(profile),
      }),
    )

    expect(result).toMatchObject({ ok: true, value: { enforcement: {
      level: 'partial',
      unsupportedCapabilities: ['runtime.hardIsolation', 'externalCapabilities.commandNetwork'],
    } } })
  })

  it('records native overgrant without widening the requested ceiling', async () => {
    const profile = hardProfile()
    profile.externalCapabilities.commandNetwork.deny = false
    const result = await compileManagedAgentPolicy(
      compileInput({
        securityDeclaration: securityDeclaration(profile),
        limitedProtectionConfirmed: true,
      }),
    )

    expect(result).toMatchObject({ ok: true, value: { enforcement: {
      unsupportedCapabilities: ['externalCapabilities.commandNetwork'],
    } } })
  })

  it('keeps missing hard isolation explicit after acknowledgement', async () => {
    const profile = hardProfile()
    profile.level = 'partial'
    profile.fileAccess['workspace-write'] = false
    profile.externalCapabilities.commandNetwork.deny = false
    const result = await compileManagedAgentPolicy(
      compileInput({
        securityDeclaration: securityDeclaration(profile),
        limitedProtectionConfirmed: true,
      }),
    )

    expect(result).toMatchObject({
      ok: true,
      value: { enforcement: { unsupportedCapabilities: expect.arrayContaining([
        'runtime.hardIsolation',
        'fileAccess.workspaceWrite',
        'externalCapabilities.commandNetwork',
      ]) } },
    })
  })

  it('marks an unregistered runtime unverified without inventing enforcement', async () => {
    const result = await compileManagedAgentPolicy(
      compileInput({
        securityDeclaration: undefined,
        limitedProtectionConfirmed: true,
      }),
    )

    expect(result).toMatchObject({
      ok: true,
      value: { enforcement: { level: 'unverified', unsupportedCapabilities: expect.arrayContaining([
        'runtime.hardIsolation',
        'fileAccess.workspaceRead',
        'fileAccess.workspaceWrite',
        'fileAccess.hostFull',
      ]) } },
    })
  })
})
