import { useMobileModuleBack } from '../../../src/components/useMobileModuleBack'
// @arch docs/features/network-rooms/ui.md#六移动端
// @test ../../../src/__tests__/room-navigation.test.ts

import { useRef, useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { RoomListPanel } from '../../../src/features/rooms/components/RoomListPanel'
import { useTheme } from '../../../src/hooks/useTheme'
import { RoomRootActionModal } from '../../../src/features/rooms/components/RoomRootActionModal'
import { AppPageHeader, HeaderIconButton } from '../../../src/components/ConnectedAppPageHeader'
import { joinCurrentOfficialRoom } from '../../../src/features/contact/joinCurrentOfficialRoom'
import { roomInvitationClient } from '../../../src/features/rooms/roomInvitationClient'
import Ionicons from '@expo/vector-icons/Ionicons'
import { usePublishedConversationList } from '../../../src/features/published-agents/usePublishedConversationList'

export default function SpacesScreen({ directoryHeader, embedded = false }: {
  directoryHeader?: ReactNode | ((query: string) => ReactNode); embedded?: boolean
} = {}) {
  const moduleBack = useMobileModuleBack()
  const router = useRouter()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const published = usePublishedConversationList(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [joiningOfficialRoom, setJoiningOfficialRoom] = useState(false)
  const [officialRoomStatus, setOfficialRoomStatus] = useState('')
  const [query, setQuery] = useState('')
  const joinBusy = useRef(false)

  const openOfficialRoom = async () => {
    if (joinBusy.current) return
    joinBusy.current = true
    setJoiningOfficialRoom(true)
    setOfficialRoomStatus('')
    try {
      const result = await joinCurrentOfficialRoom(roomInvitationClient)
      if (result.outcome === 'pending_approval') {
        setOfficialRoomStatus(t('room_invite_pending_body'))
      } else if (result.outcome === 'joined') {
        router.navigate({ pathname: '/(main)/room-workspace', params: { roomId: result.roomId } })
      } else {
        router.navigate({
          pathname: '/spaces/[roomId]',
          params: { roomId: result.roomId, invite: result.inviteToken },
        } as never)
      }
    } catch {
      setOfficialRoomStatus(t('contact_join_failed'))
    } finally {
      joinBusy.current = false
      setJoiningOfficialRoom(false)
    }
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={embedded ? [] : ['top']}>
      {!embedded && <AppPageHeader
        title={t('mobile_conversations')}
        onBack={moduleBack}
        showsConnectivityStatus
        trailing={(
          <HeaderIconButton
            icon="add"
            label={t('spaces_add_room')}
            onPress={() => setActionsOpen(true)}
            testID="room-create-header-action"
          />
        )}
      />}
      <View style={styles.body}>
        <RoomListPanel
          publishedRows={published.rows}
          hiddenOwnedIds={published.hiddenOwnedIds}
          onOpenPublished={(row) => router.navigate({
            pathname: '/(main)/published-conversations/[conversationId]',
            params: { conversationId: row.id, ...(row.role === 'owner' ? { perspective: 'owner' } : {}) },
          })}
          listFooter={published.failed || published.hasMore ? <Pressable accessibilityRole="button"
            disabled={published.loading} style={styles.publishedMore}
            onPress={() => void (published.failed ? published.retry() : published.loadMore())}>
            <Text style={{ color: colors.brand }}>
              {published.failed ? t('retry') : t('mobile_load_more_direct_conversations')}
            </Text>
          </Pressable> : null}
          listHeader={<>
            <View style={[styles.search, { backgroundColor: colors.surfaceHover }]}>
              <Ionicons name="search-outline" size={22} color={colors.textSecondary} />
              <TextInput value={query} onChangeText={setQuery} placeholder={t('mobile_search_conversations')}
                placeholderTextColor={colors.textTertiary} style={[styles.searchInput, { color: colors.text }]}
                clearButtonMode="while-editing" autoCorrect={false} />
            </View>
            {typeof directoryHeader === 'function' ? directoryHeader(query) : directoryHeader}
          </>}
          searchQuery={query}
          showCreateButton={false}
          showEmptyCreateButton={!embedded}
          emptyAccessory={(
            <View style={styles.officialRoomAction}>
              <Pressable
                accessibilityRole="button"
                disabled={joiningOfficialRoom}
                onPress={() => void openOfficialRoom()}
                testID="rooms-empty-join-official"
                style={styles.officialRoomButton}
              >
                <Text style={[styles.officialRoomText, { color: colors.brand }]}>
                  {t(joiningOfficialRoom ? 'contact_joining' : 'contact_join_room')}
                </Text>
              </Pressable>
              {officialRoomStatus ? (
                <Text style={[styles.officialRoomStatus, { color: colors.textSecondary }]}>
                  {officialRoomStatus}
                </Text>
              ) : null}
            </View>
          )}
          onOpenRoom={(roomId, conversationKind) => {
            if (conversationKind === 'published_ai') {
              router.navigate({
                pathname: '/(main)/published-conversations/[conversationId]',
                params: { conversationId: roomId },
              })
              return
            }
            router.navigate({ pathname: '/(main)/room-workspace', params: { roomId } })
          }}
        />
      </View>
      <RoomRootActionModal
        visible={actionsOpen}
        onClose={() => setActionsOpen(false)}
        onCreate={() => router.navigate('/(main)/contacts/new-conversation')}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  publishedMore: { minHeight: 48, alignItems: 'center', justifyContent: 'center', padding: 12 },
  body: { flex: 1 },
  search: { height: 42, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, marginHorizontal: 16, marginTop: 12, marginBottom: 8 },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 0 },
  officialRoomAction: { alignItems: 'center', gap: 4, marginTop: 8 },
  officialRoomButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  officialRoomText: { fontSize: 15, lineHeight: 20, fontWeight: '400', textAlign: 'center' },
  officialRoomStatus: { fontSize: 13, lineHeight: 18, textAlign: 'center', maxWidth: 280 },
})
