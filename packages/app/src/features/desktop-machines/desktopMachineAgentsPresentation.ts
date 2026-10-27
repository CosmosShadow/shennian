// @arch docs/features/desktop-machine-access-boundary.md
// @test ../../__tests__/desktop-machine-agents.test.ts

import { getAgentDisplayName } from '@shennian/shared'
import type { AgentInfo, Machine } from '@shennian/wire'
import { getAgentStatusKind, groupInstalledAgents } from '../machines/utils/acp-agent-presentation'
import { getInstallableBuiltinAgents } from '../machines/utils/launch'
import type { DesktopMachineAgentCatalogEntry } from './desktopMachineAgentsPort'

export type DesktopInstallableAgent = { key: string; name: string }
export type DesktopInstalledAgent = ReturnType<typeof groupInstalledAgents>['all'][number] & {
  isAcp: boolean
}

export function selectInstalledAgents(machine?: Machine): DesktopInstalledAgent[] {
  return groupInstalledAgents(machine).all
    .map(row => ({
      ...row,
      isAcp: row.info?.integration === 'acp' || row.type.startsWith('acp:'),
    }))
    .sort((left, right) => agentPriority(machine, left.info) - agentPriority(machine, right.info))
}

export function selectInstallableAgents(
  machine: Machine | undefined,
  installedAgents: DesktopInstalledAgent[],
  catalog: DesktopMachineAgentCatalogEntry[],
): DesktopInstallableAgent[] {
  if (!machine) return []
  const installedTypes = new Set(machine.agentList)
  const installedNames = new Set(installedAgents.map(({ type, info }) =>
    getAgentDisplayName(type, info?.display?.name).trim().toLowerCase()))
  const builtin = getInstallableBuiltinAgents(machine.agentList).map(type => ({
    key: `builtin:${type}`,
    name: getAgentDisplayName(type),
  }))
  const builtinNames = new Set(builtin.map(agent => agent.name.toLowerCase()))
  const platformPrefix = machinePlatformPrefix(machine.os)
  const dynamic = catalog
    .filter(agent => !agent.platforms?.length || agent.platforms.some(platform => platform.startsWith(platformPrefix)))
    .filter(agent => !['codebuddy-code', 'codex-acp', 'opencode'].includes(agent.id))
    .filter(agent => !installedTypes.has(`acp:${agent.id}`))
    .filter(agent => !installedNames.has(agent.name.trim().toLowerCase()))
    .filter(agent => !builtinNames.has(agent.name.trim().toLowerCase()))
    .map(agent => ({ key: `catalog:${agent.id}`, name: agent.name }))
  return [...builtin, ...dynamic]
}

function agentPriority(machine: Machine | undefined, info?: AgentInfo): number {
  const status = getAgentStatusKind(Boolean(machine?.online), info)
  return status === 'auth_required' ? 0 : status === 'version_mismatch' ? 1 : 2
}

function machinePlatformPrefix(os: string): string {
  const normalized = os.toLowerCase()
  if (normalized === 'darwin' || normalized === 'macos') return 'darwin-'
  if (normalized === 'win32' || normalized === 'windows') return 'windows-'
  return 'linux-'
}
