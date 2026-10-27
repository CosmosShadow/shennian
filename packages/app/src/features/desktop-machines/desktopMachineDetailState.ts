// @arch docs/design/desktop/unified-desktop-control.md
// @test ../../__tests__/desktop-machine-detail.test.ts

import type { MachineListSurfaceState } from '../machines/services/machineListState'

export type DesktopMachineDetailSurface =
  | { kind: 'content'; notice: 'offline' | 'error' | null }
  | { kind: 'loading' | 'forbidden' | 'missing' | 'offline' | 'error' }

/**
 * A detail page owns one primary state. Cached content may keep a compact
 * connectivity notice, but an unavailable machine never renders two empty
 * states at the same time.
 */
export function resolveDesktopMachineDetailSurface(
  machineAvailable: boolean,
  listSurface: MachineListSurfaceState,
): DesktopMachineDetailSurface {
  if (listSurface === 'forbidden') return { kind: 'forbidden' }
  if (machineAvailable) {
    return {
      kind: 'content',
      notice: listSurface === 'offline' || listSurface === 'error' ? listSurface : null,
    }
  }
  if (listSurface === 'initial-loading' || listSurface === 'refreshing') return { kind: 'loading' }
  if (listSurface === 'offline') return { kind: 'offline' }
  if (listSurface === 'error') return { kind: 'error' }
  return { kind: 'missing' }
}
