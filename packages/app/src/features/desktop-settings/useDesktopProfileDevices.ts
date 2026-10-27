// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test ../../__tests__/desktop-profile-devices.test.ts
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useAuthStore } from '../../config/auth'
import { DesktopProfileDevicesModel } from './desktopProfileDevices'
import { desktopSettingsAccountPort } from './desktopSettingsAccountPort'

export function useDesktopProfileDevices() {
  const accountId = useAuthStore(state => state.user?.id ?? null)
  const model = useMemo(() => new DesktopProfileDevicesModel({
    accountId,
    currentAccount: () => useAuthStore.getState().user?.id ?? null,
    subscribeAccount: listener => useAuthStore.subscribe(listener),
    subscribeRevision: listener => accountId ? desktopSettingsAccountPort.subscribeDeviceRevision(accountId, listener) : () => {},
    read: desktopSettingsAccountPort.readDeviceSnapshot,
    refreshRemote: desktopSettingsAccountPort.refreshDevices,
  }), [accountId])
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState)
  useEffect(() => model.start(), [model])
  return { ...state, refresh: model.refresh }
}
