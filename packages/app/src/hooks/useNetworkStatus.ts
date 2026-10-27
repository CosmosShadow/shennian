import { useEffect, useState } from 'react'
import { Platform } from 'react-native'
import { nativeNetworkStatus, type NetworkStatus } from './networkStatusState'
import { getNativeNetInfoAdapter } from './nativeNetInfo'

export type { NetworkStatus } from './networkStatusState'

/**
 * 跨平台网络状态监测。
 * - Native: 通过 @react-native-community/netinfo 检测
 * - Web:    通过 navigator.onLine + online/offline 事件
 */
export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>('unknown')

  useEffect(() => {
    if (Platform.OS === 'web') {
      const update = () => setStatus(navigator.onLine ? 'online' : 'offline')
      update()
      window.addEventListener('online', update)
      window.addEventListener('offline', update)
      return () => {
        window.removeEventListener('online', update)
        window.removeEventListener('offline', update)
      }
    }

    const netInfo = getNativeNetInfoAdapter()
    if (!netInfo) return

    const updateNativeStatus = (state: { isConnected: boolean | null }) => {
      setStatus(nativeNetworkStatus(state))
    }
    const unsubscribe = netInfo.addEventListener(updateNativeStatus)
    void netInfo.fetch().then(updateNativeStatus)

    return unsubscribe
  }, [])

  return status
}
