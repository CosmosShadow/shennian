// @arch docs/architecture/session-organization.md
// @test scripts/__tests__/mobile-e2e-navigation.test.mjs
// @test packages/app/src/__tests__/project-session-realtime-list.test.ts

import { memo, useCallback, useRef } from 'react'
import { Alert, Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import Feather from '@expo/vector-icons/Feather'
import { Swipeable } from 'react-native-gesture-handler'
import { getProjectDisplayName, type SessionProject } from '@shennian/shared'
import type { RelayConnectivityPhase } from '@shennian/wire'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../hooks/useTheme'
import { mobileTypography } from '../../../theme/mobileTypography'
import { getPinnedSurfaceColor, getPressedSurfaceColor } from '../../session-list/pinnedPalette'
import { UnreadCountBadge } from '../../unread/UnreadCountBadge'
import { useMachinePresentationState } from '../../../hooks/useMachinePresentationState'

type Props = {
  project: SessionProject
  pinned: boolean
  showMachineName: boolean
  onPress: () => void
  onTogglePin: () => void
  onRemove?: () => void
  unreadCount: number
  runningCount: number
  machineOnline: boolean | null
  machineName: string
  relayPhase: RelayConnectivityPhase | null
}

export const MobileProjectListItem = memo(
  function MobileProjectListItem({
    project,
    pinned,
    showMachineName,
    onPress,
    onTogglePin,
    onRemove,
    unreadCount,
    runningCount,
    machineOnline,
    machineName,
    relayPhase,
  }: Props) {
    const { t } = useTranslation()
    const { colors, isDark } = useTheme()
    const title = getProjectDisplayName(project, { showMachineName })
    const machineState = useMachinePresentationState(machineOnline, relayPhase)
    const machineUnavailable = machineState === 'reconnecting' || machineState === 'offline'
    const machineStatusLabel =
      machineState === 'reconnecting'
        ? t('machine_reconnecting')
        : machineState === 'offline'
          ? t('machine_offline')
          : null
    const accessibleMachineStatusLabel =
      machineState === 'offline'
        ? t('machine_not_online_named', { machine: machineName })
        : machineStatusLabel
    // Phone connectivity does not determine whether the remote Agent is working.
    const isRunning = runningCount > 0
    const swipeRef = useRef<Swipeable>(null)

    const confirmRemove = useCallback(() => {
      swipeRef.current?.close()
      Alert.alert(t('remove_project'), t('remove_project_confirm'), [
        { text: t('cancel'), style: 'cancel' },
        { text: t('remove_project'), style: 'destructive', onPress: onRemove },
      ])
    }, [onRemove, t])

    const showActions = useCallback(() => {
      Alert.alert(title, undefined, [
        { text: pinned ? t('unpin_project') : t('pin_project'), onPress: onTogglePin },
        ...(onRemove
          ? [{ text: t('remove_project'), style: 'destructive' as const, onPress: confirmRemove }]
          : []),
        { text: t('cancel'), style: 'cancel' },
      ])
    }, [title, pinned, onTogglePin, onRemove, confirmRemove, t])

    const renderRightActions = useCallback(
      (
        _progress: Animated.AnimatedInterpolation<number>,
        dragX: Animated.AnimatedInterpolation<number>,
      ) => {
        const scale = dragX.interpolate({
          inputRange: [-80, 0],
          outputRange: [1, 0.5],
          extrapolate: 'clamp',
        })
        return (
          <Pressable
            style={styles.removeAction}
            onPress={confirmRemove}
            accessibilityLabel={t('remove_project')}
          >
            <Animated.View style={{ transform: [{ scale }] }}>
              <Feather name="trash-2" size={18} color="#fff" />
            </Animated.View>
          </Pressable>
        )
      },
      [confirmRemove, t],
    )

    const content = (
      <Pressable
        testID="project-list-item"
        style={({ pressed }) => [
          styles.container,
          {
            backgroundColor: pressed
              ? getPressedSurfaceColor(colors, isDark)
              : pinned
                ? getPinnedSurfaceColor(colors, isDark)
                : colors.bg,
            borderBottomColor: colors.border,
          },
        ]}
        onPress={onPress}
        accessibilityLabel={`${title}, ${accessibleMachineStatusLabel ?? (isRunning ? t('working') : '')}`.replace(
          /, $/,
          '',
        )}
        onLongPress={showActions}
      >
        <View style={styles.row}>
          <View style={styles.left}>
            <Ionicons
              name={isRunning ? 'folder-open-outline' : 'folder-outline'}
              size={17}
              color={
                isRunning
                  ? colors.brand
                  : machineUnavailable
                    ? colors.textSecondary
                    : colors.textSecondary
              }
            />
            <Text
              style={[
                styles.title,
                {
                  color: isRunning
                    ? colors.brand
                    : machineUnavailable
                      ? colors.textSecondary
                      : colors.text,
                },
              ]}
              numberOfLines={1}
              ellipsizeMode="middle"
            >
              {title}
            </Text>
          </View>
          <View style={styles.right}>
            {machineStatusLabel ? (
              <Text
                style={[styles.machineStatus, { color: colors.textSecondary }]}
                numberOfLines={1}
              >
                {machineStatusLabel}
              </Text>
            ) : null}
            <UnreadCountBadge count={unreadCount} testID="project-unread-dot" />
          </View>
        </View>
      </Pressable>
    )

    if (Platform.OS === 'web' || !onRemove) return content
    return (
      <Swipeable
        ref={swipeRef}
        renderRightActions={renderRightActions}
        overshootRight={false}
        friction={2}
        rightThreshold={28}
      >
        {content}
      </Swipeable>
    )
  },
  (previous, next) =>
    previous.project.id === next.project.id &&
    previous.project.key === next.project.key &&
    previous.project.machineId === next.project.machineId &&
    previous.project.machineName === next.project.machineName &&
    previous.project.workDir === next.project.workDir &&
    previous.project.dirName === next.project.dirName &&
    previous.unreadCount === next.unreadCount &&
    previous.runningCount === next.runningCount &&
    previous.machineOnline === next.machineOnline &&
    previous.machineName === next.machineName &&
    previous.relayPhase === next.relayPhase &&
    previous.pinned === next.pinned &&
    previous.showMachineName === next.showMachineName &&
    Boolean(previous.onRemove) === Boolean(next.onRemove),
)

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginLeft: 12,
  },
  title: {
    ...mobileTypography.listTitle,
    flexShrink: 1,
  },
  machineStatus: { ...mobileTypography.metadata, flexShrink: 0 },
  removeAction: {
    width: 76,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
})
