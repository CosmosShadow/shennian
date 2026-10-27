// @arch docs/features/builtin-personal-agent.md
// @test src/__tests__/steward-navigation.test.ts
import { View, Pressable, ScrollView, StyleSheet, Switch, Text } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { AppPageHeader } from '../../components/AppPageHeader'
import { useTheme } from '../../hooks/useTheme'
import { useStewardConversation } from './useStewardConversation'
import { clearStewardDisplay } from './stewardDisplay'
import { StewardConversationActions } from './components/StewardConversationActions'
import { mobileDestinationHref, mobileFeatures } from '../../components/mobileFeatureRegistry'
import { mobileTypography } from '../../theme/mobileTypography'
/** One continuous personal conversation; provider selection belongs to the private Client settings. */
export function StewardSettingsScreen() {
  const router = useRouter(), { t } = useTranslation(), { colors } = useTheme(), steward = useStewardConversation()
  const machine = steward.machine
  return <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
    <AppPageHeader title={t('steward_settings_title')} onBack={() => router.back()} backTestID="steward-settings-back" />
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {(['memory', 'scheduledTasks'] as const).map(key => {
        const feature = mobileFeatures.find(item => item.key === key)!
        return <Pressable key={key} testID={`steward-settings-${key}`} accessibilityRole="button"
          onPress={() => router.push(mobileDestinationHref(key, 'push'))} style={[styles.row, { borderBottomColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.text }]}>{t(feature.label)}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
        </Pressable>
      })}
      <Pressable testID="steward-primary-computer" accessibilityRole="button" onPress={() => router.navigate('/(main)/primary-computer')} style={[styles.row, { borderBottomColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.text }]}>{t('personal_primary_settings')}</Text>
        <Text style={[styles.value, { color: colors.textSecondary }]}>{machine?.name ?? t('personal_primary_choose')}</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
      </Pressable>
      <Pressable testID="steward-model" accessibilityRole="button" onPress={() => router.navigate('/(main)/steward-model')} style={[styles.row, { borderBottomColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.text }]}>{t('personal_agent_system_settings')}</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
      </Pressable>
      <Pressable testID="steward-background-agent" accessibilityRole="button" onPress={() => router.navigate('/(main)/steward-background-agent')} style={[styles.row, { borderBottomColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.text }]}>{t('personal_worker_title')}</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
      </Pressable>
      <View style={[styles.row, { borderBottomColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.text }]}>{t('steward_settings_show_machine_name')}</Text>
        <Switch style={styles.toggle} testID="steward-toggle-machine-name" accessibilityLabel={t('steward_settings_show_machine_name')} value={steward.showMachineName} onValueChange={next => void steward.remember({ showMachineName: next })} />
      </View>
      <StewardConversationActions available={steward.status === 'ready' && Boolean(machine)}
        canReset={machine?.agents?.some(agent => agent.type === 'shennian' && agent.supportsFreshPersonalContext === true) === true}
        resetContext={steward.resetContext}
        clearDisplay={() => clearStewardDisplay(steward.accountId, machine!.id)} />
    </ScrollView>
  </SafeAreaView>
}
const styles = StyleSheet.create({ root: { flex: 1 }, content: { paddingHorizontal: 16, paddingBottom: 40 }, row: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth }, toggle: { alignSelf: 'center' }, label: { flex: 1, ...mobileTypography.body }, value: { ...mobileTypography.body, flexShrink: 1, textAlign: 'right' } })
