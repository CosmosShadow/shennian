// @arch docs/features/desktop-machine-access-boundary.md
// @test src/__tests__/machine-access-policy.test.ts

import type { Machine } from '@shennian/wire'

type MachineOwnership = Pick<Machine, 'role'>

export type MachineSharingSurfaceState = 'loading' | 'owner' | 'forbidden' | 'missing'

/**
 * Missing `role` is an owner for compatibility with servers released before
 * machine sharing added the explicit ownership projection.
 */
export function isMachineOwner(machine: MachineOwnership | null | undefined): boolean {
  return Boolean(machine && machine.role !== 'granted')
}

/**
 * The sharing route is not an authorization boundary (the Server remains
 * authoritative), but it must fail closed instead of rendering owner actions
 * to a grantee or while a missing machine is still being reconciled.
 */
export function getMachineSharingSurfaceState(
  machine: MachineOwnership | null | undefined,
  inventory: { loading: boolean; remoteResolved: boolean },
): MachineSharingSurfaceState {
  if (machine) return isMachineOwner(machine) ? 'owner' : 'forbidden'
  if (inventory.loading || !inventory.remoteResolved) return 'loading'
  return 'missing'
}
