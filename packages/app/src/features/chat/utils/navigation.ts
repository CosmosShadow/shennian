// @arch docs/architecture/app/modular-features.md#聊天-feature
// @arch docs/architecture/app/chat-detail-back-swipe.md
// @test src/__tests__/chat-navigation.test.ts

export type FullScreenBackGestureOptions = {
  gestureEnabled?: boolean
  fullScreenGestureEnabled?: boolean
  animationMatchesGesture?: boolean
}

export type ChatGestureOptions = FullScreenBackGestureOptions

export function getIOSFullScreenBackGestureOptions(
  platformOS: string,
): FullScreenBackGestureOptions {
  if (platformOS !== 'ios') return {}
  return {
    gestureEnabled: true,
    fullScreenGestureEnabled: true,
    animationMatchesGesture: true,
  }
}

export const getChatGestureOptions = getIOSFullScreenBackGestureOptions

export function getRoomWorkspaceBackGestureOptions(
  platformOS: string,
  activeSessionId: string | null,
): FullScreenBackGestureOptions {
  return {
    gestureEnabled: platformOS === 'ios' && !activeSessionId,
    fullScreenGestureEnabled: false,
    animationMatchesGesture: true,
  }
}

export const SESSION_SWIPEABLE_BACK_GESTURE_OFFSET = 9999
export const SESSION_SWIPEABLE_CLOSE_GESTURE_OFFSET = 10

export function getSessionSwipeableLeftDragOffset(isOpen: boolean): number {
  return isOpen ? SESSION_SWIPEABLE_CLOSE_GESTURE_OFFSET : SESSION_SWIPEABLE_BACK_GESTURE_OFFSET
}
