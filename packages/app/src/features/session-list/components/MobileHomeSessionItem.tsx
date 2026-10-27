// @arch docs/design/components.md#6-列表行
// @test src/__tests__/project-session-realtime-list.test.ts
// @test src/__tests__/mobile-session-hierarchy.test.ts
import { useSessionActivityNow } from '../../../hooks/useSessionActivityNow'
// @test scripts/__tests__/mobile-e2e-navigation.test.mjs

import React, { useCallback, useRef, useState, useSyncExternalStore } from 'react'
import { Alert, Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import Feather from '@expo/vector-icons/Feather'
import { Swipeable } from 'react-native-gesture-handler'
import {
  hasSessionExternalChannel,
  isSessionPinned,
  useChatStore,
  useMachinesStore,
  useSessionsStore,
} from '@shennian/shared'
import type { NianSession } from '@shennian/wire'
import { useTranslation } from 'react-i18next'
import { authApi } from '../../../config/api'
import { useTheme } from '../../../hooks/useTheme'
import { useAuthStore } from '../../../config/auth'
import { UnreadCountBadge } from '../../unread/UnreadCountBadge'
import { useSessionUnreadCount } from '../../unread/useSessionUnreadCounts'
import { getChatDraftPreview, subscribeChatDraft } from '../../chat/utils/draftStorage'
import {
  getLatestSendingChatOutboundPreview,
  subscribeChatOutboundMessages,
} from '../../chat/utils/outboundStorage'
import { RenameSessionModal } from '../../chat/components/RenameSessionModal'
import { getSessionSwipeableLeftDragOffset } from '../../chat/utils/navigation'
import { buildSessionDisplay } from '../display'
import { getSessionItemSurfaceColor } from '../sessionItemSurface'
import { mobileTypography } from '../../../theme/mobileTypography'

const MANAGER_CHANNEL_BLUE = '#2563EB'

type Props = {
  session: NianSession
  preview?: string
  coordinationStatus?: string
  hideMachineName?: boolean
  hideProjectName?: boolean
  onPress: () => void
  onDelete: (id: string) => void
  onTogglePin: (session: NianSession) => void
  onToggleUnread: (session: NianSession) => void
  onSwipeableWillOpen?: (swipeable: Swipeable | null) => void
  onSwipeableClose?: (swipeable: Swipeable | null) => void
}

export const MobileHomeSessionItem = React.memo(function MobileHomeSessionItem({
  session,
  preview,
  coordinationStatus,
  hideMachineName = false,
  hideProjectName = true,
  onPress,
  onDelete,
  onTogglePin,
  onToggleUnread,
  onSwipeableWillOpen,
  onSwipeableClose,
}: Props) {
  const { t } = useTranslation()
  const { colors, isDark } = useTheme()
  const swipeRef = useRef<Swipeable>(null)
  const [swipeOpen, setSwipeOpen] = useState(false)
  const [renameVisible, setRenameVisible] = useState(false)
  const [renameInput, setRenameInput] = useState('')
  const [renameSaving, setRenameSaving] = useState(false)
  const upsertSession = useSessionsStore((store) => store.upsertSession)
  const previewAt = useSessionsStore((store) => store.previewTimestamps[session.id])
  const currentUserId = useAuthStore((s) => s.user?.id ?? null)
  const subscribeDraftPreview = useCallback(
    (listener: () => void) => subscribeChatDraft(currentUserId ?? '', session.id, listener),
    [currentUserId, session.id],
  )
  const isOwner = !!currentUserId && session.userId === currentUserId
  const showMaintainer = !isOwner && !!session.sharedMachineSession
  const maintainerName = session.ownerName || session.ownerPhone || session.ownerEmail || t('organization_member_unnamed')
  const isSessionTyping = useChatStore((s) => s.sessionId === session.id && s.isTyping)
  const draftPreview = useSyncExternalStore(
    subscribeDraftPreview,
    () => getChatDraftPreview(currentUserId ?? '', session.id),
    () => getChatDraftPreview(currentUserId ?? '', session.id),
  )
  const sendingPreview = useSyncExternalStore(
    subscribeChatOutboundMessages,
    () => getLatestSendingChatOutboundPreview(currentUserId ?? '', session.id),
    () => getLatestSendingChatOutboundPreview(currentUserId ?? '', session.id),
  )
  const effectiveDraftPreview = draftPreview.trim() === sendingPreview ? '' : draftPreview
  const fallbackMachineName = useMachinesStore(
    (store) => store.machines.find((machine) => machine.id === session.machineId)?.name ?? '',
  )
  const unreadCount = useSessionUnreadCount(session.id)
  const hasUnread = unreadCount > 0
  const isPinned = isSessionPinned(session)
  const hasExternalChannel = hasSessionExternalChannel(session)
  const activityNow = useSessionActivityNow([session])
  const { metaLabel, summary, timeStr } = buildSessionDisplay({
    session,
    preview,
    previewAt,
    draft: effectiveDraftPreview,
    sendingPreview,
    isTyping: isSessionTyping,
    now: activityNow,
    fallbackMachineName,
    workingLabel: `${t('working')}…`,
    toolRunningLabel: t('tool_running'),
    toolRunningCountLabel: t('tool_group_tools_running', {
      count: session.activity?.toolCallCount ?? 0,
    }),
    imageLabel: t('session_preview_image'),
    imagesLabel: (count) => t('session_preview_images', { count }),
    fileLabel: t('session_preview_file'),
    filesLabel: (count) => t('session_preview_files', { count }),
    hideMachineName,
    hideProjectName,
  })
  const isRunning = summary.useActiveColor
  const mutedColor = isPinned ? colors.textMutedOnSurface : colors.textMuted

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
          style={styles.deleteAction}
          onPress={() => {
            swipeRef.current?.close()
            onDelete(session.id)
          }}
        >
          <Animated.View style={{ transform: [{ scale }], alignItems: 'center' }}>
            <Feather name="trash-2" size={18} color="#fff" />
          </Animated.View>
        </Pressable>
      )
    },
    [onDelete, session.id],
  )

  const openRenameModal = useCallback(() => {
    swipeRef.current?.close()
    setRenameInput(session.title ?? '')
    setRenameVisible(true)
  }, [session.title])

  const handleConfirmRename = useCallback(async () => {
    const trimmed = renameInput.trim()
    if (!trimmed) {
      setRenameVisible(false)
      return
    }
    setRenameSaving(true)
    try {
      await authApi(`/sessions/${session.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: trimmed }),
      })
      upsertSession({ ...session, title: trimmed })
      setRenameVisible(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      Alert.alert(t('rename_failed'), message)
    } finally {
      setRenameSaving(false)
    }
  }, [renameInput, session, t, upsertSession])

  const content = (
    <Pressable
      testID="session-list-item"
      accessibilityRole="button"
      accessibilityState={{ busy: summary.showPulse || summary.isSending }}
      accessibilityValue={{
        text: summary.showPulse ? t('working') : summary.isSending ? t('msg_sending') : '',
      }}
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'activate') onPress()
      }}
      style={({ pressed }) => [
        styles.sessionItem,
        {
          backgroundColor: pressed ? colors.surfaceHover : getSessionItemSurfaceColor({
            colors,
            isDark,
            isPinned,
            hasExternalChannel,
          }),
        },
      ]}
      onPress={onPress}
      onLongPress={() => {
        Alert.alert(session.title || t('new_conversation'), undefined, [
          {
            text: isPinned ? t('unpin_session') : t('pin_session'),
            onPress: () => onTogglePin(session),
          },
          {
            text: hasUnread ? t('mark_read') : t('mark_unread'),
            onPress: () => onToggleUnread(session),
          },
          ...(isOwner
            ? [
                {
                  text: t('rename_session'),
                  onPress: openRenameModal,
                },
              ]
            : []),
          { text: t('cancel'), style: 'cancel' },
        ])
      }}
    >
      <View pointerEvents="none" style={[styles.separator, { backgroundColor: colors.border }]} />
      {hasExternalChannel ? (
        <View style={[styles.channelRail, { backgroundColor: MANAGER_CHANNEL_BLUE }]} />
      ) : null}
      <View style={styles.sessionContent}>
        <View style={styles.sessionRow1}>
          <View style={styles.sessionTitleWrap}>
            <Text
              style={[
                styles.sessionTitle,
                {
                  color: isRunning ? colors.brand : colors.text,
                },
              ]}
              numberOfLines={1}
            >
              {session.title || t('new_conversation')}
            </Text>
            {hasExternalChannel ? (
              <View style={[styles.channelBadge, { backgroundColor: `${MANAGER_CHANNEL_BLUE}15`, borderColor: `${MANAGER_CHANNEL_BLUE}35` }]}>
                <Feather name="message-circle" size={11} color={MANAGER_CHANNEL_BLUE} />
              </View>
            ) : null}
            {showMaintainer ? (
              <View style={[styles.readOnlyBadge, { backgroundColor: `${colors.brand}12`, borderColor: `${colors.brand}28` }]}>
                <Text style={[styles.readOnlyBadgeText, { color: colors.brand }]}>{t('session_readonly_badge')}</Text>
              </View>
            ) : null}
          </View>
          <UnreadCountBadge count={unreadCount} />
          {coordinationStatus ? <Text style={[mobileTypography.metadata, { color: colors.brand }]}>{coordinationStatus}</Text> : null}
          {timeStr ? (
            <Text style={[styles.time, { color: mutedColor }]} numberOfLines={1}>
              {timeStr}
            </Text>
          ) : null}
        </View>
        <View style={styles.sessionRow2}>
          <View style={styles.row2Inner}>
            <Text
              style={[
                styles.previewText,
                styles.previewFlex,
                {
                  color: isRunning && !summary.isDraft ? colors.brandMuted : mutedColor,
                },
              ]}
              numberOfLines={1}
            >
              {summary.isDraft ? (
                <Text style={[styles.draftLabel, { color: colors.error }]}>
                  [{t('draft_label')}]{' '}
                </Text>
              ) : null}
              {summary.isSending ? (
                <Text style={[styles.draftLabel, { color: colors.brand }]}>
                  [{t('msg_sending')}]{' '}
                </Text>
              ) : null}
              {summary.text || '\u00A0'}
            </Text>
            {showMaintainer ? (
              <Text style={[styles.metaLabel, { color: mutedColor }]} numberOfLines={1}>
                {t('session_maintained_by', { name: maintainerName })}
              </Text>
            ) : metaLabel ? (
              <Text style={[styles.metaLabel, { color: mutedColor }]} numberOfLines={1}>
                {metaLabel}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
  )

  const item =
    Platform.OS === 'web' || !isOwner ? (
      content
    ) : (
      <Swipeable
        ref={swipeRef}
        renderRightActions={renderRightActions}
        overshootRight={false}
        friction={2}
        rightThreshold={28}
        dragOffsetFromLeftEdge={getSessionSwipeableLeftDragOffset(swipeOpen)}
        onSwipeableWillOpen={() => {
          setSwipeOpen(true)
          onSwipeableWillOpen?.(swipeRef.current)
        }}
        onSwipeableClose={() => {
          setSwipeOpen(false)
          onSwipeableClose?.(swipeRef.current)
        }}
      >
        {content}
      </Swipeable>
    )

  return (
    <>
      {item}
      <RenameSessionModal
        visible={renameVisible}
        onClose={() => setRenameVisible(false)}
        renameInput={renameInput}
        setRenameInput={setRenameInput}
        onConfirm={handleConfirmRename}
        renameSaving={renameSaving}
        colors={colors}
      />
    </>
  )
})

const styles = StyleSheet.create({
  deleteAction: {
    backgroundColor: '#ef4444',
    justifyContent: 'center',
    alignItems: 'center',
    width: 72,
  },
  sessionItem: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    position: 'relative',
  },
  separator: {
    position: 'absolute',
    left: 16,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
  },
  channelRail: {
    position: 'absolute',
    left: 0,
    top: 10,
    bottom: 10,
    width: 3,
    borderRadius: 999,
  },
  sessionContent: {
    flex: 1,
    minWidth: 0,
  },
  sessionRow1: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sessionTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  sessionTitle: {
    ...mobileTypography.listTitle,
    flex: 1,
    minWidth: 0,
    paddingRight: 4,
  },
  channelBadge: {
    width: 21,
    height: 18,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  readOnlyBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
    flexShrink: 0,
  },
  readOnlyBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  sessionRow2: {
    marginTop: 4,
  },
  row2Inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaLabel: {
    ...mobileTypography.metadata,
    flexShrink: 1,
    maxWidth: '48%',
    textAlign: 'right',
  },
  previewText: {
    ...mobileTypography.secondary,
  },
  draftLabel: {
    ...mobileTypography.secondary,
  },
  previewFlex: {
    flex: 1,
    minWidth: 0,
  },
  time: {
    ...mobileTypography.metadata,
    flexShrink: 0,
  },
})
