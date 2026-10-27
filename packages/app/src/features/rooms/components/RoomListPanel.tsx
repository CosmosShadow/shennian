import { ActionIcon } from '../../../components/ActionIcon'
import { DesktopContextMenu, useDesktopContextMenu } from '../../desktop-shell/DesktopContextMenu'
import { useDesktopRoomRename } from '../../desktop-rooms/useDesktopRoomRename'
// @arch docs/features/network-rooms/ui.md#五web--desktop-web
// @test src/__tests__/room-navigation.test.ts

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import type { RoomMessageView } from '@shennian/wire'
import { formatSessionPreviewForDisplay } from '@shennian/shared'
import { useTheme } from '../../../hooks/useTheme'
import { mobileTypography } from '../../../theme/mobileTypography'
import { desktopTypography } from '../../desktop-shell/desktopDesignTokens'
import { formatSessionClockTime } from '../../session-list/display'
import { formatRoomListPreview, isRoomPreviewMessage, resolveRoomMessagePreview } from '../roomMessagePreview'
import {
  getRoomBodyPreview,
  setRoomBodyPreview,
  type PendingJoinRequest,
  type RoomListItem,
} from '../roomListCache'
import { RoomCreateModal } from './RoomCreateModal'
import { getPinnedSurfaceColor } from '../../session-list/pinnedPalette'
import { RoomApprovalDot } from './RoomApprovalDot'
import { UnreadCountBadge } from '../../unread/UnreadCountBadge'
import { RoomGroupAvatar } from './RoomGroupAvatar'
import { db } from '../../../storage/db'
import { getRoomDraftPreview, subscribeRoomDraft } from '../roomDraftStorage'
import { roomAccountClient } from '../roomAccountClient'

import { useRoomListModel } from '../useRoomListModel'
import type { RoomListModel } from '../useRoomListModel.types'
import type { MyPublishedConversation } from '../../published-agents/directConversationClient'
import { mergePublishedConversationList } from '../../published-agents/conversationListItems'
import { PublishedConversationListRow } from '../../published-agents/PublishedConversationListRow'
export { useRoomListModel } from '../useRoomListModel'
export type { RoomListModel } from '../useRoomListModel.types'

type Props = {
  onOpenRoom: (roomId: string, conversationKind?: RoomListItem['conversationKind']) => void
  compact?: boolean
  createRequestKey?: number
  showCreateButton?: boolean
  scrollEnabled?: boolean
  activeRoomId?: string | null
  showEmptyCreateButton?: boolean
  emptyAccessory?: ReactNode
  searchQuery?: string
  listHeader?: ReactNode
  publishedRows?: MyPublishedConversation[]
  hiddenOwnedIds?: string[]
  onOpenPublished?: (row: MyPublishedConversation) => void
  listFooter?: ReactNode
}

export type RoomListPreviewResolver = (
  accountId: string,
  roomId: string,
  latest: RoomMessageView,
) => Promise<RoomMessageView | null>

export function RoomListCreateModal({ model }: { model: RoomListModel }) {
  return (
    <RoomCreateModal
      visible={model.creating}
      onClose={() => model.setCreating(false)}
      onCreated={model.handleCreated}
    />
  )
}

export function RoomListPanel({
  onOpenRoom,
  compact = false,
  createRequestKey = 0,
  showCreateButton = true,
  scrollEnabled = true,
  activeRoomId = null,
  showEmptyCreateButton = showCreateButton,
  emptyAccessory,
  searchQuery = '',
  listHeader,
  publishedRows = [],
  hiddenOwnedIds = [],
  onOpenPublished,
  listFooter,
}: Props) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const model = useRoomListModel({ onOpenRoom, createRequestKey, activeRoomId })
  const {
    accountId,
    rooms,
    pendingRequests,
    loading,
    failed,
    setCreating,
    retry,
    togglePin,
  } = model
  const entries = mergePublishedConversationList(rooms, publishedRows, searchQuery, hiddenOwnedIds)

  const withListHeader = (content: ReactNode) => listHeader ? (
    <ScrollView style={styles.list} contentContainerStyle={styles.mobileEmptyContent} keyboardShouldPersistTaps="handled">
      {listHeader}
      {content}
      {listFooter}
    </ScrollView>
  ) : content

  if (loading) {
    return withListHeader(
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    )
  }
  if (failed) {
    return withListHeader(
      <View style={styles.center}>
        <Ionicons name="cloud-offline-outline" size={34} color={colors.textTertiary} />
        <Text style={[styles.emptyTitle, { color: colors.text }]}>{t('spaces_load_failed')}</Text>
        <Pressable
          onPress={() => void retry()}
          style={[styles.retry, { backgroundColor: colors.surfaceHover }]}
        >
          <Text style={[styles.retryText, { color: colors.brand }]}>{t('retry')}</Text>
        </Pressable>
      </View>
    )
  }
  if (entries.length === 0 && searchQuery.trim()) {
    return withListHeader(<View style={styles.center}><Text style={[styles.emptyBody, { color: colors.textSecondary }]}>{t('mobile_conversations_no_match')}</Text></View>)
  }
  if (entries.length === 0 && pendingRequests.length === 0) {
    return (
      <>
        {withListHeader(<View style={[styles.center, compact && styles.compactCenter]}>
          {!compact ? (
            <Ionicons name="chatbubbles-outline" size={46} color={colors.textTertiary} />
          ) : null}
          <Text style={[styles.emptyTitle, compact && styles.compactEmptyTitle, { color: colors.text }]}>
            {t('spaces_empty_title')}
          </Text>
          {!compact ? (
            <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
              {t('spaces_empty_body')}
            </Text>
          ) : null}
          {showEmptyCreateButton ? (
            <CreateButton onPress={() => setCreating(true)} compact={compact} />
          ) : null}
          {emptyAccessory}
        </View>)}
        <RoomListCreateModal model={model} />
      </>
    )
  }

  return <>
    <FlatList
      style={scrollEnabled ? styles.list : undefined}
      scrollEnabled={scrollEnabled}
      contentContainerStyle={compact ? undefined : styles.mobileContent}
      keyboardShouldPersistTaps="handled"
      data={entries}
      keyExtractor={entry => `${entry.kind}:${entry.row.id}`}
      initialNumToRender={12}
      maxToRenderPerBatch={8}
      windowSize={7}
      ListHeaderComponent={<>
      {listHeader}
      {showCreateButton ? <CreateButton onPress={() => setCreating(true)} compact /> : null}
      {pendingRequests.length > 0 ? (
        <View style={styles.pendingSection}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
            {t('spaces_pending_requests_title')}
          </Text>
          {pendingRequests.map((request) => (
            <RoomPendingRequestRow key={request.id} request={request} compact={compact} />
          ))}
        </View>
      ) : null}
      </>}
      ListFooterComponent={listFooter ? <>{listFooter}</> : null}
      renderItem={({ item: entry, index }) => entry.kind === 'published' ? (
        <PublishedConversationListRow key={entry.row.id} row={entry.row}
          onPress={() => onOpenPublished?.(entry.row)} />
      ) : (
        <RoomListRow
          key={entry.row.id}
          room={entry.row}
          accountId={accountId}
          compact={compact}
          active={activeRoomId === entry.row.id}
          unreadCount={(entry.row.unreadCount ?? 0) > 0 ? 1 : 0}
          compactSeparator={compact && index < entries.length - 1 && activeRoomId !== entries[index + 1]?.row.id}
          onPress={() => onOpenRoom(entry.row.id, entry.row.conversationKind)}
          onTogglePin={() => void togglePin(entry.row)}
        />)}
    />
    <RoomListCreateModal model={model} />
  </>
}

export function RoomListRow({
  room,
  accountId,
  compact,
  active,
  unreadCount,
  compactSeparator = false,
  onPress,
  onTogglePin,
  previewResolver,
}: {
  room: RoomListItem
  accountId: string | null
  compact: boolean
  active: boolean
  unreadCount: number
  compactSeparator?: boolean
  onPress: () => void
  onTogglePin: () => void
  previewResolver?: RoomListPreviewResolver
}) {
  const { t } = useTranslation()
  const { colors, isDark } = useTheme()
  const [resolvedPreview, setResolvedPreview] = useState<{
    accountId: string | null
    roomId: string
    message: RoomMessageView | null
  } | null>(null)
  const latest = room.latestMessage
  useEffect(() => {
    let cancelled = false
    if (isRoomPreviewMessage(latest) || !latest) {
      setResolvedPreview({ accountId, roomId: room.id, message: latest ?? null })
      return
    }
    void (async () => {
      if (previewResolver && accountId) {
        const message = await previewResolver(accountId, room.id, latest)
        if (!cancelled) {
          setRoomBodyPreview(accountId, room.id, latest, message)
          setResolvedPreview({ accountId, roomId: room.id, message })
        }
        return
      }
      // A complete local replica can answer offline; cold/incomplete replicas use the
      // existing paginated endpoint, including when connected to an older server.
      const sync = accountId
        ? await db.getRoomSyncState(accountId, room.id).catch(() => null)
        : null
      const useLocal = Boolean(
        sync &&
        !sync.hasOlder &&
        !sync.needsRepair &&
        BigInt(sync.windowEndSequence) >= BigInt(latest.sequence),
      )
      const message = await resolveRoomMessagePreview(latest, async (before) => {
        if (useLocal && accountId) {
          const messages = await db.getRoomMessages(accountId, room.id, { before, limit: 50 })
          return { messages, hasMore: messages.length === 50 }
        }
        return roomAccountClient.listMessages(room.id, { before, limit: 50 })
      })
      if (!cancelled) {
        setRoomBodyPreview(accountId, room.id, latest, message)
        setResolvedPreview({ accountId, roomId: room.id, message })
      }
    })().catch(() => {
      // Preserve an already resolved body during transient network/storage failures.
    })
    return () => {
      cancelled = true
    }
  }, [accountId, room.id, latest, previewResolver])
  // Read synchronously on every mount; the effect still revalidates in the background.
  const cachedPreview = getRoomBodyPreview(accountId, room.id, latest)
  const previewMessage = isRoomPreviewMessage(latest)
    ? latest
    : cachedPreview !== undefined
      ? cachedPreview ?? latest
      : latest && resolvedPreview?.accountId === accountId && resolvedPreview.roomId === room.id
        ? resolvedPreview.message ?? latest
        : latest
  const pinned = Boolean(room.pinnedAt)
  const mutedColor = pinned ? colors.textMutedOnSurface : colors.textMuted
  const subscribeDraftPreview = useCallback(
    (listener: () => void) => subscribeRoomDraft(accountId ?? '', room.id, listener),
    [accountId, room.id],
  )
  const rawDraftPreview = useSyncExternalStore(
    subscribeDraftPreview,
    () => getRoomDraftPreview(accountId ?? '', room.id, compact && active),
    () => '',
  )
  const draftPreview = formatSessionPreviewForDisplay(rawDraftPreview, {
    image: t('session_preview_image'),
    images: (count) => t('session_preview_images', { count }),
    file: t('session_preview_file'),
    files: (count) => t('session_preview_files', { count }),
  })
  const contextMenu = useDesktopContextMenu()
  const rename = useDesktopRoomRename(room.id, room.name)
  const actionRef = useRef<View>(null)
  const [pressed, setPressed] = useState(false)
  const [hovered, setHovered] = useState(false)
  const content = (
    <View
      style={[
        styles.row,
        compact && styles.compactRow,
        !compact && styles.mobileRow,
        {
          borderBottomColor: colors.border,
          backgroundColor:
            compact && active
              ? colors.selectionBackground
              : pressed || (compact && hovered)
                ? colors.surfaceHover
                : pinned
                  ? getPinnedSurfaceColor(colors, isDark)
                  : compact
                    ? 'transparent'
                    : colors.bg,
        },
      ]}
    >
      <RoomGroupAvatar members={room.avatarMembers ?? []} compact={compact} />
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Text
            style={[
              styles.name,
              compact ? styles.compactName : styles.mobileName,
              { color: colors.text },
            ]}
            numberOfLines={1}
          >
            {room.name}
          </Text>
          <RoomApprovalDot
            roomId={room.id}
            canApprove={room.status === 'active' && room.membershipRole === 'owner'}
          />
          <UnreadCountBadge count={unreadCount} testID={`room-list-item-${room.id}-unread`} />
          {formatSessionClockTime(room.latestMessage?.createdAt ?? room.updatedAt) ? (
            <Text
              style={[
                styles.time,
                !compact && styles.mobileTime,
                {
                  color: compact ? colors.textTertiary : mutedColor,
                },
              ]}
              numberOfLines={1}
            >
              {formatSessionClockTime(room.latestMessage?.createdAt ?? room.updatedAt)}
            </Text>
          ) : null}
        </View>
        <Text
          style={[
            styles.meta,
            compact ? styles.compactMeta : styles.mobileMeta,
            { color: mutedColor },
          ]}
          numberOfLines={1}
        >
          {draftPreview ? (
            <>
              <Text style={{ color: colors.error }}>[{t('draft_label')}] </Text>
              {draftPreview}
            </>
          ) : (
            formatRoomListPreview(previewMessage, t)
          )}
        </Text>
      </View>
      {compactSeparator && !active ? <View pointerEvents="none" style={[styles.compactSeparator, { backgroundColor: colors.border }]} /> : null}
      <Pressable
        ref={compact ? actionRef : undefined}
        {...(compact ? contextMenu.bindings : {})}
        testID={`room-list-item-${room.id}`}
        style={styles.rowPrimaryAction}
        onPress={onPress}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        onLongPress={() => {
          Alert.alert(room.name, undefined, [
            {
              text: pinned ? t('spaces_unpin') : t('spaces_pin'),
              onPress: onTogglePin,
            },
            { text: t('cancel'), style: 'cancel' },
          ])
        }}
        accessibilityRole="button"
        accessibilityLabel={room.name}
      />

    </View>
  )
  return (
    <>
      {content}
      {compact ? <>
        <DesktopContextMenu menu={contextMenu} actions={[
          { label: pinned ? t('spaces_unpin') : t('spaces_pin'), onSelect: onTogglePin },
          ...(room.status === 'active' && (room.membershipRole === 'owner' || room.membershipRole === 'admin') ? [{ label: t('rename_session'), onSelect: rename.open }] : []),
        ]} />
        {rename.dialog}
      </> : null}
    </>
  )
}

export function RoomPendingRequestRow({
  request,
  compact,
}: {
  request: PendingJoinRequest
  compact: boolean
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  return (
    <View
      testID={`room-pending-request-${request.id}`}
      style={[
        styles.pendingRow,
        compact && styles.compactPendingRow,
        !compact && styles.mobileRow,
        { backgroundColor: colors.surfaceHover },
      ]}
    >
      <View style={[styles.pendingIcon, { backgroundColor: colors.bg }]}>
        <Ionicons name="time-outline" size={18} color={colors.textSecondary} />
      </View>
      <View style={styles.content}>
        <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
          {request.roomName}
        </Text>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>
          {t('spaces_pending_request_status')}
        </Text>
      </View>
    </View>
  )
}

function CreateButton({ onPress, compact = false }: { onPress: () => void; compact?: boolean }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  return (
    <Pressable
      testID="room-create-action"
      onPress={onPress}
      style={[
        styles.create,
        compact && styles.createCompact,
        { backgroundColor: compact ? colors.surfaceHover : colors.brand },
      ]}
    >
      {compact ? <ActionIcon name="add" color={colors.brand} /> : null}
      <Text style={[styles.createText, { color: compact ? colors.brand : '#fff' }]}>
        {t('spaces_create_action')}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  mobileContent: { paddingBottom: 24 },
  mobileEmptyContent: { flexGrow: 1, paddingBottom: 24 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 36,
  },
  compactCenter: { alignItems: 'flex-start', paddingHorizontal: 22, paddingVertical: 12 },
  emptyTitle: {
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 18,
    ...(Platform.OS !== 'web' && mobileTypography.sectionTitle),
  },
  compactEmptyTitle: { marginTop: 0, fontSize: 16, lineHeight: 21 },
  emptyBody: {
    maxWidth: 300,
    fontSize: 15,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 22,
    ...(Platform.OS !== 'web' && mobileTypography.secondary),
  },
  retry: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 9, marginTop: 4 },
  retryText: {
    fontSize: 14,
    fontWeight: '600',
    ...(Platform.OS !== 'web' && mobileTypography.compactAction),
  },
  create: {
    minHeight: Platform.OS === 'web' ? 42 : Platform.OS === 'android' ? 48 : 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    paddingHorizontal: 20,
  },
  createCompact: { margin: 10, marginBottom: 4 },
  createText: {
    fontSize: 15,
    fontWeight: '600',
    ...(Platform.OS !== 'web' && mobileTypography.compactAction),
  },
  moreAction: {
    position: 'absolute',
    right: 8,
    top: 0,
    width: 32,
    height: 32,
    paddingTop: 2,
    alignItems: 'center',
    justifyContent: 'flex-start',
    zIndex: 1,
  },
  pendingSection: { paddingTop: 10 },
  sectionTitle: {
    paddingHorizontal: 14,
    paddingBottom: 5,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
    ...(Platform.OS !== 'web' && mobileTypography.metadata),
  },
  pendingRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 10,
    marginBottom: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    gap: 11,
  },
  compactPendingRow: { minHeight: 44, marginHorizontal: 8, paddingHorizontal: 8 },
  pendingIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 11,
    position: 'relative',
  },
  rowPrimaryAction: {
    ...StyleSheet.absoluteFillObject,
  },
  compactRow: {
    minHeight: 56,
    paddingVertical: 6,
    marginHorizontal: 8,
    paddingLeft: 9,
    paddingRight: 12,
    borderBottomWidth: 0,
    borderRadius: 6,
  },
  compactSeparator: { position: 'absolute', left: 54, right: 12, bottom: 0, height: StyleSheet.hairlineWidth },
  mobileRow: { minHeight: 68, paddingHorizontal: 16, paddingVertical: 8, gap: 13 },
  content: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 20, fontWeight: '600' },
  mobileName: { ...mobileTypography.listTitle },
  compactName: desktopTypography.sidebarRoomTitle,
  meta: { fontSize: 12, lineHeight: 18, marginTop: 2 },
  mobileMeta: { ...mobileTypography.secondary, marginTop: 4 },
  compactMeta: { ...desktopTypography.sidebarPreview, marginTop: 2 },
  time: { fontSize: 10, lineHeight: 14, flexShrink: 0 },
  mobileTime: { ...mobileTypography.metadata },
})
