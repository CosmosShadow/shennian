// @arch docs/features/desktop-settings-information-architecture.md
// @test ../../__tests__/desktop-machine-list-projection.test.ts

import type { Machine } from '@shennian/wire'

export type DesktopMachineSummary = {
  total: number
  online: number
}

export type DesktopMachineSummaryTone = 'complete' | 'partial' | 'offline' | 'inactive'

export function getDesktopMachineSummary(machines: Machine[]): DesktopMachineSummary {
  return {
    total: machines.length,
    online: machines.filter(
      (machine) => Boolean(machine.online) && !machine.remoteAccessDisabledAt,
    ).length,
  }
}

export function getDesktopMachineSummaryTone(
  summary: DesktopMachineSummary,
): DesktopMachineSummaryTone {
  if (summary.total > 0 && summary.online === summary.total) return 'complete'
  if (summary.online > 0) return 'partial'
  return summary.total > 0 ? 'offline' : 'inactive'
}
