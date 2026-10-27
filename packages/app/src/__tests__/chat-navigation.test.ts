// @arch docs/architecture/app/chat-detail-back-swipe.md
// @covers packages/app/src/features/chat/utils/navigation.ts

import { describe, expect, it } from 'vitest'
import {
  getChatGestureOptions,
  getIOSFullScreenBackGestureOptions,
  getRoomWorkspaceBackGestureOptions,
  getSessionSwipeableLeftDragOffset,
  SESSION_SWIPEABLE_BACK_GESTURE_OFFSET,
  SESSION_SWIPEABLE_CLOSE_GESTURE_OFFSET,
} from '../features/chat/utils/navigation'

describe('chat navigation utils', () => {
  it('enables full screen back gesture on ios only', () => {
    const expectedOptions = {
      gestureEnabled: true,
      fullScreenGestureEnabled: true,
      animationMatchesGesture: true,
    }
    expect(getChatGestureOptions('ios')).toEqual(expectedOptions)
    expect(getIOSFullScreenBackGestureOptions('ios')).toEqual(expectedOptions)
    expect(getChatGestureOptions('android')).toEqual({})
    expect(getChatGestureOptions('web')).toEqual({})
    expect(getIOSFullScreenBackGestureOptions('android')).toEqual({})
    expect(getIOSFullScreenBackGestureOptions('web')).toEqual({})
  })

  it('keeps session swipe actions from stealing back gestures', () => {
    expect(SESSION_SWIPEABLE_BACK_GESTURE_OFFSET).toBeGreaterThan(320)
    expect(getSessionSwipeableLeftDragOffset(false)).toBe(SESSION_SWIPEABLE_BACK_GESTURE_OFFSET)
  })

  it('lets an exposed session delete action close with a right swipe', () => {
    expect(getSessionSwipeableLeftDragOffset(true)).toBe(SESSION_SWIPEABLE_CLOSE_GESTURE_OFFSET)
    expect(SESSION_SWIPEABLE_CLOSE_GESTURE_OFFSET).toBeLessThan(20)
  })

  it('moves through source, Room, and Agent one surface at a time', () => {
    expect(getRoomWorkspaceBackGestureOptions('ios', null)).toEqual({
      gestureEnabled: true,
      fullScreenGestureEnabled: false,
      animationMatchesGesture: true,
    })
    expect(getRoomWorkspaceBackGestureOptions('ios', 'agent-session')).toEqual({
      gestureEnabled: false,
      fullScreenGestureEnabled: false,
      animationMatchesGesture: true,
    })
    expect(getRoomWorkspaceBackGestureOptions('android', null).gestureEnabled).toBe(false)
  })
})
