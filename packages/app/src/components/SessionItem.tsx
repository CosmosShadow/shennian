import { ActionIconButton } from './ActionIconButton'
import { DesktopContextMenu, useDesktopContextMenu } from '../features/desktop-shell/DesktopContextMenu'
import { useSessionActivityNow } from '../hooks/useSessionActivityNow'
import { View, Text, Pressable, Modal, StyleSheet, Alert, Platform, TextInput } from 'react-native'
import { useRouter, usePathname } from 'expo-router'
import { useTranslation } from 'react-i18next'
import Ionicons from '@expo/vector-icons/Ionicons'
import { memo, useState, useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import {
  useChatStore,
  useMachinesStore,
  useSessionsStore,
  hasSessionExternalChannel,
  isSessionPinned,
} from '@shennian/shared'
import type { NianSession } from '@shennian/wire'
import { useTheme } from '../hooks/useTheme'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { useWebModalFocus } from '../hooks/useWebModalFocus'
import { roomAccountClient } from '../features/rooms/roomAccountClient'
import { sessionAccountClient } from '../features/sessions/sessionAccountClient'
import { useAuthStore } from '../config/auth'
import { accountRuntime } from '../features/account-runtime/accountRuntime'
import { UnreadCountBadge } from '../features/unread/UnreadCountBadge'
import { useSessionUnreadCount } from '../features/unread/useSessionUnreadCounts'
import { getChatDraftPreview, subscribeChatDraft } from '../features/chat/utils/draftStorage'
import {
  getLatestSendingChatOutboundPreview,
  subscribeChatOutboundMessages,
} from '../features/chat/utils/outboundStorage'
import { buildSessionDisplay } from '../features/session-list/display'
import { getSessionItemSurfaceColor } from '../features/session-list/sessionItemSurface'
import type { LinkedRoomBindingView } from '../features/rooms/types'
import { isDesktopControlSurfaceEnabled } from '../utils/controlSurfaceLayout'
import { desktopTypography } from '../features/desktop-shell/desktopDesignTokens'

const MENU_WIDTH = 160
const MANAGER_CHANNEL_BLUE = '#2563EB'
const subscribeToNothing = () => () => undefined
const getEmptyPreview = () => ''

type Props = {
  session: NianSession
  onDelete?: (id: string) => void
  grouped?: boolean
  compact?: boolean
  titleOnly?: boolean
  hideMachineName?: boolean
  hideProjectName?: boolean
}

export const SessionItem = memo(function SessionItem({
  session,
  onDelete,
  grouped = false,
  compact = false,
  titleOnly = false,
  hideMachineName = false,
  hideProjectName = true,
}: Props) {
  const { t } = useTranslation()
  const router = useRouter()
  const pathname = usePathname()
  const { colors, isDark } = useTheme()
  const contextMenu = useDesktopContextMenu()
  const [hovered, setHovered] = useState(false)
  const [menuBtnHovered, setMenuBtnHovered] = useState(false)
  const [menuBtnFocused, setMenuBtnFocused] = useState(false)
  const [confirmVisible, setConfirmVisible] = useState(false)
  const [renameVisible, setRenameVisible] = useState(false)
  const [renameInput, setRenameInput] = useState('')
  const [renameSaving, setRenameSaving] = useState(false)
  const [menuVisible, setMenuVisible] = useState(false)
  const [linkedRoom, setLinkedRoom] = useState<LinkedRoomBindingView | null>(null)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })
  const moreBtnWrapRef = useRef<View>(null)
  const moreButtonRef = useRef<View>(null)
  const menuCardRef = useRef<View>(null)
  const firstMenuItemRef = useRef<View>(null)
  const confirmCardRef = useRef<View>(null)
  const confirmCancelRef = useRef<View>(null)
  const renameCardRef = useRef<View>(null)
  const renameInputRef = useRef<TextInput>(null)
  const dismissMenu = useCallback(() => setMenuVisible(false), [])
  useEscapeKey(menuVisible, dismissMenu)
  useEscapeKey(confirmVisible, () => setConfirmVisible(false))
  useEscapeKey(renameVisible, () => setRenameVisible(false))
  useWebModalFocus({
    visible: menuVisible,
    containerRef: menuCardRef,
    initialFocusRef: firstMenuItemRef,
    returnFocusRef: moreButtonRef,
  })
  useWebModalFocus({
    visible: confirmVisible,
    containerRef: confirmCardRef,
    initialFocusRef: confirmCancelRef,
    returnFocusRef: moreButtonRef,
  })
  useWebModalFocus({
    visible: renameVisible,
    containerRef: renameCardRef,
    initialFocusRef: renameInputRef,
    returnFocusRef: moreButtonRef,
  })

  const upsertSession = useSessionsStore((s) => s.upsertSession)
  const currentUserId = useAuthStore((s) => s.user?.id ?? null)
  const subscribeDraftPreview = useCallback(
    (listener: () => void) => subscribeChatDraft(currentUserId ?? '', session.id, listener),
    [currentUserId, session.id],
  )
  const isOwner = !!currentUserId && session.userId === currentUserId
  const showMaintainer = !isOwner && !!session.sharedMachineSession
  const maintainerName =
    session.ownerName ||
    session.ownerPhone ||
    session.ownerEmail ||
    t('organization_member_unnamed')

  // The Desktop project tree renders a title-only row. Keep that dense path
  // out of preview/draft streams so message activity in one conversation does
  // not wake every mounted row in a long sidebar.
  const preview = useSessionsStore((s) =>
    titleOnly ? undefined : s.previews[session.id],
  )
  const previewAt = useSessionsStore((s) =>
    titleOnly ? undefined : s.previewTimestamps[session.id],
  )
  const draftPreview = useSyncExternalStore(
    titleOnly ? subscribeToNothing : subscribeDraftPreview,
    titleOnly ? getEmptyPreview : () => getChatDraftPreview(currentUserId ?? '', session.id),
    titleOnly ? getEmptyPreview : () => getChatDraftPreview(currentUserId ?? '', session.id),
  )
  const sendingPreview = useSyncExternalStore(
    titleOnly ? subscribeToNothing : subscribeChatOutboundMessages,
    titleOnly
      ? getEmptyPreview
      : () => getLatestSendingChatOutboundPreview(currentUserId ?? '', session.id),
    titleOnly
      ? getEmptyPreview
      : () => getLatestSendingChatOutboundPreview(currentUserId ?? '', session.id),
  )
  const effectiveDraftPreview = draftPreview.trim() === sendingPreview ? '' : draftPreview
  const fallbackMachineName = useMachinesStore((store) =>
    titleOnly
      ? ''
      : (store.machines.find((machine) => machine.id === session.machineId)?.name ?? ''),
  )
  const machineOnline = useMachinesStore(
    (store) => store.machines.find((machine) => machine.id === session.machineId)?.online,
  )
  const machineOffline = machineOnline === false
  const isSessionTyping = useChatStore((s) => s.sessionId === session.id && s.isTyping)
  const isPinned = isSessionPinned(session)
  const unreadCount = useSessionUnreadCount(session.id)
  const hasUnread = unreadCount > 0
  const hasExternalChannel = hasSessionExternalChannel(session)
  const externalChannelType = session.externalChannel?.type
  const externalChannelLabel =
    externalChannelType === 'wechat-rpa'
      ? t('manager_external_provider_wechat_rpa_short')
      : externalChannelType === 'feishu'
        ? t('manager_external_provider_feishu')
        : t('manager_external_provider_wecom')
  const isActive = pathname === `/chat/${session.id}` || pathname === `/(main)/chat/${session.id}`
  const activityNow = useSessionActivityNow([session])
  const { summary, metaLabel, timeStr } = buildSessionDisplay({
    session,
    preview,
    previewAt,
    draft: isActive ? undefined : effectiveDraftPreview,
    sendingPreview: isActive ? undefined : sendingPreview,
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

  const desktopControlSurface = isDesktopControlSurfaceEnabled()
  const hasMoreActions = !!onDelete || !!session.agentIdentityId
  const actionInteracted = hovered || menuBtnHovered || menuBtnFocused || menuVisible
  const showMoreBtn =
    hasMoreActions && (titleOnly ? actionInteracted : desktopControlSurface || actionInteracted)

  const openMenu = useCallback(
    (e: { stopPropagation: () => void }) => {
      e.stopPropagation()
      moreBtnWrapRef.current?.measure((_fx, _fy, width, height, px, py) => {
        setMenuPos({ x: px + width - MENU_WIDTH, y: py + height + 4 })
        setMenuVisible(true)
      })
      void roomAccountClient
        .getSessionBinding(session.id)
        .then((binding) => setLinkedRoom(binding))
        .catch(() => setLinkedRoom(null))
    },
    [session.id],
  )

  useEffect(() => {
    if (!contextMenu.anchor) return
    let cancelled = false
    void roomAccountClient.getSessionBinding(session.id).then(binding => {
      if (!cancelled) setLinkedRoom(binding)
    }).catch(() => { if (!cancelled) setLinkedRoom(null) })
    return () => { cancelled = true }
  }, [contextMenu.anchor, session.id])

  const handleDeletePress = () => {
    if (Platform.OS === 'web') {
      setConfirmVisible(true)
    } else {
      Alert.alert(t('delete_session'), t('confirm_delete_session'), [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('confirm_delete_session_action'),
          style: 'destructive',
          onPress: () => onDelete?.(session.id),
        },
      ])
    }
  }

  const handleConfirmDelete = () => {
    setConfirmVisible(false)
    onDelete?.(session.id)
  }

  const handleConfirmRename = async () => {
    const trimmed = renameInput.trim()
    if (!trimmed) {
      setRenameVisible(false)
      return
    }
    setRenameSaving(true)
    try {
      await sessionAccountClient.updateSession(session.id, { title: trimmed })
      upsertSession({ ...session, title: trimmed })
      setRenameVisible(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      Alert.alert(t('rename_failed'), message)
    } finally {
      setRenameSaving(false)
    }
  }

  const handleTogglePin = async () => {
    setMenuVisible(false)
    await accountRuntime.updateSessionUserState(session.id, { pinned: !isPinned }).catch(() => {})
  }

  const handleToggleUnread = async () => {
    setMenuVisible(false)
    if (hasUnread) {
      await accountRuntime.markSessionRead(session.id, new Date().toISOString()).catch(() => {})
      return
    }
    await accountRuntime.updateSessionUserState(session.id, { manualUnread: true }).catch(() => {})
  }

  return (
    <View
      style={[
        styles.container,
        grouped && styles.containerGrouped,
        compact && styles.containerCompact,
        titleOnly && styles.containerTitleOnly,
        {
          backgroundColor:
            desktopControlSurface
              ? (isActive ? colors.selectionBackground : 'transparent')
              : getSessionItemSurfaceColor({
                  colors,
                  isDark,
                  isPinned,
                  isActive,
                  hasExternalChannel,
                }),
        },
        hovered && !isActive && { backgroundColor: colors.surfaceHover },
        machineOffline && !isActive && { opacity: 0.74 },
      ]}
    >
      {hasExternalChannel ? (
        <View style={[styles.channelRail, { backgroundColor: MANAGER_CHANNEL_BLUE }]} />
      ) : null}
      <View style={styles.row1}>
        <View style={styles.titleWrap}>
          <Text
            style={[
              styles.title,
              compact && styles.titleCompact,
              {
                color: hasExternalChannel
                  ? MANAGER_CHANNEL_BLUE
                  : isRunning || (hasUnread && !isActive)
                    ? colors.brand
                    : colors.text,
              },
            ]}
            numberOfLines={1}
          >
            {session.title || t('new_conversation')}
          </Text>
          {hasExternalChannel ? (
            <View
              style={[
                styles.channelBadge,
                {
                  backgroundColor: `${MANAGER_CHANNEL_BLUE}15`,
                  borderColor: `${MANAGER_CHANNEL_BLUE}35`,
                },
              ]}
            >
              <Ionicons name="chatbubbles-outline" size={11} color={MANAGER_CHANNEL_BLUE} />
              <Text
                style={[styles.channelBadgeText, { color: MANAGER_CHANNEL_BLUE }]}
                numberOfLines={1}
              >
                {externalChannelLabel}
              </Text>
            </View>
          ) : null}
          {showMaintainer ? (
            <View
              style={[
                styles.readOnlyBadge,
                { backgroundColor: `${colors.brand}12`, borderColor: `${colors.brand}28` },
              ]}
            >
              <Text style={[styles.readOnlyBadgeText, { color: colors.brand }]}>
                {t('session_readonly_badge')}
              </Text>
            </View>
          ) : null}
          <UnreadCountBadge count={unreadCount} />
        </View>

        {!titleOnly && timeStr ? (
          <Text
            style={[
              styles.time,
              compact && styles.timeCompact,
              {
                color: Platform.OS === 'web' ? colors.textTertiary : colors.textMuted,
                opacity: !desktopControlSurface && actionInteracted ? 0 : 1,
              },
            ]}
            numberOfLines={1}
          >
            {timeStr}
          </Text>
        ) : null}
      </View>

      {!titleOnly ? (
        <View style={[styles.row2, compact && styles.row2Compact]}>
          <View style={styles.row2Inner}>
            <Text
              style={[
                styles.preview,
                compact && styles.previewCompact,
                styles.previewFlex,
                {
                  color: summary.isDraft
                    ? colors.textSecondary
                    : isRunning
                      ? colors.brand
                      : colors.textSecondary,
                },
              ]}
              numberOfLines={1}
            >
              {summary.isDraft ? (
                <Text
                  style={[
                    styles.draftLabel,
                    compact && styles.previewCompact,
                    { color: colors.error },
                  ]}
                >
                  [{t('draft_label')}]{' '}
                </Text>
              ) : null}
              {summary.isSending ? (
                <Text
                  style={[
                    styles.draftLabel,
                    compact && styles.previewCompact,
                    { color: colors.brand },
                  ]}
                >
                  [{t('msg_sending')}]{' '}
                </Text>
              ) : null}
              {summary.text || '\u00A0'}
            </Text>
            {showMaintainer ? (
              <Text
                style={[
                  styles.metaLabel,
                  { color: Platform.OS === 'web' ? colors.textTertiary : colors.textMuted },
                ]}
                numberOfLines={1}
              >
                {t('session_maintained_by', { name: maintainerName })}
              </Text>
            ) : machineOffline ? (
              <Text
                style={[
                  styles.metaLabel,
                  { color: Platform.OS === 'web' ? colors.textTertiary : colors.textMuted },
                ]}
                numberOfLines={1}
              >
                {metaLabel ? `${metaLabel} · ${t('machine_offline')}` : t('machine_offline')}
              </Text>
            ) : metaLabel ? (
              <Text
                style={[
                  styles.metaLabel,
                  { color: Platform.OS === 'web' ? colors.textTertiary : colors.textMuted },
                ]}
                numberOfLines={1}
              >
                {metaLabel}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}

      <Pressable
        ref={desktopControlSurface ? moreButtonRef : undefined}
        {...(desktopControlSurface ? contextMenu.bindings : {})}
        testID={`session-item-${session.id}`}
        style={styles.primaryAction}
        onPress={() => router.navigate(`/(main)/chat/${session.id}`)}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        accessibilityRole="button"
        accessibilityLabel={session.title || t('new_conversation')}
      />

      {/* Single "..." button that replaces pencil+trash */}
      {hasMoreActions && !desktopControlSurface ? (
        <View style={[styles.moreOverlay, { opacity: showMoreBtn ? 1 : 0 }]}>
          <View ref={moreBtnWrapRef} collapsable={false}>
            <ActionIconButton icon="more" color={colors.textSecondary}
              ref={moreButtonRef}
              style={[
                styles.moreBtn,
                { backgroundColor: showMoreBtn ? colors.surfaceHover : 'transparent' },
              ]}
              onPress={openMenu}
              onHoverIn={() => setMenuBtnHovered(true)}
              onHoverOut={() => setMenuBtnHovered(false)}
              onFocus={() => setMenuBtnFocused(true)}
              onBlur={() => setMenuBtnFocused(false)}
              label={t('more')}
             />
          </View>
        </View>
      ) : null}

      {desktopControlSurface ? <DesktopContextMenu menu={contextMenu} actions={[
        { label: isPinned ? t('unpin_session') : t('pin_session'), onSelect: () => { void handleTogglePin() } },
        { label: hasUnread ? t('mark_read') : t('mark_unread'), onSelect: () => { void handleToggleUnread() } },
        ...(isOwner ? [
          { label: t('rename_session'), onSelect: () => { setRenameInput(session.title ?? ''); setRenameVisible(true) } },
          { label: t('delete_session'), destructive: true, onSelect: handleDeletePress },
        ] : []),
        ...(session.agentIdentityId ? [{ label: t('agents_view_owner'), onSelect: () => router.navigate(`/(main)/agents/${session.agentIdentityId}`) }] : []),
        ...(linkedRoom ? [{ label: t('agents_view_room'), onSelect: () => router.navigate({ pathname: '/(main)/room-workspace', params: { roomId: linkedRoom.room.id } }) }] : []),
      ]} /> : null}

      {/* Dropdown menu */}
      <Modal visible={menuVisible} transparent animationType="none" onRequestClose={dismissMenu}>
        <View style={styles.menuOverlay}>
          <Pressable
            style={styles.modalHitArea}
            onPress={dismissMenu}
            accessibilityRole="button"
            accessibilityLabel={t('cancel')}
          />
          <View
            ref={menuCardRef}
            accessibilityRole="menu"
            accessibilityViewIsModal
            style={[
              styles.menuCard,
              {
                position: 'absolute',
                top: menuPos.y,
                left: menuPos.x,
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <Pressable
              ref={firstMenuItemRef}
              accessibilityRole="menuitem"
              style={styles.menuItem}
              onPress={() => {
                void handleTogglePin()
              }}
            >
              <Ionicons name="pin-outline" size={14} color={colors.textSecondary} />
              <Text style={[styles.menuItemText, { color: colors.text }]}>
                {isPinned ? t('unpin_session') : t('pin_session')}
              </Text>
            </Pressable>
            {session.agentIdentityId ? (
              <>
                <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />
                <Pressable
                  accessibilityRole="menuitem"
                  style={styles.menuItem}
                  onPress={() => {
                    setMenuVisible(false)
                    router.navigate(`/(main)/agents/${session.agentIdentityId}`)
                  }}
                >
                  <Ionicons name="person-outline" size={14} color={colors.textSecondary} />
                  <Text style={[styles.menuItemText, { color: colors.text }]}>
                    {t('agents_view_owner')}
                  </Text>
                </Pressable>
              </>
            ) : null}
            {linkedRoom ? (
              <>
                <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />
                <Pressable
                  accessibilityRole="menuitem"
                  style={styles.menuItem}
                  onPress={() => {
                    setMenuVisible(false)
                    if (Platform.OS === 'web') {
                      router.navigate(`/spaces/${linkedRoom.room.id}`)
                    } else {
                      router.navigate({
                        pathname: '/(main)/room-workspace',
                        params: { roomId: linkedRoom.room.id },
                      })
                    }
                  }}
                >
                  <Ionicons name="people-outline" size={14} color={colors.textSecondary} />
                  <Text style={[styles.menuItemText, { color: colors.text }]}>
                    {t('agents_view_room')}
                  </Text>
                </Pressable>
              </>
            ) : null}
            <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />
            <Pressable
              accessibilityRole="menuitem"
              style={styles.menuItem}
              onPress={() => {
                void handleToggleUnread()
              }}
            >
              <Ionicons
                name={hasUnread ? 'mail-open-outline' : 'mail-unread-outline'}
                size={14}
                color={colors.textSecondary}
              />
              <Text style={[styles.menuItemText, { color: colors.text }]}>
                {hasUnread ? t('mark_read') : t('mark_unread')}
              </Text>
            </Pressable>
            {isOwner ? (
              <>
                <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />
                <Pressable
                  accessibilityRole="menuitem"
                  style={styles.menuItem}
                  onPress={() => {
                    setMenuVisible(false)
                    setRenameInput(session.title ?? '')
                    setRenameVisible(true)
                  }}
                >
                  <Ionicons name="pencil-outline" size={14} color={colors.textSecondary} />
                  <Text style={[styles.menuItemText, { color: colors.text }]}>
                    {t('rename_session')}
                  </Text>
                </Pressable>
                <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />
                <Pressable
                  accessibilityRole="menuitem"
                  style={styles.menuItem}
                  onPress={() => {
                    setMenuVisible(false)
                    handleDeletePress()
                  }}
                >
                  <Ionicons name="trash-outline" size={14} color="#ef4444" />
                  <Text style={[styles.menuItemText, { color: '#ef4444' }]}>
                    {t('delete_session')}
                  </Text>
                </Pressable>
              </>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Delete confirmation modal (web) */}
      <Modal
        visible={confirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={styles.modalHitArea}
            onPress={() => setConfirmVisible(false)}
            accessibilityRole="button"
            accessibilityLabel={t('cancel')}
          />
          <View
            ref={confirmCardRef}
            accessibilityViewIsModal
            style={[styles.modalCard, { backgroundColor: colors.surface }]}
          >
            <Text style={[styles.modalTitle, { color: colors.text }]}>{t('delete_session')}</Text>
            <Text style={[styles.modalMessage, { color: colors.textSecondary }]}>
              {t('confirm_delete_session')}
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                ref={confirmCancelRef}
                style={[styles.modalBtn, { backgroundColor: colors.surfaceHover }]}
                onPress={() => setConfirmVisible(false)}
              >
                <Text style={[styles.modalBtnText, { color: colors.text }]}>{t('cancel')}</Text>
              </Pressable>
              <Pressable
                style={[styles.modalBtn, { backgroundColor: '#ef4444' }]}
                onPress={handleConfirmDelete}
              >
                <Text style={[styles.modalBtnText, { color: '#fff' }]}>
                  {t('confirm_delete_session_action')}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Rename modal */}
      <Modal
        visible={renameVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setRenameVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={styles.modalHitArea}
            onPress={() => setRenameVisible(false)}
            accessibilityRole="button"
            accessibilityLabel={t('cancel')}
          />
          <View
            ref={renameCardRef}
            accessibilityViewIsModal
            style={[styles.modalCard, { backgroundColor: colors.surface }]}
          >
            <Text style={[styles.modalTitle, { color: colors.text }]}>{t('rename_session')}</Text>
            <TextInput
              ref={renameInputRef}
              style={[
                styles.renameInput,
                {
                  color: colors.text,
                  borderColor: colors.brand + '70',
                  backgroundColor: colors.bg,
                },
              ]}
              value={renameInput}
              onChangeText={setRenameInput}
              placeholder={t('rename_session_placeholder')}
              placeholderTextColor={colors.textTertiary}
              autoFocus
              selectTextOnFocus
              onSubmitEditing={handleConfirmRename}
            />
            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalBtn, { backgroundColor: colors.surfaceHover }]}
                onPress={() => setRenameVisible(false)}
              >
                <Text style={[styles.modalBtnText, { color: colors.text }]}>{t('cancel')}</Text>
              </Pressable>
              <Pressable
                style={[styles.modalBtn, { backgroundColor: colors.brand }]}
                onPress={handleConfirmRename}
                disabled={renameSaving}
              >
                <Text style={[styles.modalBtnText, { color: '#fff' }]}>
                  {renameSaving ? t('rename_saving') : t('confirm')}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
})

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    marginHorizontal: 8,
    marginVertical: 2,
    position: 'relative',
  },
  primaryAction: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 8,
  },
  channelRail: {
    position: 'absolute',
    left: 0,
    top: 8,
    bottom: 8,
    width: 3,
    borderRadius: 999,
  },
  containerGrouped: {
    marginHorizontal: 0,
    marginVertical: 0,
    borderRadius: 0,
    paddingLeft: 35,
    paddingRight: 16,
    paddingVertical: 14,
  },
  containerCompact: {
    minHeight: 54,
    marginHorizontal: 8,
    marginVertical: 1,
    borderRadius: 9,
    paddingLeft: 28,
    paddingRight: 32,
    paddingVertical: 7,
  },
  containerTitleOnly: {
    paddingLeft: 26,
    paddingRight: 12,
    minHeight: 32,
    marginVertical: 0,
    paddingVertical: 4,
  },
  row1: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  titleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
    minWidth: 0,
    paddingRight: 4,
  },
  titleCompact: { ...desktopTypography.sidebarItem, fontWeight: '400' },
  channelBadge: {
    minWidth: 21,
    height: 18,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 3,
    paddingHorizontal: 5,
    flexShrink: 0,
  },
  channelBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
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
  time: {
    fontSize: 12,
    flexShrink: 0,
  },
  timeCompact: { fontSize: 10, lineHeight: 14 },
  row2: {
    marginTop: 3,
  },
  row2Compact: { marginTop: 0 },
  row2Inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaLabel: {
    fontSize: 11,
    flexShrink: 1,
    maxWidth: '45%',
    textAlign: 'right',
  },
  preview: {
    fontSize: 13,
    lineHeight: 18,
  },
  previewCompact: { fontSize: 11, lineHeight: 15 },
  draftLabel: {
    fontSize: 13,
    lineHeight: 18,
  },
  previewFlex: {
    flex: 1,
    minWidth: 0,
  },
  moreOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  moreBtn: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
  },
  menuOverlay: {
    flex: 1,
  },
  modalHitArea: { ...StyleSheet.absoluteFillObject },
  menuCard: {
    width: MENU_WIDTH,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  menuItemText: {
    fontSize: 14,
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCard: {
    width: 300,
    borderRadius: 14,
    padding: 24,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  modalMessage: {
    fontSize: 14,
    lineHeight: 20,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
    justifyContent: 'flex-end',
  },
  modalBtn: {
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  modalBtnText: {
    fontSize: 14,
    fontWeight: '500',
  },
  renameInput: {
    borderWidth: 1.5,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
})
