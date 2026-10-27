// @test src/__tests__/steward-settings-behavior.test.ts
// @arch docs/features/builtin-personal-agent.md
import { ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { AppPageHeader } from '../../components/AppPageHeader'
import { useTheme } from '../../hooks/useTheme'
import { PersonalModelSettings } from './components/PersonalModelSettings'

export function StewardModelScreen() {
  const router = useRouter(), { t } = useTranslation(), { colors } = useTheme()
  return <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
    <AppPageHeader title={t('personal_agent_system_settings')} onBack={() => router.back()} backTestID="steward-model-back" />
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <PersonalModelSettings />
    </ScrollView>
  </SafeAreaView>
}
const styles = StyleSheet.create({ root: { flex: 1 }, content: { paddingHorizontal: 16, paddingBottom: 40 } })
