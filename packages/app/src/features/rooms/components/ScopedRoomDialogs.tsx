// @arch docs/features/network-rooms/scoped-browser-access.md
// @test tests/e2e/web/scoped-room-dialogs.spec.ts

import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { mobileAppDownloadUrl } from './MobileAppDownloads'
import { getServerUrl } from '../../../config/server'
import { useTheme } from '../../../hooks/useTheme'
import { RoomShareContent } from './RoomShareContent'
import { RoomBrowserLogoutButton } from './RoomBrowserLogoutButton'

export function ScopedRoomDialogs({
  visible,
  roomName,
  roomUrl,
  joinPolicy,
  inviteUrl,
  inviteLoading,
  roomId,
  browserLogoutAvailable,
  onOpenSchedules,
  onRetry,
  onClose,
}: {
  visible: boolean
  roomName: string
  roomUrl: string
  joinPolicy: 'open' | 'approval' | 'closed'
  inviteUrl: string
  inviteLoading: boolean
  roomId: string
  browserLogoutAvailable: boolean
  onOpenSchedules: () => void
  onRetry: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const resources = [
    { label: t('room_access_download_ios'), url: mobileAppDownloadUrl('ios') },
    { label: t('room_access_download_android'), url: mobileAppDownloadUrl('android') },
    { label: t('room_access_official_site'), url: getServerUrl() },
  ]
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose} accessible={false}>
        <Pressable
          style={[styles.card, { backgroundColor: colors.bg }]}
          accessible={false}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={styles.header}>
            <View style={styles.icon} />
            <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
              {roomName}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('close')}
              style={styles.icon}
              onPress={onClose}
            >
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.content}>
            <RoomShareContent
              roomName={roomName}
              roomUrl={roomUrl}
              joinPolicy={joinPolicy}
              inviteUrl={inviteUrl}
              loading={inviteLoading}
              onRetry={onRetry}
              compact
            />
            <View style={styles.resourceRow}>
              {resources.map((resource) => (
                <Pressable key={resource.label} accessibilityRole="link" style={[styles.resourceAction, { backgroundColor: colors.surfaceHover }]} onPress={() => void Linking.openURL(resource.url)}>
                  <Text style={[styles.resourceLabel, { color: colors.brand }]}>{resource.label}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable accessibilityRole="button" style={styles.scheduleAction} onPress={onOpenSchedules}>
              <Ionicons name="calendar-outline" size={20} color={colors.textSecondary} />
              <Text style={[styles.scheduleLabel, { color: colors.text }]}>{t('schedules_title')}</Text>
            </Pressable>
            {browserLogoutAvailable ? <RoomBrowserLogoutButton roomId={roomId} variant="menu" /> : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.32)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  card: { width: '100%', maxWidth: 420, maxHeight: '90%', borderRadius: 16, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingTop: 8 },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 17, lineHeight: 22, fontWeight: '600' },
  content: { padding: 16, gap: 24 },
  resourceRow: { flexDirection: 'row', gap: 8 },
  resourceAction: { flex: 1, minHeight: 44, paddingHorizontal: 8, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  resourceLabel: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  scheduleAction: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },
  scheduleLabel: { fontSize: 15, lineHeight: 22, fontWeight: '500' },
})
