// @arch docs/features/acp-agent-support.md
// @test src/__tests__/acp-agent-presentation.test.ts

import {
  filterAvailableAgentTypes,
  type AgentInfo,
  type AgentType,
  type Machine,
} from '@shennian/wire'

export type InstalledAgentRow = { type: AgentType; info?: AgentInfo }
export type AgentStatusKind = 'version_mismatch' | 'installed' | 'auth_required' | 'available' | 'auth_error'

export function groupInstalledAgents(machine?: Machine): {
  all: InstalledAgentRow[]
  deep: InstalledAgentRow[]
  acp: InstalledAgentRow[]
} {
  const rows = filterAvailableAgentTypes(machine?.agentList ?? []).map((type) => ({
    type,
    info: machine?.agents?.find((item) => item.type === type),
  }))
  return {
    all: rows,
    deep: rows.filter((row) => row.info?.integration !== 'acp' && !row.type.startsWith('acp:')),
    acp: rows.filter((row) => row.info?.integration === 'acp' || row.type.startsWith('acp:')),
  }
}

export function getAgentStatusKind(machineOnline: boolean, info?: AgentInfo): AgentStatusKind {
  if (info?.runtime?.compatibility === 'version_mismatch') return 'version_mismatch'
  if (!machineOnline || !info?.authState || info.authState === 'unknown') return 'installed'
  if (info.authState === 'error') return 'auth_error'
  if (info.authState === 'required') return 'auth_required'
  return 'available'
}
