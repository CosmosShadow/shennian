// @arch docs/architecture/app/modular-features.md
// @test src/__tests__/connection-status-indicator.test.ts

import { useEffect, useMemo, useRef } from 'react'
import { Animated, Easing, StyleSheet, Text, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import type { Colors } from '../hooks/useTheme'
import {
  type ConnectionStatusIndicatorSize,
  getConnectionStatusIndicatorMetrics,
  getConnectionStatusIndicatorPalette,
} from './connectionStatusIndicator.helpers'

type SpinnerProps = {
  colors: Colors
  isDark: boolean
  size?: ConnectionStatusIndicatorSize
}

export function ConnectionStatusSpinner({ colors, isDark, size = 'regular' }: SpinnerProps) {
  const spin = useRef(new Animated.Value(0)).current
  const metrics = getConnectionStatusIndicatorMetrics(size)
  const palette = getConnectionStatusIndicatorPalette(colors, isDark)

  useEffect(() => {
    spin.setValue(0)
    const animation = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 820,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    )
    animation.start()
    return () => animation.stop()
  }, [spin])

  const rotate = useMemo(
    () =>
      spin.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '360deg'],
      }),
    [spin],
  )

  const radius = (metrics.spinnerSize - metrics.strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const dashLength = circumference * 0.36
  const center = metrics.spinnerSize / 2

  return (
    <Animated.View
      style={[
        styles.spinnerWrap,
        {
          width: metrics.spinnerSize,
          height: metrics.spinnerSize,
          transform: [{ rotate }],
        },
      ]}
    >
      <Svg
        width={metrics.spinnerSize}
        height={metrics.spinnerSize}
        viewBox={`0 0 ${metrics.spinnerSize} ${metrics.spinnerSize}`}
      >
        <Circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={palette.trackColor}
          strokeWidth={metrics.strokeWidth}
        />
        <Circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={palette.arcColor}
          strokeWidth={metrics.strokeWidth}
          strokeDasharray={`${dashLength} ${circumference}`}
          strokeLinecap="round"
          transform={`rotate(-86 ${center} ${center})`}
        />
      </Svg>
    </Animated.View>
  )
}

type Props = SpinnerProps & {
  label: string
}

export function ConnectionStatusIndicator({ label, colors, isDark, size = 'regular' }: Props) {
  const metrics = getConnectionStatusIndicatorMetrics(size)
  const palette = getConnectionStatusIndicatorPalette(colors, isDark)

  return (
    <View style={[styles.row, { gap: metrics.gap }]}>
      <ConnectionStatusSpinner colors={colors} isDark={isDark} size={size} />
      <Text
        style={[
          styles.label,
          {
            color: palette.textColor ?? palette.fallbackColor,
            fontSize: metrics.textSize,
            fontWeight: metrics.textWeight,
          },
        ]}
      >
        {label}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    letterSpacing: 0.1,
  },
  spinnerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
})
