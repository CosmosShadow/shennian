import { ActionIcon } from '../../../components/ActionIcon'
// @arch docs/features/machine-onboarding.md
import { useCallback, useRef, useState } from 'react'
import { InteractionManager, Pressable, ScrollView, Text } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useMachinesStore } from '@shennian/shared'
import { AppPageHeader } from '../../../components/AppPageHeader'
import { useGoBack } from '../../../hooks/useGoBack'
import { useTheme } from '../../../hooks/useTheme'
import { mobileTypography } from '../../../theme/mobileTypography'
import { MachinePickerContent } from '../components/MachinePickerSheet'
import { machineAccountClient } from '../machineAccountClient'

export default function CreateProjectScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const goBack = useGoBack()
  const [error, setError] = useState(false)
  const generation = useRef(0)
  const active = useRef(false)
  const load = useCallback(() => {
    const request = ++generation.current
    void machineAccountClient.listMachines().then(machines => {
      if (active.current && request === generation.current) {
        useMachinesStore.getState().setMachines(machines)
        setError(false)
      }
    }).catch(() => { if (active.current && request === generation.current) setError(true) })
  }, [])
  useFocusEffect(useCallback(() => {
    active.current = true
    const task = InteractionManager.runAfterInteractions(load)
    return () => { task.cancel(); active.current = false; generation.current++ }
  }, [load]))
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      <AppPageHeader title={t('machine_picker_title')} onBack={goBack} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <Pressable
          accessibilityRole="button"
          testID="create-project-add-machine"
          onPress={() =>
            router.navigate({ pathname: '/(main)/add-machine', params: { from: 'create-project' } })
          }
          style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12 }}
        >
          <ActionIcon name="add" color={colors.brand} />
          <Text style={{ ...mobileTypography.body, color: colors.brand, flex: 1 }}>
            {t('add_machine')}
          </Text>
          <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
        </Pressable>
        {error ? (
          <Pressable accessibilityRole="button" onPress={load} style={{ paddingVertical: 12 }}>
            <Text style={{ color: colors.errorText }}>{t('setup_refresh_failed')}</Text>
          </Pressable>
        ) : null}
        <MachinePickerContent onClose={goBack} />
      </ScrollView>
    </SafeAreaView>
  )
}
