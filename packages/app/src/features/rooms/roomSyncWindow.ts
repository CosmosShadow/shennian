// @arch docs/features/network-rooms/local-first-persistence.md
// @test src/__tests__/room-replica-sync.test.ts

import type { LocalRoomSyncState } from '@shennian/shared'

type CurrentRoomSyncWindow = Omit<LocalRoomSyncState, 'needsRepair' | 'updatedAt'>

export function mergeRoomSyncWindow(
  existing: LocalRoomSyncState | null,
  current: CurrentRoomSyncWindow,
): LocalRoomSyncState {
  if (!existing) {
    return { ...current, needsRepair: false, updatedAt: new Date().toISOString() }
  }
  const existingCoversEarlier =
    existing.windowStartSequence !== '0' &&
    (current.windowStartSequence === '0' ||
      compareSequence(existing.windowStartSequence, current.windowStartSequence) < 0)
  return {
    ...current,
    windowStartSequence: existingCoversEarlier
      ? existing.windowStartSequence
      : current.windowStartSequence,
    windowEndSequence: maxSequence(existing.windowEndSequence, current.windowEndSequence),
    hasOlder: existingCoversEarlier ? existing.hasOlder : current.hasOlder,
    serverLastSequence: maxSequence(existing.serverLastSequence, current.serverLastSequence),
    needsRepair: false,
    updatedAt: new Date().toISOString(),
  }
}

function compareSequence(left: string, right: string): number {
  const a = BigInt(left)
  const b = BigInt(right)
  return a === b ? 0 : a > b ? 1 : -1
}

function maxSequence(left: string, right: string): string {
  return compareSequence(left, right) >= 0 ? left : right
}
