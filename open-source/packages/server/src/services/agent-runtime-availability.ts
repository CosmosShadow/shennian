// @arch open-source/docs/server-runtime.md
// @test src/__tests__/agent-runtime-availability.test.ts

import type { AgentRuntimeAvailability, RoomBindingStatus } from '@shennian/wire'

type MachineRuntimeState = {
  paired: boolean
  online: boolean
} | null | undefined

export function deriveAgentRuntimeAvailability(
  machine: MachineRuntimeState,
): AgentRuntimeAvailability {
  return machine?.paired && machine.online ? 'available' : 'unavailable'
}

export function deriveRoomBindingAvailability(input: {
  status: RoomBindingStatus | string
  machine: MachineRuntimeState
  recovering?: boolean
}): AgentRuntimeAvailability {
  if (input.recovering) return 'recovering'
  if (input.status !== 'active' && input.status !== 'paused') return 'unavailable'
  return deriveAgentRuntimeAvailability(input.machine)
}

export function deriveAgentRepairAction(input: {
  availability: AgentRuntimeAvailability
  detachedReason?: string | null
}): 'configure' | 'retry' | null {
  if (input.detachedReason === 'recovery_failed') return 'retry'
  if (input.availability === 'recovering' || input.availability === 'available') return null
  return 'configure'
}
