// @arch docs/features/desktop-machine-access-boundary.md
// @arch docs/features/desktop-daemon-pause-lifecycle.md
// @test ../../__tests__/desktop-machine-detail.test.ts
import type { Machine } from '@shennian/wire'
import { isMachineOwner } from '../machines/utils/machineAccessPolicy'
import { canPauseMachineRemoteAccess, parseRemoteAccessPauseAcknowledgement } from '../machines/utils/remote-access-pause'
import type { desktopMachinePort } from './desktopMachinePort'
import type { DesktopBridge } from '../desktop-control/types'

export async function runDesktopLocalServiceAction(
  bridge: Pick<DesktopBridge, 'startDaemon' | 'stopDaemon'>,
  action: 'start' | 'stop',
  failureMessage: string,
) {
  const result = action === 'start' ? await bridge.startDaemon() : await bridge.stopDaemon()
  if (result.error) throw new Error(result.error)
  const succeeded = action === 'start'
    ? result.running && !result.stale && !result.remoteAccessDisabled
    : !result.running && result.remoteAccessDisabled === true
  if (!succeeded) throw new Error(failureMessage)
  return result
}

export function createDesktopMachineDetailCommands(options: {
  current(): boolean
  machine(): Machine | undefined
  port: Pick<typeof desktopMachinePort, 'rename' | 'remove' | 'setUpgradePolicy' | 'pauseRemoteAccess'>
}) {
  const machine = () => {
    const value = options.machine()
    if (!options.current() || !value || !isMachineOwner(value)) throw new Error('Machine access is no longer available')
    return value
  }
  const check = () => { if (!options.current()) throw new Error('Machine access is no longer available') }
  return {
    async rename(name: string) {
      const value = machine()
      if (!name.trim()) throw new Error('Machine name is required')
      await options.port.rename(value.id, name.trim()); check()
    },
    async remove() { const value = machine(); await options.port.remove(value.id); check() },
    async setAutoUpgrade(enabled: boolean) {
      const value = machine()
      if (!value.online) throw new Error('Machine is offline')
      const result = await options.port.setUpgradePolicy(value.id, enabled)
      check(); if (!result.ok) throw new Error(result.error ?? 'Machine update failed')
    },
    async pause() {
      const value = machine()
      if (!canPauseMachineRemoteAccess(value)) throw new Error('Machine pause is unavailable')
      const result = await options.port.pauseRemoteAccess(value.id)
      check()
      if (!result.ok || !parseRemoteAccessPauseAcknowledgement(result.payload)) throw new Error(result.error ?? 'Machine pause failed')
    },
  }
}
