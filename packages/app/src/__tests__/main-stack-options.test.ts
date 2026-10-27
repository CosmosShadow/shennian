// @covers src/components/mainStackOptions.ts
// @covers src/components/MainStack.tsx
import { describe, expect, it } from 'vitest'
import { mainStackOptions, projectFlowTransition, usesJSMainStack, withoutNextCardProgress } from '../components/mainStackOptions'
import type { StackCardInterpolationProps } from '@react-navigation/stack'

describe('main iOS JS stack options', () => {
  it('uses live JS cards on both mobile platforms while preserving the Web navigator', () => {
    expect(usesJSMainStack('ios')).toBe(true)
    expect(usesJSMainStack('android')).toBe(true)
    expect(usesJSMainStack('web')).toBe(false)
  })
  it('retains the current gesture but strips a departing card progress from the underlay', () => {
    const props = { current: { progress: 1 }, next: { progress: 0.5 }, layouts: { screen: { width: 402 } } }
    let received: unknown
    const interpolate = withoutNextCardProgress(input => { received = input; return {} })
    interpolate(props as unknown as StackCardInterpolationProps)
    expect(received).toEqual({ ...props, next: undefined })
    expect(props.next.progress).toBe(0.5)
  })
  it('does not erase navigator defaults with absent per-screen options', () => {
    expect(mainStackOptions({}, 390)).toEqual({ freezeOnBlur: false })
  })
  it('keeps tab switches unanimated and disables gestures without freezing cards', () => {
    expect(mainStackOptions({ animation: 'none', gestureEnabled: false }, 390)).toMatchObject({
      animation: 'none', gestureEnabled: false, freezeOnBlur: false,
    })
  })
  it('preserves detail animation, background and full-screen back gestures', () => {
    expect(mainStackOptions({ animation: 'slide_from_right', fullScreenGestureEnabled: true,
      gestureEnabled: true, contentStyle: { backgroundColor: '#123456' } }, 390)).toMatchObject({
      animation: 'slide_from_right', gestureEnabled: true, gestureResponseDistance: 390,
      cardStyle: { backgroundColor: '#123456' }, freezeOnBlur: false,
    })
  })
  it('does not widen room workspace edge gestures', () => {
    expect(mainStackOptions({ fullScreenGestureEnabled: false, gestureEnabled: true }, 390)
      .gestureResponseDistance).toBeUndefined()
  })
})


it('bounds only project-flow slides and leaves other transition presets unchanged', () => {
  for (const name of ['project', 'create-project']) {
    const spec = projectFlowTransition(name).transitionSpec!
    expect(spec.open.animation).toBe('timing')
    expect(spec.close.animation).toBe('timing')
    if (spec.open.animation !== 'timing' || spec.close.animation !== 'timing') throw new Error('timing expected')
    expect(spec.open.config.duration).toBe(260)
    expect(spec.close.config.duration).toBe(220)
    const ease = spec.open.config.easing!
    expect(ease(0)).toBe(0)
    expect(ease(0.5)).toBeGreaterThan(0.5)
    expect(ease(1)).toBe(1)
  }
  expect(projectFlowTransition('(tabs)')).toEqual({})
  expect(projectFlowTransition('chat/[sessionId]/index')).toEqual({})
})
