// @arch docs/features/personal-agent-workspace.md
// @test src/__tests__/machine-avatar.test.ts
import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { useMachinesStore } from '@shennian/shared'
import { AppPageHeader } from '../../components/AppPageHeader'
import { useTheme } from '../../hooks/useTheme'
import { mobileTypography } from '../../theme/mobileTypography'
import { useAuthStore } from '../../config/auth'
import { machineAccountClient } from '../machines/machineAccountClient'
import { MachineAvatar } from '../machines/components/MachineAvatar'
import { machineStyles } from '../machines/styles'
import { usePrimaryComputerSelection } from './usePrimaryComputerSelection'

export default function PrimaryComputerSettings() {
  const router = useRouter(), { t } = useTranslation(), { colors } = useTheme()
  const selection = usePrimaryComputerSelection()
  const machines = useMachinesStore(state => state.machines)
  const accountId = useAuthStore(state => state.user?.id)
  const [loading, setLoading] = useState(true), [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0)
  useFocusEffect(useCallback(() => {
    let active = true
    setLoading(true); setFailed(false)
    void machineAccountClient.listMachines().then(value => {
      if (active && useAuthStore.getState().user?.id === accountId) useMachinesStore.getState().setMachines(value)
    }).catch(() => { if (active) setFailed(true) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [accountId, attempt]))
  const eligible = machines.filter(selection.isEligible)
  const error = selection.failure || selection.primary.error
  const busy = loading || selection.primary.loading || selection.saving
  const retry = () => { setAttempt(n => n + 1); selection.retry() }
  return <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
    <AppPageHeader title={t('personal_primary_settings')} onBack={() => router.back()} />
    <ScrollView contentContainerStyle={styles.content}>
      {busy ? <ActivityIndicator style={styles.progress} color={colors.textSecondary} /> : null}
      {error || failed ? <Pressable accessibilityRole="button" onPress={retry} style={styles.notice}>
        <Text style={[mobileTypography.body, { color: colors.error }]}>{t(error || 'personal_unavailable')} · {t('retry')}</Text>
      </Pressable> : null}
      {!busy && !failed && !error && eligible.length === 0 ? <Pressable accessibilityRole="button" style={styles.row} onPress={() => router.navigate('/(main)/machines')}>
        <Text style={[styles.label, { color: colors.text }]}>{t('personal_no_machine')}</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
      </Pressable> : null}
      {eligible.map((machine, index) => {
        const selected = selection.isCurrent(machine)
        return <Pressable key={machine.id} testID={`primary-computer-${machine.id}`} accessibilityRole="radio"
          accessibilityState={{ checked: selected, disabled: busy || !selection.canChoose(machine) }}
          disabled={busy || !selection.canChoose(machine)} onPress={() => selection.choose(machine)}
          style={({ pressed }) => [machineStyles.machineCardCompact, machineStyles.compactMachineIdentity, {
            borderBottomColor: colors.groupedSeparator,
            borderBottomWidth: index === eligible.length - 1 ? 0 : 1,
            backgroundColor: pressed ? colors.surfaceHover : colors.bg,
          }]}>
          <MachineAvatar machine={machine} />
          <View style={machineStyles.compactMachineCopy}>
            <Text numberOfLines={1} style={[machineStyles.compactMachineName, { color: machine.online ? colors.text : colors.textSecondary }]}>{machine.name}</Text>
            <Text style={[machineStyles.compactMachineMetadata, { color: colors.textSecondary }]}>{t(machine.online ? 'machine_online' : 'machine_offline')}</Text>
          </View>
          {selected ? <Ionicons name="checkmark" size={22} color={colors.brand} /> : <View style={styles.checkSpace} />}
        </Pressable>
      })}
    </ScrollView>
  </SafeAreaView>
}
const styles = StyleSheet.create({ root: { flex: 1 }, content: { paddingHorizontal: 16, paddingBottom: 40 }, row: { minHeight: 64, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth }, label: { ...mobileTypography.body, flex: 1 }, checkSpace: { width: 22 }, progress: { marginVertical: 12 }, notice: { paddingVertical: 16 } })
