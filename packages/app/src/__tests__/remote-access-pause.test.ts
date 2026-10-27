// @covers packages/app/src/features/machines/utils/remote-access-pause.ts

import { describe, expect, it } from 'vitest'
import type { Machine } from '@shennian/wire'
import {
  canPauseMachineRemoteAccess,
  isRemoteAccessPauseUnsupported,
  parseRemoteAccessPauseAcknowledgement,
} from '../features/machines/utils/remote-access-pause'

const machine: Machine = {
  id: 'machine-1', name: 'Mac', os: 'darwin', agentList: [], paired: true,
  online: true, lastSeen: '2026-09-05T12:00:00.000Z', role: 'owner',
}

describe('machine remote access pause presentation', () => {
  it('only offers pause to an online owner that is not already paused', () => {
    expect(canPauseMachineRemoteAccess(machine)).toBe(true)
    expect(canPauseMachineRemoteAccess({ ...machine, online: false })).toBe(false)
    expect(canPauseMachineRemoteAccess({ ...machine, role: 'granted', permission: 'admin' })).toBe(false)
    expect(canPauseMachineRemoteAccess({ ...machine, remoteAccessDisabledAt: '2026-09-05T12:01:00.000Z' })).toBe(false)
  })

  it('recognizes old CLI responses and does not present them as success', () => {
    expect(isRemoteAccessPauseUnsupported('Unknown method: machine.remote-access.pause')).toBe(true)
    expect(isRemoteAccessPauseUnsupported(new Error('upgrade_required'))).toBe(true)
    expect(isRemoteAccessPauseUnsupported('machine_offline')).toBe(false)
  })

  it('accepts only the daemon-confirmed server timestamp', () => {
    expect(
      parseRemoteAccessPauseAcknowledgement({
        remoteAccessDisabledAt: '2026-09-05T12:00:00.000Z',
      }),
    ).toBe('2026-09-05T12:00:00.000Z')
    expect(parseRemoteAccessPauseAcknowledgement({})).toBeNull()
    expect(parseRemoteAccessPauseAcknowledgement({ remoteAccessDisabledAt: 'not-a-date' })).toBeNull()
    expect(parseRemoteAccessPauseAcknowledgement(null)).toBeNull()
  })
})
