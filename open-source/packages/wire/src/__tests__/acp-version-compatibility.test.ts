// @arch open-source/docs/wire.md
// @covers open-source/packages/wire/src/session.ts

import { describe, expect, it } from 'vitest'
import {
  AVAILABLE_BUILTIN_AGENT_TYPES,
  filterAvailableAgentInfos,
  filterAvailableAgentTypes,
  type AgentInfo,
} from '../session.js'

// This is the exact closed-world predicate shipped in the 0.4.0 App. Keeping it
// in the contract test proves that additive ACP projections remain safe for an
// already-released client instead of silently changing that old client's rules.
const legacyAgentTypes = new Set<string>(AVAILABLE_BUILTIN_AGENT_TYPES)
function legacyFilter(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.startsWith('custom:') || legacyAgentTypes.has(value)))]
}

describe('ACP mixed-version wire compatibility', () => {
  it('lets an old App safely ignore ACP ids and additive metadata from a new daemon', () => {
    const newDaemonPayload = JSON.parse(JSON.stringify({
      agentList: ['codex', 'acp:qwen-code', 'acp:company-agent'],
      agents: [
        { type: 'codex', models: [] },
        {
          type: 'acp:qwen-code',
          models: [],
          integration: 'acp',
          authState: 'unknown',
          acpCapabilities: { protocolVersion: 1, listSessions: true },
        },
      ],
    })) as { agentList: string[]; agents: unknown[] }

    expect(() => legacyFilter(newDaemonPayload.agentList)).not.toThrow()
    expect(legacyFilter(newDaemonPayload.agentList)).toEqual(['codex'])
  })

  it('lets a new App consume an old daemon projection with no ACP metadata', () => {
    const oldDaemonPayload = JSON.parse(JSON.stringify({
      agentList: ['claude', 'codex'],
      agents: [
        { type: 'claude', models: [] },
        { type: 'codex', models: [] },
      ],
    })) as { agentList: string[]; agents: AgentInfo[] }

    expect(filterAvailableAgentTypes(oldDaemonPayload.agentList)).toEqual(['claude', 'codex'])
    expect(filterAvailableAgentInfos(oldDaemonPayload.agents)).toEqual(oldDaemonPayload.agents)
    expect(filterAvailableAgentInfos(oldDaemonPayload.agents).every((agent) => agent.integration == null)).toBe(true)
  })
})
