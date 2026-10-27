// @covers src/features/agents/agentListCache.ts

import { beforeEach, describe, expect, it } from 'vitest'
import type { AgentWorkspace } from '@shennian/wire'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  clearAgentListSnapshots,
  getAgentListSnapshot,
  setAgentListSnapshot,
  subscribeAgentListSnapshots,
} from '../features/agents/agentListCache'

describe('Agent list cache', () => {
  beforeEach(clearAgentListSnapshots)

  it('keeps the latest list snapshot isolated by account', () => {
    const agents = [{ id: 'agent-1' }] as AgentWorkspace[]
    setAgentListSnapshot('user-1', agents)

    expect(getAgentListSnapshot('user-1')).toBe(agents)
    expect(getAgentListSnapshot('user-2')).toBeNull()
  })

  it('does not retain a snapshot before authentication is available', () => {
    setAgentListSnapshot(null, [{ id: 'agent-1' }] as AgentWorkspace[])
    expect(getAgentListSnapshot(null)).toBeNull()
  })

  it('notifies unread consumers when an agent snapshot changes', () => {
    let changes = 0
    const unsubscribe = subscribeAgentListSnapshots(() => changes++)
    setAgentListSnapshot('user-1', [])
    unsubscribe()
    setAgentListSnapshot('user-1', [])
    expect(changes).toBe(1)
  })

  it('renders a local snapshot immediately and only announces a genuinely cold first load', () => {
    const route = readFileSync(
      resolve(import.meta.dirname, '../../app/(main)/agents/index.tsx'),
      'utf8',
    )

    const model = readFileSync(resolve(import.meta.dirname, '../features/agents/useAgentListModel.native.ts'), 'utf8')
    expect(route).toContain('useAgentListModel()')
    expect(model).toContain('agents: getAgentListSnapshot(accountId) ?? []')
    expect(model).toContain('switchAgentListAccount(')
    expect(model).toContain('applyAgentListResult(current, accountId, cached)')
    expect(model).toContain('setAgentListSnapshot(accountId, nextAgents)')
    expect(model).toContain('useFocusEffect(')
    expect(route).toContain("listUiState === 'initial-loading'")
    expect(route).toContain('<ActivityIndicator')
    expect(route).not.toContain('setLoading(')
  })
})
