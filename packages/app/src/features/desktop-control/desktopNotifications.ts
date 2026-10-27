// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test ../../__tests__/desktop-notification-integration.test.ts

import type { EventFrame, NianSession } from '@shennian/wire'
import i18n from '../../config/i18n'
import { isDesktopControlSurfaceEnabled } from '../../utils/controlSurfaceLayout'
import { getDesktopControlBridge } from './bridge'
import type { DesktopBridge, DesktopNotificationRequest } from './types'
import {
  buildDesktopRoomNotification,
  buildDesktopSessionNotification,
} from './desktopNotificationEvents'

function publishDesktopNotification(
  request: DesktopNotificationRequest | null,
  bridge: DesktopBridge | null = getDesktopControlBridge(),
): boolean {
  if (!request || !isDesktopControlSurfaceEnabled() || !bridge?.notifications) return false
  void bridge.notifications.show(request).catch(() => {})
  return true
}

export function publishDesktopSessionNotification(
  previous: NianSession | undefined,
  next: NianSession,
): boolean {
  return publishDesktopNotification(buildDesktopSessionNotification(previous, next, i18n.language))
}

export function publishDesktopRoomNotification(
  frame: EventFrame,
  accountId: string | null | undefined,
): boolean {
  return publishDesktopNotification(buildDesktopRoomNotification(frame, accountId, i18n.language))
}
