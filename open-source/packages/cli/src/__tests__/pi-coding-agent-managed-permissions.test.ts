// @arch open-source/docs/cli-runtime.md
// @covers src/agents/pi-coding-agent-managed-permissions.ts

import { describe, expect, it } from 'vitest'
import { resolveManagedAgentRuntimeProtection } from '../security/managed-agent-runtime.js'
import { PI_CODING_AGENT_MANAGED_RUNTIME_SECURITY } from '../agents/pi-coding-agent-managed-permissions.js'

describe('Pi coding agent managed protection', () => {
  it('reports tool-level partial protection instead of claiming a sandbox', () => {
    const protection = resolveManagedAgentRuntimeProtection({
      agentType: 'pi-coding-agent',
      runtimeVersion: '0.85.1',
      platform: 'darwin',
      executableFingerprint: 'sha256:pi-test',
      requireExecutableFingerprint: true,
      securityDeclaration: PI_CODING_AGENT_MANAGED_RUNTIME_SECURITY,
    })
    expect(protection.level).toBe('partial')
    expect(protection.capabilityMatrix?.fileAccess['workspace-read']).toBe(false)
    expect(protection.capabilityMatrix?.fileAccess['host-full']).toBe(true)
    expect(protection.capabilityMatrix?.externalCapabilities.commandNetwork.deny).toBe(false)
    expect(protection.unsupportedCapabilities).toContain('sandbox.toolAllowlistOnly')
  })

  it('returns unverified outside the exercised Pi release line', () => {
    const protection = resolveManagedAgentRuntimeProtection({
      agentType: 'pi-coding-agent',
      runtimeVersion: '0.86.0',
      platform: 'win32',
      executableFingerprint: 'sha256:future-pi',
      requireExecutableFingerprint: true,
      securityDeclaration: PI_CODING_AGENT_MANAGED_RUNTIME_SECURITY,
    })
    expect(protection.level).toBe('unverified')
  })
})
