// @covers packages/app/src/features/agents/agentDetailAccountState.ts
// @covers packages/app/app/(main)/agents/[agentId]/index.tsx
// @covers packages/app/src/features/agents/screens/AgentEditScreen.tsx

import { describe, expect, it } from 'vitest'
import type { AgentWorkspace } from '@shennian/wire'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  applyAgentDetailResult,
  switchAgentDetailAccount,
  updateAgentDetailForAccount,
  type AgentDetailAccountState,
} from '../features/agents/agentDetailAccountState'

const agent = (id: string, systemPrompt: string) =>
  ({ id, displayName: id, systemPrompt }) as AgentWorkspace

describe('Desktop Agent detail account isolation', () => {
  it('hides the previous account detail synchronously, including its private prompt', () => {
    const accountA: AgentDetailAccountState = {
      accountId: 'account-a',
      agentId: 'agent-a',
      agent: agent('agent-a', 'private instructions for account A'),
    }

    expect(switchAgentDetailAccount(accountA, 'account-b', 'agent-a')).toEqual({
      accountId: 'account-b',
      agentId: 'agent-a',
      agent: null,
    })
    expect(switchAgentDetailAccount(accountA, null, 'agent-a')).toEqual({
      accountId: null,
      agentId: 'agent-a',
      agent: null,
    })
    expect(switchAgentDetailAccount(accountA, 'account-a', 'agent-b')).toEqual({
      accountId: 'account-a',
      agentId: 'agent-b',
      agent: null,
    })
  })

  it('rejects late SQLite, HTTP and event results from the previous account', () => {
    const accountB: AgentDetailAccountState = {
      accountId: 'account-b',
      agentId: 'agent-b',
      agent: agent('agent-b', 'private instructions for account B'),
    }

    const afterLateLoad = applyAgentDetailResult(
      accountB,
      'account-a',
      'agent-a',
      agent('agent-a', 'private instructions for account A'),
    )
    const afterLateEvent = updateAgentDetailForAccount(
      afterLateLoad,
      'account-a',
      'agent-a',
      (current) => ({
        ...current,
        displayName: 'stale account A update',
      }),
    )

    expect(afterLateLoad).toBe(accountB)
    expect(afterLateEvent).toBe(accountB)
    expect(afterLateEvent.agent?.systemPrompt).toBe('private instructions for account B')
  })

  it('accepts local and remote detail only for the active authenticated account', () => {
    const empty: AgentDetailAccountState = {
      accountId: 'account-b',
      agentId: 'agent-b',
      agent: null,
    }
    const loaded = applyAgentDetailResult(
      empty,
      'account-b',
      'agent-b',
      agent('agent-b', 'private instructions for account B'),
    )
    const updated = updateAgentDetailForAccount(loaded, 'account-b', 'agent-b', (current) => ({
      ...current,
      displayName: 'Updated Agent B',
    }))

    expect(loaded.agent?.id).toBe('agent-b')
    expect(updated.agent?.displayName).toBe('Updated Agent B')
  })

  it('binds both detail surfaces and the editable draft lifecycle to the current account', () => {
    const detail = readFileSync(
      resolve(__dirname, '../features/agents/useAgentDetailModel.native.ts'),
      'utf8',
    )
    const settings = readFileSync(
      resolve(__dirname, '../features/agents/screens/AgentEditScreen.tsx'),
      'utf8',
    )

    for (const source of [detail, settings]) {
      expect(source).toContain('switchAgentDetailAccount(agentDetail, accountId, agentId).agent')
      expect(source).toContain('applyAgentDetailResult(current, accountId, agentId')
    }
    expect(detail).toContain('context.current === scope')
    expect(detail).toContain('useAuthStore.getState().user?.id === accountId')
    expect(settings).toContain('setDraft(null)')
    expect(settings).toContain('setDraftCanSubmit(false)')
    expect(settings).toContain("setSavedSignature('')")
    expect(settings).toContain('isCurrent: () => active && routeContext.current.accountId === accountId')
    expect(settings).toContain('if (!isCurrent()) return false')
  })
})
