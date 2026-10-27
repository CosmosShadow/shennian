// @arch docs/architecture/app/mobile-push.md
// @covers packages/app/src/hooks/usePushNotifications.ts

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildNotificationNavigationState } from '../features/notifications/notificationNavigation'

const hookSource = readFileSync(
  join(import.meta.dirname, '../hooks/usePushNotifications.ts'),
  'utf8',
)
const historySource = readFileSync(
  join(import.meta.dirname, '../features/chat/hooks/useChatSessionHistory.ts'),
  'utf8',
)
const navigationSource = readFileSync(
  join(import.meta.dirname, '../features/notifications/notificationNavigation.ts'),
  'utf8',
)

describe('push notification response registration', () => {
  it('installs the response listener before slow provider registration begins', () => {
    const listener = hookSource.indexOf('addNotificationResponseReceivedListener(handleResponse)')
    const registration = hookSource.indexOf('const permissionGranted = await requestNativePushPermission()')

    expect(listener).toBeGreaterThan(-1)
    expect(registration).toBeGreaterThan(-1)
    expect(listener).toBeLessThan(registration)
  })

  it('consumes cold-start responses and clears them after navigation', () => {
    expect(hookSource).toContain('getLastNotificationResponseAsync?.()')
    expect(hookSource).toContain('clearLastNotificationResponseAsync?.()')
    expect(hookSource).toContain('void navigateFromData(content.data)')
    expect(hookSource).toContain('navigationRef.current.resetRoot')
  })

  it('installs the JPush listener before slow permission/token registration begins', () => {
    const listener = hookSource.indexOf('JPush.addNotificationListener(listener)')
    const registration = hookSource.indexOf(
      'const permissionGranted = await requestNativePushPermission()',
    )

    expect(listener).toBeGreaterThan(-1)
    expect(registration).toBeGreaterThan(-1)
    expect(listener).toBeLessThan(registration)
  })

  it('routes a notification into the same painted-history read watermark flow', () => {
    expect(navigationSource).toContain("name: 'chat/[sessionId]/index'")
    expect(historySource).toContain(
      'accountRuntime.markSessionRead(sessionId, new Date().toISOString(), readWatermark)',
    )
  })
})

function mainRoutes(state: ReturnType<typeof buildNotificationNavigationState>) {
  return state?.routes[0]?.state?.routes
}

describe('notification navigation hierarchy', () => {
  it('replaces the app with the room list and selected room', () => {
    expect(mainRoutes(buildNotificationNavigationState({ roomId: 'room-1' }))).toEqual([
      { name: '(tabs)', state: { routes: [{ name: 'home' }] } },
      { name: 'room-workspace', params: { roomId: 'room-1' } },
    ])
  })

  it('replaces the app with projects, the owning project, and the selected conversation', () => {
    expect(mainRoutes(buildNotificationNavigationState(
      { sessionId: 'session-1' },
      { id: 'session-1', machineId: 'machine-1', workDir: '/work/project' },
    ))).toEqual([
      { name: '(tabs)', state: { routes: [{ name: 'projects' }] } },
      { name: 'project', params: { machineId: 'machine-1', workDir: '/work/project' } },
      { name: 'chat/[sessionId]/index', params: { sessionId: 'session-1' } },
    ])
  })

  it('keeps a deterministic projects fallback when metadata is unavailable', () => {
    expect(mainRoutes(buildNotificationNavigationState({ sessionId: 'session-1' }))).toEqual([
      { name: '(tabs)', state: { routes: [{ name: 'projects' }] } },
      { name: 'chat/[sessionId]/index', params: { sessionId: 'session-1' } },
    ])
  })
})
