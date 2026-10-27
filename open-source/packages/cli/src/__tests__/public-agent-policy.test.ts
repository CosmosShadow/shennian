// @covers open-source/packages/cli/src/security/public-agent-policy.ts

import { describe, expect, it } from 'vitest'
import { DEFAULT_MANAGED_AGENT_PERMISSION_POLICY,
  DEFAULT_NATIVE_FULL_MANAGED_AGENT_PERMISSION_POLICY } from '@shennian/wire'
import { compileManagedAgentPolicy } from '../security/managed-agent-policy.js'
import { assertPublicAgentPolicy } from '../security/public-agent-policy.js'

async function hardPolicy() {
  const result = await compileManagedAgentPolicy({
    agentType: 'codex', runtimeVersion: '1.2.0', platform: 'darwin',
    executableFingerprint: 'sha256:verified-binary', requireExecutableFingerprint: true,
    policy: DEFAULT_MANAGED_AGENT_PERMISSION_POLICY,
    workDir: '/private/published-agents/conversation-1',
    resolveWorkDir: async (value) => value,
    securityDeclaration: { minimumRuntimeVersion: '1.0.0',
      maximumRuntimeVersionExclusive: '2.0.0', platforms: { darwin: {
        level: 'hard', fileAccess: {
          'workspace-read': true, 'workspace-write': true, 'host-full': true,
        }, externalCapabilities: {
          commandNetwork: { allow: true, deny: true },
          webSearch: { allow: true, deny: true },
          browser: { allow: true, deny: true },
          computerUse: { allow: true, deny: true },
          mcp: { allow: true, deny: true },
        },
      } } },
  })
  if (!result.ok) throw new Error(result.errorCode)
  return result.value
}

describe('public Agent runtime gate', () => {
  it('uses an explicitly compiled native-full Agent policy without silently removing its tools', async () => {
    const base = await hardPolicy()
    const result = await compileManagedAgentPolicy({
      agentType: 'codex', runtimeVersion: '1.2.0', platform: 'darwin',
      executableFingerprint: 'sha256:verified-binary', requireExecutableFingerprint: true,
      policy: DEFAULT_NATIVE_FULL_MANAGED_AGENT_PERMISSION_POLICY,
      hostFullAccessConfirmed: true, channel: 'public',
      workDir: '/private/published-agents/conversation-1',
      resolveWorkDir: async (value) => value,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.adapterPolicy.externalCapabilities.commandNetwork).toBe(true)
      expect(() => assertPublicAgentPolicy(result.value)).not.toThrow()
      const unsafe = structuredClone(result.value)
      ;(unsafe.environmentPolicy as { inheritDaemonEnv: boolean }).inheritDaemonEnv = true
      expect(() => assertPublicAgentPolicy(unsafe)).toThrow('public_agent_policy_unavailable')
    }
    expect(base.executionMode).toBe('restricted')
  })
  it('accepts a fingerprinted hard or partial policy, refusing unverified or leaky ones', async () => {
    const policy = await hardPolicy()
    expect(() => assertPublicAgentPolicy(policy)).not.toThrow()
    // `partial` (tool-layer-only restricted mode, no full OS sandbox) is now
    // accepted — the same bar Room chat already uses for these Adapters —
    // as long as nothing else about the policy is actually leaky.
    expect(() => assertPublicAgentPolicy({ ...policy, enforcement: {
      ...policy.enforcement, level: 'partial',
    } })).not.toThrow()
    expect(() => assertPublicAgentPolicy({ ...policy, enforcement: {
      ...policy.enforcement, level: 'unverified',
    } })).toThrow('public_agent_policy_unavailable')
    expect(() => assertPublicAgentPolicy({ ...policy, enforcement: {
      ...policy.enforcement, executableFingerprint: undefined,
    } })).toThrow('public_agent_policy_unavailable')
    expect(() => assertPublicAgentPolicy({ ...policy, adapterPolicy: {
      ...policy.adapterPolicy,
      externalCapabilities: { ...policy.adapterPolicy.externalCapabilities, commandNetwork: true },
    } })).toThrow('public_agent_policy_unavailable')
  })

  it('separates the public host reply channel from OpenCode Room send limits', async () => {
    const base = {
      agentType: 'opencode' as const, runtimeVersion: '1.18.26', platform: 'darwin' as const,
      executableFingerprint: 'sha256:verified-binary', requireExecutableFingerprint: true,
      policy: DEFAULT_MANAGED_AGENT_PERMISSION_POLICY,
      workDir: '/private/published-agents/conversation-1',
      resolveWorkDir: async (value: string) => value,
      securityDeclaration: { minimumRuntimeVersion: '1.18.0',
        maximumRuntimeVersionExclusive: '1.19.0', platforms: { darwin: {
          level: 'hard' as const,
          fileAccess: { 'workspace-read': true, 'workspace-write': true, 'host-full': true },
          externalCapabilities: {
            commandNetwork: { allow: true, deny: true }, webSearch: { allow: true, deny: true },
            browser: { allow: true, deny: true }, computerUse: { allow: true, deny: true },
            mcp: { allow: true, deny: true },
          },
        } } },
    }
    const room = await compileManagedAgentPolicy(base)
    expect(room).toMatchObject({ ok: false,
      errorCode: 'managed_agent_restricted_room_unsupported' })
    const publicResult = await compileManagedAgentPolicy({ ...base, channel: 'public' })
    expect(publicResult.ok).toBe(true)
    if (publicResult.ok) expect(() => assertPublicAgentPolicy(publicResult.value)).not.toThrow()
  })

  it('accepts a provable public denial even if the runtime cannot allow that capability', async () => {
    const declaration = { minimumRuntimeVersion: '2.1.260',
      maximumRuntimeVersionExclusive: '2.2.0', platforms: { darwin: {
        level: 'hard' as const,
        fileAccess: { 'workspace-read': true, 'workspace-write': true, 'host-full': true },
        externalCapabilities: {
          commandNetwork: { allow: true, deny: true }, webSearch: { allow: true, deny: true },
          browser: { allow: true, deny: true }, computerUse: { allow: false, deny: true },
          mcp: { allow: true, deny: true },
        },
      } } }
    const input = { agentType: 'claude' as const, runtimeVersion: '2.1.272', platform: 'darwin' as const,
      executableFingerprint: 'sha256:verified-binary', requireExecutableFingerprint: true,
      policy: DEFAULT_MANAGED_AGENT_PERMISSION_POLICY, channel: 'public' as const,
      workDir: '/private/published-agents/conversation-1',
      resolveWorkDir: async (value: string) => value, securityDeclaration: declaration }
    const result = await compileManagedAgentPolicy(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.enforcement.unsupportedCapabilities).toEqual([])
    expect(() => assertPublicAgentPolicy(result.value)).not.toThrow()
    const cannotDeny = await compileManagedAgentPolicy({ ...input,
      securityDeclaration: { ...declaration, platforms: { darwin: { ...declaration.platforms.darwin,
        externalCapabilities: { ...declaration.platforms.darwin.externalCapabilities,
          computerUse: { allow: false, deny: false } },
      } } },
    })
    expect(cannotDeny).toMatchObject({ ok: true, value: {
      enforcement: { unsupportedCapabilities: expect.arrayContaining(['externalCapabilities.computerUse']) },
    } })
    // A requested denial that the Adapter cannot enforce must not be silently
    // expanded into a different permission. The Owner may choose native-full
    // explicitly instead of claiming that this restricted policy is honored.
    if (cannotDeny.ok) expect(() => assertPublicAgentPolicy(cannotDeny.value))
      .toThrow('public_agent_policy_unavailable')
  })
})
