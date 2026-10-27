// @arch docs/architecture/mobile-navigation.md
// @test src/__tests__/shennian-home.test.ts
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { AppPageHeader, HeaderIconButton } from '../../components/ConnectedAppPageHeader'
import { mobileDestinationHref, mobileFeatures } from '../../components/mobileFeatureRegistry'
import { useTheme } from '../../hooks/useTheme'
import { useAuthStore } from '../../config/auth'
import { StewardEntryRow } from '../steward/StewardEntryRow'
import SpacesScreen from '../../../app/(main)/spaces'
import { useRecordingState } from '../personal-modules/recordingState'
import { stopRecording } from '../personal-modules/runtime'
import { useHomeEntries, HOME_ENTRY_KEYS } from './homeEntryPreference'
import { useHomePreviews } from './useHomePreviews'
import { HomeEntryRow } from './HomeEntryRow'
import { DirectoryRow } from './DirectoryRow'
import { useUnreadNavigation } from '../unread/useUnreadNavigation'
import { UnreadCountBadge } from '../unread/UnreadCountBadge'

export default function ShennianHomeScreen() {
  const router = useRouter()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const accountId = useAuthStore(state => state.user?.id)
  const { entries, hydrated } = useHomeEntries(accountId)
  const previews = useHomePreviews(entries)
  const unread = useUnreadNavigation()
  const visitorTitle = t('mobile_visitor_messages')
  const visitorSubtitle = t('mobile_visitor_messages_subtitle')
  const recording = useRecordingState(state => state.active)
  const stopping = useRecordingState(state => state.stopping)
  const openRecording = () => router.push(mobileDestinationHref('recording', 'push'))
  const directory = (query: string) => <>
    <StewardEntryRow query={query} />
    {/* Owner conversations deliberately stay out of the personal chat inventory.
        Keep a bounded, reachable entry for the same unread source as the root tab. */}
    {unread.tabs.agents > 0 && (!query.trim() || `${visitorTitle} ${visitorSubtitle}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) ?
      <DirectoryRow testID="home-visitor-messages" title={visitorTitle} subtitle={visitorSubtitle}
        icon="chatbubbles-outline" conversationStyle color={colors.brand}
        accessory={<UnreadCountBadge count={unread.tabs.agents} testID="home-visitor-messages-unread" />}
        onPress={() => router.push('/(main)/agents')} /> : null}
    {hydrated && HOME_ENTRY_KEYS.filter(key => entries[key] && (!query.trim() || t(mobileFeatures.find(item => item.key === key)!.label).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))).map(key => {
      return <HomeEntryRow key={key} entryKey={key} testID={`home-entry-${key}`} preview={previews[key]}
        onPress={() => router.push(mobileDestinationHref(key, 'push'))} />
    })}

  </>
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
    <AppPageHeader title={t('mobile_tab_shennian')} showsConnectivityStatus trailing={<HeaderIconButton
      icon="add-circle-outline" label={t('mobile_new_conversation')} testID="home-new-conversation" onPress={() => router.push('/(main)/contacts/new-conversation')} />} />
    <SpacesScreen embedded directoryHeader={directory} />
    {recording ? <View testID="home-recording-status" style={[styles.recording, { borderTopColor: colors.separator }]}>
      <Pressable accessibilityRole="button" onPress={openRecording} style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}>
        <Text style={{ color: colors.errorText }}>{t('mobile_recording_active')}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={stopping} testID="home-recording-stop"
        onPress={() => { void stopRecording().catch(() => Alert.alert(t('error_unknown'))) }} style={styles.stop}>
        <Text style={{ color: colors.errorText }}>{t('personal_stop')}</Text>
      </Pressable>
    </View> : null}

  </SafeAreaView>
}
const styles = StyleSheet.create({
  recording: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, borderTopWidth: StyleSheet.hairlineWidth },
  stop: { minHeight: 44, minWidth: 60, alignItems: 'center', justifyContent: 'center' },
})
