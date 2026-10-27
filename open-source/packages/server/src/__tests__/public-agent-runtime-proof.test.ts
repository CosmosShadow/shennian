// @covers src/services/public-agent-runtime-proof.ts
import { describe, expect, it } from 'vitest'
import { assessPublicAgentRuntime } from '../services/public-agent-runtime-proof.js'

const policy = { version: 1, executionMode: 'restricted', fileAccess: 'workspace-write',
  externalCapabilities: { commandNetwork: false, webSearch: false,
    browser: false, computerUse: false, mcp: false } }
const matrix = { fileAccess: { 'workspace-read': true, 'workspace-write': true, 'host-full': true },
  externalCapabilities: Object.fromEntries(['commandNetwork', 'webSearch', 'browser',
    'computerUse', 'mcp'].map((name) => [name, { allow: true, deny: true }])) }
const agent = (level: 'hard' | 'partial') => ({ type: 'codex', supportsManagedAgent: true,
  managedAgentProtection: { level, runtimeVersion: '0.152.1', platform: 'darwin',
    executableFingerprint: `sha256:${'a'.repeat(64)}`, unsupportedCapabilities: [],
    capabilityMatrix: matrix } })

describe('public runtime inherits existing Agent permissions', () => {
  it('accepts supported restricted permissions with hard or partial enforcement', () => {
    expect(assessPublicAgentRuntime([agent('hard')], 'codex', policy, null).blockers).toEqual([])
    expect(assessPublicAgentRuntime([agent('partial')], 'codex', policy, null).blockers).toEqual([])
  })
  it('still rejects an unsupported saved permission instead of silently changing it', () => {
    const unsupported = { ...agent('partial'), managedAgentProtection: {
      ...agent('partial').managedAgentProtection,
      capabilityMatrix: { ...matrix, fileAccess: { ...matrix.fileAccess, 'workspace-write': false } },
    } }
    expect(assessPublicAgentRuntime([unsupported], 'codex', policy, null).blockers)
      .toContain('runtime_capability_gap')
  })

  it('does not let sharing grant unconfirmed host access during execution', () => {
    expect(assessPublicAgentRuntime([agent('partial')], 'codex', {
      ...policy, fileAccess: 'host-full',
    }, null).blockers).toContain('runtime_permission_unconfirmed')
  })

})
