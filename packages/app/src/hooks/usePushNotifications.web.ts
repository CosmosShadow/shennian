// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test src/__tests__/desktop-notification-integration.test.ts

import { useEffect } from 'react'
import { useRouter } from 'expo-router'
import { getDesktopControlBridge } from '../features/desktop-control/bridge'
import { isDesktopNotificationNavigationRoute } from '../features/desktop-control/desktopNotificationEvents'

export function usePushNotifications() {
  const router = useRouter()

  useEffect(() => {
    const notifications = getDesktopControlBridge()?.notifications
    if (!notifications) return
    return notifications.subscribeNavigation((event) => {
      const route = event.value.route
      if (isDesktopNotificationNavigationRoute(route)) router.replace(route as never)
    })
  }, [router])

  return { expoPushToken: null }
}
