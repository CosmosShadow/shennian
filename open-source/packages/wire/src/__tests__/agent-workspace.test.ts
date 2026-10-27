// @covers open-source/packages/wire/src/agent-workspace.ts

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MANAGED_AGENT_PERMISSION_POLICY,
  DEFAULT_NATIVE_FULL_MANAGED_AGENT_PERMISSION_POLICY,
  DEFAULT_RESTRICTED_MANAGED_AGENT_PERMISSION_POLICY,
  LEGACY_MANAGED_AGENT_PERMISSION_POLICY,
  managedAgentConfirmationMatchesPolicy,
  parseManagedAgentPermissionPolicy,
  resolveManagedAgentEffectivePermissionPolicy,
  resolveManagedAgentPermissionPolicy,
} from '../agent-workspace.js'

describe('managed Agent permission policy', () => {
  it('keeps full-access approval bound to the policy, not a runtime update', () => {
    const policy = { ...DEFAULT_NATIVE_FULL_MANAGED_AGENT_PERMISSION_POLICY, version: 7 }
    const runtime = { policy, runtimeAdapter: 'opencode', runtimeVersion: '2.0.14',
      platform: 'linux', executableFingerprint: `sha256:${'a'.repeat(64)}` }
    const confirmation = { policyVersion: 7, runtimeAdapter: 'opencode',
      runtimeVersion: '2.0.14', platform: 'linux',
      executableFingerprint: runtime.executableFingerprint,
      executionMode: 'native-full', hostFullAccess: true,
      limitedProtection: false, confirmedAt: '2026-09-26T00:00:00Z' }
    expect(managedAgentConfirmationMatchesPolicy({ ...runtime, confirmation })).toBe(true)
    expect(managedAgentConfirmationMatchesPolicy({ ...runtime,
      confirmation: { ...confirmation, runtimeVersion: '2.0.15' } })).toBe(true)
    expect(managedAgentConfirmationMatchesPolicy({ ...runtime,
      confirmation: { ...confirmation, policyVersion: 6 } })).toBe(false)
    expect(managedAgentConfirmationMatchesPolicy({ ...runtime,
      confirmation: { ...confirmation, hostFullAccess: false } })).toBe(false)
  })
  it('defaults new explicit policies to native full access', () => {
    expect(DEFAULT_NATIVE_FULL_MANAGED_AGENT_PERMISSION_POLICY).toEqual({
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
    })
  })

  it('keeps a separate restrictive fallback for old clients', () => {
    expect(DEFAULT_RESTRICTED_MANAGED_AGENT_PERMISSION_POLICY).toEqual({
      version: 1,
      executionMode: 'restricted',
      fileAccess: 'workspace-read',
      externalCapabilities: {
        commandNetwork: false,
        webSearch: false,
        browser: false,
        computerUse: false,
        mcp: false,
      },
    })
  })

  it('strictly rejects incomplete or malformed explicit policies', () => {
    expect(parseManagedAgentPermissionPolicy(undefined)).toBeNull()
    expect(
      parseManagedAgentPermissionPolicy({
        version: 1,
        fileAccess: 'workspace-write',
        externalCapabilities: { commandNetwork: false },
      }),
    ).toBeNull()
    expect(
      parseManagedAgentPermissionPolicy({
        version: 0,
        fileAccess: 'workspace-write',
        externalCapabilities: DEFAULT_MANAGED_AGENT_PERMISSION_POLICY.externalCapabilities,
      }),
    ).toBeNull()
    expect(
      parseManagedAgentPermissionPolicy({
        ...DEFAULT_RESTRICTED_MANAGED_AGENT_PERMISSION_POLICY,
        executionMode: 'unknown',
      }),
    ).toBeNull()
  })

  it('normalizes a policy from an older client to restricted mode', () => {
    expect(
      parseManagedAgentPermissionPolicy({
        version: 3,
        fileAccess: 'host-full',
        externalCapabilities: {
          commandNetwork: true,
          webSearch: true,
          browser: true,
          computerUse: true,
          mcp: true,
        },
      }),
    ).toMatchObject({ version: 3, executionMode: 'restricted' })
  })

  it('projects missing legacy payloads as unrestricted instead of claiming sandbox protection', () => {
    const resolved = resolveManagedAgentPermissionPolicy(undefined)
    expect(resolved).toEqual(LEGACY_MANAGED_AGENT_PERMISSION_POLICY)
    expect(resolved).not.toBe(LEGACY_MANAGED_AGENT_PERMISSION_POLICY)
    expect(resolved.externalCapabilities).not.toBe(
      LEGACY_MANAGED_AGENT_PERMISSION_POLICY.externalCapabilities,
    )
  })

  it('can explicitly create a fresh restrictive default without sharing mutable state', () => {
    const resolved = resolveManagedAgentPermissionPolicy(undefined, 'default')
    expect(resolved).toEqual(DEFAULT_MANAGED_AGENT_PERMISSION_POLICY)
    expect(resolved).not.toBe(DEFAULT_MANAGED_AGENT_PERMISSION_POLICY)
  })

  it('projects requested permissions to the boundaries the runtime can actually enforce', () => {
    const effective = resolveManagedAgentEffectivePermissionPolicy(
      {
        ...DEFAULT_RESTRICTED_MANAGED_AGENT_PERMISSION_POLICY,
        fileAccess: 'workspace-write',
        externalCapabilities: {
          ...DEFAULT_RESTRICTED_MANAGED_AGENT_PERMISSION_POLICY.externalCapabilities,
          webSearch: true,
        },
      },
      {
        level: 'partial',
        runtimeVersion: '1.0.0',
        platform: 'darwin',
        unsupportedCapabilities: [],
        capabilityMatrix: {
          fileAccess: {
            'workspace-read': true,
            'workspace-write': false,
            'host-full': true,
          },
          externalCapabilities: {
            commandNetwork: { allow: true, deny: false },
            webSearch: { allow: true, deny: true },
            browser: { allow: false, deny: true },
            computerUse: { allow: false, deny: true },
            mcp: { allow: true, deny: true },
          },
        },
      },
    )

    expect(effective.fileAccess).toBe('host-full')
    expect(effective.externalCapabilities).toEqual({
      commandNetwork: true,
      webSearch: true,
      browser: false,
      computerUse: false,
      mcp: false,
    })
  })

  it('treats missing runtime evidence as possible full host and external access', () => {
    expect(
      resolveManagedAgentEffectivePermissionPolicy(DEFAULT_RESTRICTED_MANAGED_AGENT_PERMISSION_POLICY),
    ).toEqual(LEGACY_MANAGED_AGENT_PERMISSION_POLICY)
  })
})
