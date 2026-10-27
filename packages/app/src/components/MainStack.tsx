// @arch docs/architecture/mobile-navigation.md
// @test src/__tests__/main-stack-options.test.ts
import type { ComponentProps } from 'react'
import { Dimensions, Platform } from 'react-native'
import { Stack as NativeStack, withLayoutContext } from 'expo-router'
import type { ParamListBase, StackNavigationState } from '@react-navigation/native'
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack'
import { CardStyleInterpolators, createStackNavigator, type StackNavigationEventMap } from '@react-navigation/stack'
import { mainStackOptions, projectFlowTransition, usesJSMainStack, withoutNextCardProgress } from './mainStackOptions'

const horizontalCard = withoutNextCardProgress(CardStyleInterpolators.forHorizontalIOS)

function mobileOptions(options: NativeStackNavigationOptions | undefined, width: number) {
  const mapped = mainStackOptions(options, width)
  if (!mapped.animation) return mapped
  const interpolate = mapped.animation === 'none' ? CardStyleInterpolators.forNoAnimation
    : mapped.animation === 'fade' ? CardStyleInterpolators.forFadeFromCenter
    : mapped.animation === 'fade_from_bottom' ? CardStyleInterpolators.forFadeFromBottomAndroid
    : mapped.animation === 'slide_from_bottom' ? CardStyleInterpolators.forVerticalIOS
    : mapped.animation === 'slide_from_left' ? CardStyleInterpolators.forHorizontalIOSInverted
    : CardStyleInterpolators.forHorizontalIOS
  return { ...mapped, cardStyleInterpolator: withoutNextCardProgress(interpolate) }
}

const { Navigator } = createStackNavigator()
const RouterStack = withLayoutContext<
  NativeStackNavigationOptions,
  typeof Navigator,
  StackNavigationState<ParamListBase>,
  StackNavigationEventMap
>(Navigator, screens => screens.map(screen => {
  const options = screen.options
  return {
    ...screen,
    options: typeof options === 'function'
      ? args => ({ ...projectFlowTransition(screen.name), ...mobileOptions(options(args), Dimensions.get('window').width) })
      : { ...projectFlowTransition(screen.name), ...mobileOptions(options, Dimensions.get('window').width) },
  }
}))

type MobileStackProps = Omit<ComponentProps<typeof RouterStack>, 'screenOptions'> & {
  screenOptions?: NativeStackNavigationOptions
}

function MobileStack({ screenOptions, ...props }: MobileStackProps) {
  // Fabric native-stack reorders retained route keys into snapshot controllers
  // on iOS, or an empty screen on Android. Both need live JS cards.
  // Plain JS cards retain the live route instances without recycling RNSScreen.
  // This uses only native modules already present in the released runtime.
  return <RouterStack {...props} detachInactiveScreens={false}
    screenOptions={{ cardStyleInterpolator: horizontalCard,
      ...mobileOptions(screenOptions, Dimensions.get('window').width) }} />
}

export const Stack = usesJSMainStack(Platform.OS)
  ? Object.assign(MobileStack, { Screen: RouterStack.Screen })
  : NativeStack
