// @arch docs/features/agent-workspaces.md
// @test packages/app/src/__tests__/agent-workspaces-navigation.test.ts

import { isAvailableAgentType, type AgentType, type Machine } from '@shennian/wire'

export type AgentCreationAvailability =
  | { state: 'no-machines' }
  | { state: 'unavailable'; machineId?: string }
  | { state: 'available' }

export function isCreatableAgentType(value: string): value is AgentType {
  return (
    isAvailableAgentType(value) &&
    value !== 'manager' &&
    value !== 'pi' &&
    value !== 'openclaw'
  )
}

export function getCreatableAgentTypes(machine: Machine | undefined): AgentType[] {
  const richAgents = machine?.agents ?? []
  const values = richAgents.length
    ? richAgents.map((agent) => agent.type)
    : (machine?.agentList ?? [])
  return [...new Set(values)].filter(
    (value): value is AgentType => typeof value === 'string' && isCreatableAgentType(value),
  )
}

export function resolveAgentCreationAvailability(
  machines: readonly Machine[],
): AgentCreationAvailability {
  if (machines.length === 0) return { state: 'no-machines' }
  const owned = machines.filter((machine) => machine.role !== 'granted')
  if (owned.some((machine) => machine.online && getCreatableAgentTypes(machine).length > 0)) {
    return { state: 'available' }
  }
  return { state: 'unavailable', machineId: owned.length === 1 ? owned[0]!.id : undefined }
}
