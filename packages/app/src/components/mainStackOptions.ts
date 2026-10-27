// @arch docs/architecture/mobile-navigation.md
// @test src/__tests__/main-stack-options.test.ts
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack'
import type { StackCardStyleInterpolator, StackNavigationOptions } from '@react-navigation/stack'

export function usesJSMainStack(platform: string) {
  return platform === 'ios' || platform === 'android'
}

/** Retained roots must not keep a departing card's parallax transform. */
export function withoutNextCardProgress(interpolate: StackCardStyleInterpolator): StackCardStyleInterpolator {
  return props => interpolate({ ...props, next: undefined })
}

/** Only the main layout's supported options cross the native/JS stack boundary. */
export function mainStackOptions(
  options: NativeStackNavigationOptions = {},
  width: number,
): StackNavigationOptions {
  const mapped: StackNavigationOptions = {
    headerShown: options.headerShown,
    title: options.title,
    animation: options.animation === 'flip' || options.animation === 'simple_push'
      || options.animation === 'ios_from_right' ? 'slide_from_right'
      : options.animation === 'ios_from_left' ? 'slide_from_left' : options.animation,
    gestureEnabled: options.gestureEnabled,
    gestureResponseDistance: options.fullScreenGestureEnabled ? width : undefined,
    cardStyle: options.contentStyle,
    freezeOnBlur: false,
  }
  // An absent per-screen option must not erase the navigator's shared defaults.
  return Object.fromEntries(Object.entries(mapped).filter(([, value]) => value !== undefined))
}

/** Bound the project flow's settling tail without removing native-driven slides
 * or the interactive back gesture. Other routes keep their existing presets. */
const projectSlideEaseOut = (t: number) => 1 - Math.pow(1 - t, 3)

export function projectFlowTransition(routeName: string | undefined): Pick<StackNavigationOptions, 'transitionSpec'> {
  if (routeName !== 'project' && routeName !== 'create-project') return {}
  return { transitionSpec: {
    open: { animation: 'timing', config: { duration: 260, easing: projectSlideEaseOut } },
    close: { animation: 'timing', config: { duration: 220, easing: projectSlideEaseOut } },
  } }
}
