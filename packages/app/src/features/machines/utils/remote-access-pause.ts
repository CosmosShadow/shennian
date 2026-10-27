// @arch docs/features/platform-security-boundary.md
// @test src/__tests__/remote-access-pause.test.ts

import type { Machine } from '@shennian/wire'

export function canPauseMachineRemoteAccess(machine: Machine): boolean {
  return machine.role !== 'granted' && machine.online && !machine.remoteAccessDisabledAt
}

export function isRemoteAccessPauseUnsupported(error: unknown): boolean {
  const value = error instanceof Error ? error.message : String(error ?? '')
  return value.includes('Unknown method: machine.remote-access.pause')
    || value.includes('upgrade_required')
}

export function parseRemoteAccessPauseAcknowledgement(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const disabledAt = (payload as { remoteAccessDisabledAt?: unknown }).remoteAccessDisabledAt
  if (typeof disabledAt !== 'string' || disabledAt.length === 0) return null
  return Number.isNaN(Date.parse(disabledAt)) ? null : disabledAt
}
