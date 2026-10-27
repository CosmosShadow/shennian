// @test src/__tests__/steward-settings-behavior.test.ts
// @arch docs/features/personal-agent-workspace.md
import { ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { AppPageHeader } from '../../components/AppPageHeader'
import { useTheme } from '../../hooks/useTheme'
import { PersonalWorkerSettings } from './components/PersonalWorkerSettings'

export function StewardWorkerSettingsScreen() {
  const router = useRouter(), { t } = useTranslation(), { colors } = useTheme()
  return <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
    <AppPageHeader title={t('personal_worker_title')} onBack={() => router.back()} backTestID="steward-background-agent-back" />
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <PersonalWorkerSettings />
    </ScrollView>
  </SafeAreaView>
}
const styles = StyleSheet.create({ root: { flex: 1 }, content: { paddingHorizontal: 16, paddingBottom: 40 } })
