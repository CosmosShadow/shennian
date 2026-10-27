// @arch docs/features/desktop-settings-information-architecture.md

import { useState } from 'react'
import { Pressable, Text } from 'react-native'
import type { DesktopUpdateState } from '../desktop-control/types'
import type { useTheme } from '../../hooks/useTheme'
import { desktopControlMetrics, desktopTypography } from '../desktop-shell/desktopDesignTokens'

export function getDesktopUpdateMessage(
  state: DesktopUpdateState | null,
  appVersionLabel: string,
): string {
  if (!state) return `当前版本 ${appVersionLabel}。可以手动检查桌面端更新。`
  if (state.status === 'idle') return `当前版本 ${appVersionLabel}。可以手动检查桌面端更新。`
  if (state.status === 'checking') return '正在检查桌面端更新…'
  if (state.status === 'not-available') return state.message ?? '当前已是最新版本。'
  if (state.status === 'available') return state.message ?? `发现新版本 ${state.version}。`
  if (state.status === 'downloading') return `正在下载更新 ${Math.round(state.percent)}%。`
  if (state.status === 'verifying') return '下载完成，正在验证更新。验证通过后即可重启安装。'
  if (state.status === 'downloaded') return state.message ?? '更新已准备好，可以重启或退出时安装。'
  return state.message ?? '检查更新失败。'
}

export function VersionActionButton({
  label,
  onPress,
  colors,
  primary,
  disabled,
}: {
  label: string
  onPress: () => void
  colors: ReturnType<typeof useTheme>['colors']
  primary?: boolean
  disabled?: boolean
}) {
  const [focused, setFocused] = useState(false)
  const [hovered, setHovered] = useState(false)
  return (
    <Pressable
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-disabled={Boolean(disabled)}
      onFocus={event => setFocused((event.nativeEvent.target as unknown as HTMLElement)?.matches?.(':focus-visible') ?? false)}
      onBlur={() => setFocused(false)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [
        { minHeight: desktopControlMetrics.compactControlHeight, paddingHorizontal: 12,
          paddingVertical: 6, borderRadius: desktopControlMetrics.radiusControl,
          justifyContent: 'center', alignItems: 'center', borderWidth: 1,
          borderColor: focused ? colors.brand : 'transparent',
          backgroundColor: primary ? colors.brand : colors.surfaceHover,
          opacity: pressed || hovered ? 0.85 : 1 },
        disabled && { opacity: 0.55 },
      ]}
      onPress={onPress}
    >
      <Text
        style={[
          desktopTypography.control,
          { color: primary ? '#fff' : colors.text },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  )
}
