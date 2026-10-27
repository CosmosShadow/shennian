// @covers src/features/agents/agentListAccountState.ts

import { describe, expect, it } from 'vitest'
import type { AgentWorkspace } from '@shennian/wire'
import {
  applyAgentListResult,
  switchAgentListAccount,
  updateAgentListForAccount,
  type AgentListAccountState,
} from '../features/agents/agentListAccountState'

const agent = (id: string) => ({ id }) as AgentWorkspace

describe('Desktop Agent list account isolation', () => {
  it('hides the previous account synchronously when the next account has an empty snapshot', () => {
    const accountA: AgentListAccountState = {
      accountId: 'account-a',
      agents: [agent('private-agent-a')],
    }

    const accountB = switchAgentListAccount(accountA, 'account-b', null)

    expect(accountB).toEqual({ accountId: 'account-b', agents: [] })
  })

  it('rejects late SQLite and HTTP results from the previous account', () => {
    const accountB: AgentListAccountState = {
      accountId: 'account-b',
      agents: [agent('agent-b')],
    }

    const afterLateLocal = applyAgentListResult(
      accountB,
      'account-a',
      [agent('private-agent-a')],
    )
    const afterLateRemote = updateAgentListForAccount(afterLateLocal, 'account-a', () => [
      agent('remote-agent-a'),
    ])

    expect(afterLateLocal).toBe(accountB)
    expect(afterLateRemote).toBe(accountB)
    expect(afterLateRemote.agents.map(({ id }) => id)).toEqual(['agent-b'])
  })

  it('accepts an authoritative empty result for the active account', () => {
    const warmState: AgentListAccountState = {
      accountId: 'account-b',
      agents: [agent('deleted-agent')],
    }

    expect(applyAgentListResult(warmState, 'account-b', [])).toEqual({
      accountId: 'account-b',
      agents: [],
    })
  })
})
