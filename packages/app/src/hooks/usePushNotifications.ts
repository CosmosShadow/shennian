import { offerRecordingNotification } from '../features/personal-modules/runtime'
// @arch docs/architecture/app/mobile-push.md
// @test src/__tests__/app-config.test.ts

import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, Platform } from 'react-native'
import type { Subscription } from 'expo-notifications'
import { useNavigationContainerRef, useRootNavigationState, useRouter } from 'expo-router'
import type { NavigationState, PartialState } from '@react-navigation/native'
import { useSessionsStore } from '@shennian/shared'
import { authApi } from '../config/api'
import { useAuthStore } from '../config/auth'
import { scheduleNativeBadgeSync, syncNativeBadgeCount } from '../lib/push-badge'
import type { NotificationSessionData } from '../lib/notification-session-context'
import { db } from '../storage/db'
import { sessionAccountClient } from '../features/sessions/sessionAccountClient'
import { buildNotificationNavigationState } from '../features/notifications/notificationNavigation'
import { rememberMobileRootTab } from '../components/mobileRootTabPreference'
import { nativePushEnabled } from '../lib/native-push-policy'

type NotificationData = NotificationSessionData & {
  sessionId?: string
  roomId?: string
  runId?: string
  [key: string]: unknown
}

type JPushNotificationEvent = {
  notificationEventType?: 'notificationArrived' | 'notificationOpened'
  title?: string
  content?: string
  extras?: Record<string, string>
}

type ExpoNotificationResponse = {
  notification: {
    request: {
      identifier?: string
      content: { body?: string | null; data: NotificationData }
    }
  }
}

const JPUSH_APP_KEY = process.env.EXPO_PUBLIC_JPUSH_APP_KEY?.trim() ?? ''
const JPUSH_CHANNEL = process.env.EXPO_PUBLIC_JPUSH_CHANNEL?.trim() ?? 'default'

async function registerProvider(
  provider: 'expo' | 'jpush',
  platform: string,
  pushToken: string | null,
): Promise<void> {
  await authApi('/devices/push-token', {
    method: 'POST',
    body: JSON.stringify({
      provider,
      platform,
      pushToken,
    }),
  })
}

async function requestNativePushPermission(): Promise<boolean> {
  const Notifications = require('expo-notifications')
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: false,
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: true,
    }),
  })

  const { status: existingStatus } = await Notifications.getPermissionsAsync()
  let finalStatus = existingStatus
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync()
    finalStatus = status
  }
  return finalStatus === 'granted'
}

async function registerExpoToken(): Promise<string | null> {
  try {
    const Notifications = require('expo-notifications')
    const Constants = require('expo-constants').default
    const projectId =
      Constants?.easConfig?.projectId ?? Constants?.expoConfig?.extra?.eas?.projectId ?? null
    const token = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync()
    console.info('[push] expo token acquired', {
      platform: Platform.OS,
      projectIdPresent: Boolean(projectId),
    })
    return token.data
  } catch (error) {
    console.warn('[push] failed to acquire expo token', {
      platform: Platform.OS,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

type JPushModule = typeof import('jpush-react-native').default

async function registerJPushToken(
  jpushReady: Promise<JPushModule | null> | null,
): Promise<string | null> {
  if (Platform.OS !== 'android' || !JPUSH_APP_KEY || !jpushReady) return null

  try {
    const JPush = await jpushReady
    if (!JPush) return null

    const registrationId = await new Promise<string>((resolve) => {
      let attempts = 0
      const timer = setInterval(() => {
        attempts += 1
        JPush.getRegistrationID((result: { registerID?: string }) => {
          const id = result.registerID?.trim() ?? ''
          if (id) {
            clearInterval(timer)
            resolve(id)
          } else if (attempts >= 8) {
            clearInterval(timer)
            resolve('')
          }
        })
      }, 800)
    })

    return registrationId || null
  } catch {
    return null
  }
}

export function usePushNotifications() {
  const router = useRouter()
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null)
  const expoNotificationListener = useRef<Subscription>(null)
  const expoResponseListener = useRef<Subscription>(null)
  const jpushListener = useRef<((event: JPushNotificationEvent) => void) | null>(null)
  const navigationRef = useNavigationContainerRef()
  const rootNavigationState = useRootNavigationState()
  const [pendingNavigationState, setPendingNavigationState] =
    useState<PartialState<NavigationState> | null>(null)
  const token = useAuthStore((s) => s.token)

  const navigateFromData = useCallback(
    async (data?: NotificationData | null) => {
      if (data && typeof (data as Record<string, unknown>).personalReminderKey === 'string') {
        router.navigate({ pathname: '/(main)/personal-modules', params: { tab: 'reminders' } })
        return
      }
      if (!data?.roomId && !data?.sessionId) return
      let session = data.sessionId
        ? useSessionsStore.getState().sessions.find((item) => item.id === data.sessionId)
        : undefined
      if (!session && data.sessionId) {
        session = await db.getSession(data.sessionId).catch(() => undefined)
      }
      if (!session && data.sessionId) {
        session = await sessionAccountClient.getSession(data.sessionId).catch(() => undefined)
      }
      const state = buildNotificationNavigationState(data, session)
      if (!state) return
      const accountId = useAuthStore.getState().user?.id
      rememberMobileRootTab(accountId, data.roomId ? 'shennian' : 'projects')
      if (navigationRef.current?.isReady()) navigationRef.current.resetRoot(state)
      else setPendingNavigationState(state)
    },
    [navigationRef, router],
  )

  useEffect(() => {
    if (!pendingNavigationState || !navigationRef.current?.isReady()) return
    navigationRef.current.resetRoot(pendingNavigationState)
    setPendingNavigationState(null)
  }, [navigationRef, pendingNavigationState, rootNavigationState?.key])

  useEffect(() => {
    if (Platform.OS === 'web' || !token || !nativePushEnabled()) return

    let mounted = true
    const handledResponseIds = new Set<string>()

    // Install response handling before token registration. Those network
    // operations can be slow and must not create a window where a user taps a
    // notification but the app has no listener yet.
    try {
      const Notifications = require('expo-notifications')
      const handleResponse = (response: ExpoNotificationResponse) => {
        const responseId = response.notification.request.identifier
        if (responseId && handledResponseIds.has(responseId)) return
        if (responseId) handledResponseIds.add(responseId)
        scheduleNativeBadgeSync()
        const content = response.notification.request.content
        console.info('[push] notification opened', {
          responseId: responseId ?? null,
          hasSessionId: typeof content.data?.sessionId === 'string',
          hasRoomId: typeof content.data?.roomId === 'string',
        })
        void navigateFromData(content.data)
      }

      expoNotificationListener.current = Notifications.addNotificationReceivedListener(
        (notification: { request: { identifier?: string; content: { title?: string; body?: string; data?: Record<string, unknown> } } }) => {
          const { content, identifier } = notification.request
          offerRecordingNotification(identifier ?? '', content.title ?? '', content.body ?? '', content.data ?? {})
          scheduleNativeBadgeSync()
        },
      )
      expoResponseListener.current =
        Notifications.addNotificationResponseReceivedListener(handleResponse)

      const lastResponse = Notifications.getLastNotificationResponseAsync?.()
      void lastResponse
        ?.then((response: ExpoNotificationResponse | null) => {
          if (!mounted || !response) return
          handleResponse(response)
          return Notifications.clearLastNotificationResponseAsync?.()
        })
        .catch(() => {})
    } catch {
      /* expo-notifications not available */
    }

    // Same reasoning as the Expo listener above: install the JPush listener
    // as soon as the module can be loaded and initialized, in parallel with
    // (not gated behind) the permission prompt and token registration below.
    // Those are slow and must not create a window where a user taps a
    // notification but the app has no JPush listener yet.
    const jpushReady: Promise<JPushModule | null> | null =
      Platform.OS === 'android' && JPUSH_APP_KEY
        ? (async () => {
            try {
              const JPush = (await import('jpush-react-native')).default
              JPush.setLoggerEnable(__DEV__)
              JPush.init({
                appKey: JPUSH_APP_KEY,
                channel: JPUSH_CHANNEL,
                production: !__DEV__,
              })
              if (mounted) {
                const listener = (event: JPushNotificationEvent) => {
                  if (event.notificationEventType === 'notificationArrived') {
                    offerRecordingNotification(event.extras?.msg_id ?? '', event.title ?? '', event.content ?? '', event.extras ?? {})
                    return
                  }
                  if (event.notificationEventType !== 'notificationOpened') return
                  const extras = event.extras ?? {}
                  void navigateFromData(extras as NotificationData)
                }
                jpushListener.current = listener
                JPush.addNotificationListener(listener)
              }
              return JPush
            } catch {
              return null
            }
          })()
        : null

    const setup = async () => {
      const permissionGranted = await requestNativePushPermission().catch(() => false)
      if (!permissionGranted) {
        console.warn('[push] native notification permission denied', { platform: Platform.OS })
      }

      if (permissionGranted) {
        const expoToken = await registerExpoToken()
        if (expoToken) {
          if (mounted) setExpoPushToken(expoToken)
          await registerProvider('expo', Platform.OS, expoToken)
            .then(() => {
              console.info('[push] registered expo provider', { platform: Platform.OS })
            })
            .catch((error) => {
              console.warn('[push] failed to register expo provider', {
                platform: Platform.OS,
                error: error instanceof Error ? error.message : String(error),
              })
            })
        } else {
          console.warn('[push] expo token unavailable after permission grant', {
            platform: Platform.OS,
          })
        }
      } else {
        console.warn('[push] expo token skipped because notification permission is denied', {
          platform: Platform.OS,
        })
      }

      if (!permissionGranted) return

      if (Platform.OS === 'android') {
        const jpushToken = await registerJPushToken(jpushReady)
        if (jpushToken) {
          await registerProvider('jpush', 'android', jpushToken)
            .then(() => {
              console.info('[push] registered jpush provider', { platform: 'android' })
            })
            .catch((error) => {
              console.warn('[push] failed to register jpush provider', {
                platform: 'android',
                error: error instanceof Error ? error.message : String(error),
              })
            })
        } else {
          await registerProvider('jpush', 'android', null).catch(() => {})
        }
      }

      await syncNativeBadgeCount().catch(() => {})
    }

    void setup()

    return () => {
      mounted = false
      expoNotificationListener.current?.remove()
      expoResponseListener.current?.remove()

      if (jpushListener.current) {
        void import('jpush-react-native')
          .then((mod) => mod.default.removeListener(jpushListener.current as never))
          .catch(() => {})
        jpushListener.current = null
      }
    }
  }, [navigateFromData, token])

  useEffect(() => {
    if (Platform.OS === 'web' || !token || !nativePushEnabled()) return

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        scheduleNativeBadgeSync(0)
      }
    })

    return () => {
      subscription.remove()
    }
  }, [token])

  return { expoPushToken }
}
