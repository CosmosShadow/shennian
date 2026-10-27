// @covers src/room/activation-service.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  ManagedAgentPermissionConfirmation,
  ManagedAgentPermissionPolicy,
  ManagedAgentRuntimeProtection,
} from '@shennian/wire'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  managedAgentPermissionConfirmationMatches,
  resolveManagedAgentPolicy,
} from '../room/activation-service.js'
import type { RoomSessionRegistration } from '../room/session-registry.js'
import type { CustomAgentEntry } from '../config/index.js'
import { resolveCustomRuntimeExecutableFingerprint } from '../agents/custom-managed-runtime.js'
import { testPermissionPolicy } from './room-activation-test-fixtures.js'

const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('managed Agent permission confirmation binding', () => {
  const fingerprint = `sha256:${'a'.repeat(64)}`
  const basePolicy = testPermissionPolicy()
  const baseProtection: ManagedAgentRuntimeProtection = {
    level: 'hard',
    runtimeVersion: '0.152.1',
    platform: 'darwin',
    executableFingerprint: fingerprint,
    unsupportedCapabilities: [],
  }
  const baseConfirmation: ManagedAgentPermissionConfirmation = {
    policyVersion: basePolicy.version,
    runtimeAdapter: 'codex',
    runtimeVersion: baseProtection.runtimeVersion,
    platform: baseProtection.platform,
    executableFingerprint: fingerprint,
    hostFullAccess: false,
    limitedProtection: false,
    confirmedAt: '2026-09-05T00:00:00.000Z',
  }

  it('keeps confirmation across runtime upgrades while binding policy and Agent type', () => {
    expect(
      managedAgentPermissionConfirmationMatches({
        confirmation: baseConfirmation,
        policy: basePolicy,
        runtimeAdapter: 'codex',
        protection: baseProtection,
      }),
    ).toBe(true)

    const mismatches: Array<{
      confirmation?: ManagedAgentPermissionConfirmation
      policy?: ManagedAgentPermissionPolicy
      runtimeAdapter?: 'codex' | 'claude'
      protection?: ManagedAgentRuntimeProtection
    }> = [
      { confirmation: { ...baseConfirmation, policyVersion: 2 } },
      { confirmation: { ...baseConfirmation, runtimeAdapter: 'claude' } },
      { confirmation: { ...baseConfirmation, hostFullAccess: true } },
    ]

    for (const mismatch of mismatches) {
      expect(
        managedAgentPermissionConfirmationMatches({
          confirmation: mismatch.confirmation ?? baseConfirmation,
          policy: mismatch.policy ?? basePolicy,
          runtimeAdapter: mismatch.runtimeAdapter ?? 'codex',
          protection: mismatch.protection ?? baseProtection,
        }),
      ).toBe(false)
    }

    const upgradedProtection = {
      ...baseProtection,
      runtimeVersion: '0.153.0',
      platform: 'linux',
      executableFingerprint: `sha256:${'b'.repeat(64)}`,
      level: 'partial' as const,
    }
    expect(
      managedAgentPermissionConfirmationMatches({
        confirmation: { ...baseConfirmation, limitedProtection: true },
        policy: basePolicy,
        runtimeAdapter: 'codex',
        protection: upgradedProtection,
      }),
    ).toBe(true)
  })


  it.each([
    { saved: 'win32', current: 'linux', isWsl: true },
    { saved: 'wsl', current: 'win32', isWsl: false },
  ] as const)('does not treat $saved to $current as an ordinary Codex upgrade', async ({ saved, current, isWsl }) => {
    const commands = await import('../agents/command-spec.js')
    vi.spyOn(commands, 'resolveBuiltinCommand').mockReturnValue(null)
    await expect(resolveManagedAgentPolicy({
      registration: { runtimeAdapter: 'codex' } as RoomSessionRegistration,
      permissionPolicy: basePolicy,
      permissionConfirmation: { ...baseConfirmation, platform: saved },
      workDir: '/not-used-before-runtime-check',
      runtime: { version: '0.155.0-alpha.9', runtimePlatform: current, runtimeIsWsl: isWsl, executableFingerprint: fingerprint },
    })).rejects.toThrow('managed_agent_runtime_changed')
  })

  it('binds host-full acceptance to the saved policy instead of the current protection level', () => {
    const policy = { ...basePolicy, fileAccess: 'host-full' as const }
    const protection = { ...baseProtection, level: 'partial' as const }
    const confirmation = {
      ...baseConfirmation,
      hostFullAccess: true,
      limitedProtection: true,
    }

    expect(
      managedAgentPermissionConfirmationMatches({
        confirmation: { ...confirmation, limitedProtection: false },
        policy,
        runtimeAdapter: 'codex',
        protection,
      }),
    ).toBe(true)
  })
})

describe('custom runtime managed permission resolution', () => {
  it('never runs an undeclared runtime as a managed Room member', async () => {
    const root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-custom-resolution-')),
    )
    roots.push(root)
    const runtimeFile = path.join(root, 'custom-runtime.mjs')
    fs.writeFileSync(runtimeFile, 'process.exit(0)\n')
    const entry: CustomAgentEntry = {
      command: `${process.execPath} ${runtimeFile}`,
      caps: {
        name: 'Unverified Custom',
        model: 'custom-model',
        mode: 'spawn',
        version: '1.0.0',
      },
    }
    const configRoot = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-custom-config-')),
    )
    roots.push(configRoot)
    fs.writeFileSync(
      path.join(configRoot, 'config.json'),
      JSON.stringify({ customAgents: { unverified: entry } }),
    )
    const previousShennianHome = process.env.SHENNIAN_HOME
    process.env.SHENNIAN_HOME = configRoot
    try {
      const registration = {
        runtimeAdapter: 'custom:unverified',
      } as unknown as RoomSessionRegistration
      const policy = testPermissionPolicy()
      const unverified = await resolveManagedAgentPolicy({
        registration,
        permissionPolicy: policy,
        permissionConfirmation: null,
        workDir: root,
      })
      expect(unverified.enforcement).toMatchObject({
        level: 'unverified',
        unsupportedCapabilities: expect.arrayContaining(['runtime.hardIsolation']),
      })

      const executableFingerprint = resolveCustomRuntimeExecutableFingerprint(entry)
      expect(executableFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/)
      const isWsl =
        process.platform === 'linux' &&
        Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP)
      const confirmation: ManagedAgentPermissionConfirmation = {
        policyVersion: policy.version,
        runtimeAdapter: 'custom:unverified',
        runtimeVersion: '1.0.0',
        platform: isWsl ? 'wsl' : process.platform,
        executableFingerprint: executableFingerprint!,
        hostFullAccess: false,
        limitedProtection: true,
        confirmedAt: '2026-09-05T00:00:00.000Z',
      }
      await expect(
        resolveManagedAgentPolicy({
          registration,
          permissionPolicy: policy,
          permissionConfirmation: confirmation,
          workDir: root,
        }),
      ).resolves.toMatchObject({ enforcement: { level: 'unverified' } })

      fs.appendFileSync(runtimeFile, '// executable changed\n')
      await expect(
        resolveManagedAgentPolicy({
          registration,
          permissionPolicy: policy,
          permissionConfirmation: confirmation,
          workDir: root,
        }),
      ).resolves.toMatchObject({ enforcement: { level: 'unverified' } })
    } finally {
      if (previousShennianHome === undefined) delete process.env.SHENNIAN_HOME
      else process.env.SHENNIAN_HOME = previousShennianHome
    }
  })
})

describe('ACP managed permission resolution', () => {
  it('reuses the detected ACP runtime identity for native-full confirmation', async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-acp-resolution-')))
    roots.push(root)
    const fingerprint = `sha256:${'a'.repeat(64)}`
    const policy: ManagedAgentPermissionPolicy = {
      version: 1,
      executionMode: 'native-full',
      fileAccess: 'host-full',
      externalCapabilities: {
        commandNetwork: true,
        webSearch: true,
        browser: true,
        computerUse: true,
        mcp: true,
      },
    }
    const registration = {
      runtimeAdapter: 'acp:qwen-code',
    } as unknown as RoomSessionRegistration
    const confirmation: ManagedAgentPermissionConfirmation = {
      policyVersion: policy.version,
      runtimeAdapter: 'acp:qwen-code',
      runtimeVersion: '0.23.2',
      platform: process.platform,
      executableFingerprint: fingerprint,
      executionMode: 'native-full',
      hostFullAccess: true,
      limitedProtection: false,
      confirmedAt: '2026-09-10T00:00:00.000Z',
    }

    await expect(
      resolveManagedAgentPolicy({
        registration,
        permissionPolicy: policy,
        permissionConfirmation: confirmation,
        workDir: root,
        runtime: {
          version: '0.23.2',
          runtimePlatform: process.platform,
          runtimeIsWsl: false,
          executableFingerprint: fingerprint,
        },
      }),
    ).resolves.toMatchObject({
      enforcement: {
        runtimeVersion: '0.23.2',
        executableFingerprint: fingerprint,
      },
      executionMode: 'native-full',
    })
  })
})
