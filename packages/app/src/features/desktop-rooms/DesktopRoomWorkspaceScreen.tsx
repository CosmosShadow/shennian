// @arch docs/architecture/desktop/unified-desktop.md#renderer-边界
// @test ../../__tests__/desktop-room-workspace.test.ts

import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useFocusEffect, usePathname, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../config/auth'
import { useGoBack } from '../../hooks/useGoBack'
import { useTheme } from '../../hooks/useTheme'
import { subscribeRoomEvents } from '../rooms/roomEvents'
import type { WorkspaceLoadState } from '../rooms/useRoomWorkspaceData.types'
import { useDesktopRoomWorkspaceData } from '../desktop-control/useDesktopRoomWorkspaceData'
import { DesktopRoomPublicConversation } from './DesktopRoomPublicConversation'
import { DesktopRoomDetailsDialog } from './DesktopRoomDetailsDialog'
import { DesktopContextMenu, useDesktopContextMenu } from '../desktop-shell/DesktopContextMenu'
import { useDesktopRoomRename } from './useDesktopRoomRename'
import { resolveDesktopRoomPermissions } from './desktopRoomManagementModel'
import { DESKTOP_ROOM_HEADER_HEIGHT } from './desktopRoomWorkspaceLayout'
import { desktopTypography } from '../desktop-shell/desktopDesignTokens'

export type DesktopRoomWorkspaceScreenProps = {
  embedded?: boolean
  roomId: string
  initialAgentSessionId?: string
  scopedAgentSessionId?: string
  scopedAgentIdentityId?: string
}

export function DesktopRoomWorkspaceScreen({
  embedded = false,
  roomId,
  initialAgentSessionId,
  scopedAgentSessionId,
}: DesktopRoomWorkspaceScreenProps) {
  const router = useRouter()
  const goBack = useGoBack('/(main)/spaces')
  const pathname = usePathname()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const currentUserId = useAuthStore(state => state.user?.id)
  const { room, members, loadState, load, cancelLoad, hasCurrentRoom } =
    useDesktopRoomWorkspaceData({ roomId, currentUserId })
  const [roomDetailsOpen, setRoomDetailsOpen] = useState(false)
  const roomDetailsButtonRef = useRef<View>(null)
  const contextMenu = useDesktopContextMenu()
  const rename = useDesktopRoomRename(roomId, room?.name ?? '')
  const workspaceRouteActive = embedded || pathname === '/room-workspace'
  const privateSessionId = scopedAgentSessionId ?? initialAgentSessionId

  // Old links to a Room's private Agent surface now open its own work conversation.
  useEffect(() => {
    if (!privateSessionId || !workspaceRouteActive) return
    router.replace({ pathname: '/(main)/chat/[sessionId]', params: { sessionId: privateSessionId } })
  }, [privateSessionId, router, workspaceRouteActive])

  useFocusEffect(useCallback(() => {
    if (privateSessionId) return
    void load({ preserveContent: hasCurrentRoom })
    return () => cancelLoad()
  }, [cancelLoad, hasCurrentRoom, load, privateSessionId]))

  useEffect(() => {
    if (!workspaceRouteActive || privateSessionId) return
    return subscribeRoomEvents(event => {
      if (event.event === 'room.replica.updated') {
        if (event.roomId === null || event.roomId === roomId) void load({ preserveContent: hasCurrentRoom })
        return
      }
      if ('roomId' in event && event.roomId === roomId
        && (event.event === 'room.membership.updated' || event.event === 'room.binding.updated')) {
        void load({ preserveContent: hasCurrentRoom })
      }
    })
  }, [hasCurrentRoom, load, privateSessionId, roomId, workspaceRouteActive])

  const ready = loadState === 'ready' && room !== null
  const openRoomDetails = () => {
    Keyboard.dismiss()
    setRoomDetailsOpen(true)
  }
  const header = <View {...{ dataSet: { desktopDrag: 'true' } }}
    style={[styles.header, { borderBottomColor: colors.border }]}>
    <Text ref={roomDetailsButtonRef} {...contextMenu.bindings}
      {...{ tabIndex: 0, dataSet: { desktopDrag: 'false' } }}
      accessibilityRole="header" numberOfLines={1}
      style={[styles.titleText, { color: colors.text }]}>
      {room?.name ?? t('workspace_spaces')}{room && members.length > 1 ? ` (${members.length})` : ''}
    </Text>
    <Pressable accessibilityRole="button" accessibilityLabel={t('spaces_details_accessibility')}
      onPress={openRoomDetails} disabled={!ready} style={styles.detailsButton}>
      <Ionicons name="ellipsis-horizontal" size={18} color={colors.textSecondary} />
    </Pressable>
  </View>

  return <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
    {privateSessionId ? <View style={styles.loading}><ActivityIndicator color={colors.brand} /></View> : <>
      <DesktopContextMenu menu={contextMenu} actions={[
        { label: t('spaces_details_accessibility'), onSelect: openRoomDetails },
        ...(resolveDesktopRoomPermissions(currentUserId ?? '', room, members).canManage
          ? [{ label: t('rename_session'), onSelect: rename.open, disabled: !ready }] : []),
      ]} />
      {rename.dialog}
      <DesktopRoomDetailsDialog roomId={roomId} visible={roomDetailsOpen}
        onClose={() => setRoomDetailsOpen(false)} returnFocusRef={roomDetailsButtonRef} />
      {header}
      {!ready ? <DesktopRoomWorkspaceLoadState state={loadState}
        retry={() => load({ preserveContent: false })} onBack={goBack} />
        : <View testID="desktop-room-public-surface" style={styles.conversation}>
          <DesktopRoomPublicConversation key={roomId} roomId={roomId} readActive={workspaceRouteActive} />
        </View>}
    </>}
  </SafeAreaView>
}

function DesktopRoomWorkspaceLoadState({ state, retry, onBack }: {
  state: WorkspaceLoadState
  retry: () => Promise<void>
  onBack: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  if (state === 'loading') return <View style={styles.loading} accessibilityRole="progressbar"
    accessibilityLabel={t('loading')}><ActivityIndicator color={colors.brand} /></View>
  const unavailable = state === 'unavailable'
  return <View testID={unavailable ? 'room-workspace-unavailable' : 'room-workspace-load-failed'}
    style={styles.loadState}>
    <Ionicons name={unavailable ? 'lock-closed-outline' : 'cloud-offline-outline'} size={38}
      color={colors.textTertiary} />
    <Text style={[styles.loadTitle, { color: colors.text }]}>
      {t(unavailable ? 'spaces_unavailable_title' : 'spaces_load_failed')}
    </Text>
    {unavailable ? <Text style={{ color: colors.textSecondary }}>
      {t('spaces_unavailable_body')}
    </Text> : null}
    <Pressable accessibilityRole="button" onPress={unavailable ? onBack : () => void retry()}
      style={styles.loadActionButton}>
      <Text style={{ color: colors.brand }}>{t(unavailable ? 'back' : 'retry')}</Text>
    </Pressable>
  </View>
}

const styles = StyleSheet.create({
  root: { flex: 1, minWidth: 0 },
  header: { height: DESKTOP_ROOM_HEADER_HEIGHT, borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row', alignItems: 'center', paddingLeft: 16 },
  titleText: { ...desktopTypography.roomTitle, flex: 1, minWidth: 0 },
  detailsButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  conversation: { flex: 1, minHeight: 0 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 30 },
  loadTitle: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  loadActionButton: { minHeight: 44, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
})
