// @arch open-source/docs/cli-runtime.md
// @covers src/agents/custom-managed-runtime.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CustomAgentType, ManagedAgentEnforcement } from '@shennian/wire'
import type { CustomAgentEntry } from '../config/index.js'
import {
  assessCustomRuntimeSecurity,
  createCustomManagedPolicyFile,
  disposeCustomManagedPolicyFile,
  registerCustomRuntimeSecurity,
  resolveCustomRuntimeExecutableFingerprint,
  sha256File,
} from '../agents/custom-managed-runtime.js'
import {
  resolveManagedAgentRuntimeProtection,
  unregisterManagedAgentRuntimeSecurity,
  type ManagedAgentRuntimePlatform,
} from '../security/managed-agent-runtime.js'
import type { CompiledManagedAgentPolicy } from '../security/managed-agent-policy.js'

function platform(): ManagedAgentRuntimePlatform {
  return process.platform === 'darwin' ||
    process.platform === 'linux' ||
    process.platform === 'win32'
    ? process.platform
    : 'unsupported'
}

function compiledPolicy(workDir: string): CompiledManagedAgentPolicy {
  const requestedPolicy = {
    version: 3,
    fileAccess: 'workspace-write' as const,
    externalCapabilities: {
      commandNetwork: false,
      webSearch: false,
      browser: false,
      computerUse: false,
      mcp: false,
    },
  }
  const enforcement: ManagedAgentEnforcement = {
    level: 'unverified',
    effectivePolicy: {
      ...requestedPolicy,
      fileAccess: 'host-full',
      externalCapabilities: {
        commandNetwork: true,
        webSearch: true,
        browser: true,
        computerUse: true,
        mcp: true,
      },
    },
    unsupportedCapabilities: ['fileAccess.workspaceWrite'],
    runtimeVersion: '2.4.0',
    platform: platform(),
  }
  return {
    requestedPolicy,
    enforcement,
    adapterPolicy: {
      version: 3,
      workDir,
      fileAccess: 'host-full',
      externalCapabilities: { ...enforcement.effectivePolicy.externalCapabilities },
      denySensitiveFiles: true,
      failClosed: true,
    },
    environmentPolicy: {
      inheritDaemonEnv: false,
      loadLoginShell: false,
      providerEnvKeys: [],
      sessionEnvKeys: ['SHENNIAN_MANAGER_SESSION_ID'],
      shellSubprocess: { inherit: 'none', allowedEnvKeys: [], deniedEnvKeys: [] },
    },
  }
}

function declaredEntry(executablePath: string): CustomAgentEntry {
  const runtimePlatform = platform()
  return {
    command: executablePath,
    caps: {
      name: 'Verified Custom',
      model: 'test-model',
      mode: 'spawn',
      version: '2.4.0',
      security: {
        schemaVersion: 1,
        declarationVersion: 1,
        policyProtocol: 'shennian-managed-policy-file-v1',
        runtimeVersion: '2.4.0',
        executablePath,
        executableSha256: sha256File(executablePath),
        conformance: {
          suiteVersion: '1',
          status: 'passed',
          platform: runtimePlatform,
          testedAt: '2026-09-05T00:00:00.000Z',
        },
        runtimeSecurity: {
          minimumRuntimeVersion: '2.4.0',
          platforms: {
            [runtimePlatform]: {
              level: 'partial',
              fileAccess: {
                'workspace-read': true,
                'workspace-write': true,
                'host-full': true,
              },
              externalCapabilities: {
                commandNetwork: { allow: false, deny: true },
                webSearch: { allow: false, deny: true },
                browser: { allow: false, deny: true },
                computerUse: { allow: false, deny: true },
                mcp: { allow: false, deny: true },
              },
              knownGaps: ['customRuntime.shellIsolationPartial'],
            },
          },
        },
      },
    },
  }
}

describe('Custom managed runtime security', () => {
  let tempDir: string
  let executablePath: string
  const agentType = 'custom:managed-runtime-test' as CustomAgentType

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-custom-security-test-'))
    executablePath = path.join(tempDir, process.platform === 'win32' ? 'runtime.cmd' : 'runtime')
    fs.writeFileSync(
      executablePath,
      process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\nexit 0\n',
    )
    fs.chmodSync(executablePath, 0o755)
  })

  afterEach(() => {
    unregisterManagedAgentRuntimeSecurity(agentType)
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('requires a versioned declaration bound to runtime, platform and executable', () => {
    const entry = declaredEntry(executablePath)
    expect(assessCustomRuntimeSecurity(entry, platform())).toMatchObject({
      state: 'declared',
      executablePath: fs.realpathSync(executablePath),
      executableSha256: sha256File(executablePath),
    })

    entry.caps.version = '2.5.0'
    expect(assessCustomRuntimeSecurity(entry, platform())).toEqual({
      state: 'unverified',
      reason: 'runtime_version_mismatch',
    })
  })

  it('invalidates conformance when executable content changes', () => {
    const entry = declaredEntry(executablePath)
    fs.appendFileSync(executablePath, '# changed\n')

    expect(assessCustomRuntimeSecurity(entry, platform())).toEqual({
      state: 'unverified',
      reason: 'executable_fingerprint_mismatch',
    })
  })

  it('fingerprints actual launch files for undeclared runtimes', () => {
    const scriptPath = path.join(tempDir, 'unverified-runtime.mjs')
    fs.writeFileSync(scriptPath, 'process.exit(0)\n')
    const entry: CustomAgentEntry = {
      command: `${process.execPath} ${scriptPath}`,
      caps: { name: 'Unverified', model: 'test-model', mode: 'spawn', version: '1.0.0' },
    }

    const before = resolveCustomRuntimeExecutableFingerprint(entry)
    expect(before).toMatch(/^sha256:[a-f0-9]{64}$/)

    fs.appendFileSync(scriptPath, '// changed\n')
    const afterContentChange = resolveCustomRuntimeExecutableFingerprint(entry)
    expect(afterContentChange).not.toBe(before)
    entry.command += ' --profile=safe'
    expect(resolveCustomRuntimeExecutableFingerprint(entry)).not.toBe(afterContentChange)
    expect(
      resolveCustomRuntimeExecutableFingerprint({
        command: 'definitely-missing-custom-runtime --version',
        caps: entry.caps,
      }),
    ).toBeUndefined()
  })

  it('does not accept an attestation for an executable outside the launch command', () => {
    const entry = declaredEntry(executablePath)
    entry.command = process.execPath

    expect(assessCustomRuntimeSecurity(entry, platform())).toEqual({
      state: 'unverified',
      reason: 'executable_not_bound_to_command',
    })
  })

  it('keeps self-reported passed declarations unverified without signed evidence', () => {
    expect(registerCustomRuntimeSecurity(agentType, declaredEntry(executablePath))).toMatchObject({
      state: 'declared',
    })
    expect(
      resolveManagedAgentRuntimeProtection({
        agentType,
        runtimeVersion: '2.4.0',
      }),
    ).toMatchObject({
      level: 'unverified',
      runtimeVersion: '2.4.0',
      unsupportedCapabilities: expect.arrayContaining(['fileAccess.workspaceRead']),
    })

    registerCustomRuntimeSecurity(agentType, {
      command: executablePath,
      caps: { name: 'Unverified', model: 'test-model', mode: 'spawn', version: '2.4.0' },
    })
    expect(
      resolveManagedAgentRuntimeProtection({
        agentType,
        runtimeVersion: '2.4.0',
      }),
    ).toMatchObject({ level: 'unverified' })
  })

  it('writes a private, versioned policy file and guards cleanup scope', async () => {
    const policyFile = await createCustomManagedPolicyFile(compiledPolicy(tempDir))
    const contents = JSON.parse(fs.readFileSync(policyFile.policyPath, 'utf8'))
    expect(contents).toMatchObject({
      schemaVersion: 1,
      policyVersion: 3,
      requestedPolicy: { fileAccess: 'workspace-write' },
      resolvedWorkDir: tempDir,
      enforcement: { level: 'unverified', runtimeVersion: '2.4.0' },
      adapterPolicy: { workDir: tempDir, fileAccess: 'host-full', failClosed: true },
      environmentPolicy: { inheritDaemonEnv: false, loadLoginShell: false },
    })
    if (process.platform !== 'win32') {
      expect(fs.statSync(policyFile.directory).mode & 0o777).toBe(0o700)
      expect(fs.statSync(policyFile.policyPath).mode & 0o777).toBe(0o600)
    }
    await expect(disposeCustomManagedPolicyFile(tempDir)).rejects.toThrow(
      'custom_managed_policy_cleanup_refused',
    )
    await disposeCustomManagedPolicyFile(policyFile.directory)
    expect(fs.existsSync(policyFile.directory)).toBe(false)
  })
})
