import { useMobileModuleBack } from '../../../components/useMobileModuleBack'
// @arch docs/architecture/app/modular-features.md#机器-feature
// @test src/__tests__/machine-feature-utils.test.ts
// @test src/__tests__/machine-primary-shortcut.test.ts

import { useCallback, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useMachinesStore, useSheetsStore } from '@shennian/shared'
import { AppPageHeader, HeaderIconButton } from '../../../components/AppPageHeader'
import { useTheme } from '../../../hooks/useTheme'
import { machineStyles } from '../styles'
import { MachineCard } from '../components/MachineCard'
import { FirstMachineSetupPanel } from '../components/FirstMachineSetupPanel'
import { MachineListStateNotice } from '../components/MachineListStateNotice'
import { useAppConnectivityStatus } from '../../../hooks/useAppConnectivityStatus'
import {
  refreshMachineList,
  resolveMachineListSurfaceState,
  type MachineListFailure,
} from '../services/machineListState'
import { machineAccountClient } from '../machineAccountClient'
import { usePrimaryMachine } from '../../personal-workspace/usePrimaryMachine'
import { mobileTypography } from '../../../theme/mobileTypography'

export default function MachinesScreen() {
  const moduleBack = useMobileModuleBack()
  const primary = usePrimaryMachine()
  const { t } = useTranslation()
  const router = useRouter()
  const { colors } = useTheme()
  const machines = useMachinesStore((store) => store.machines)
  const machinesLoading = useMachinesStore((store) => store.loading)
  const machinesRemoteResolved = useMachinesStore((store) => store.remoteResolved)
  const setMachines = useMachinesStore((store) => store.setMachines)
  const setMachinesRemoteResolved = useMachinesStore((store) => store.setRemoteResolved)
  const openAddMachine = useSheetsStore((store) => store.openAddMachine)
  const [refreshing, setRefreshing] = useState(false)
  const [failure, setFailure] = useState<MachineListFailure | null>(null)
  const requestGeneration = useRef(0)
  const connectivity = useAppConnectivityStatus()
  const surfaceState = useMemo(
    () =>
      resolveMachineListSurfaceState({
        machineCount: machines.length,
        loading: machinesLoading,
        remoteResolved: machinesRemoteResolved,
        refreshing,
        failure,
      }),
    [failure, machines.length, machinesLoading, machinesRemoteResolved, refreshing],
  )

  const fetchMachines = useCallback(async () => {
    const generation = ++requestGeneration.current
    const nextFailure = await refreshMachineList({
      request: async () => ({ machines: await machineAccountClient.listMachines() }),
      connectivity,
      replaceMachines: setMachines,
      markRemoteResolved: () => setMachinesRemoteResolved(true),
      isCurrent: () => generation === requestGeneration.current,
    })
    if (generation === requestGeneration.current) setFailure(nextFailure)
  }, [connectivity, setMachines, setMachinesRemoteResolved])

  useFocusEffect(
    useCallback(() => {
      void fetchMachines()
      return () => {
        requestGeneration.current += 1
      }
    }, [fetchMachines]),
  )

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    setFailure(null)
    try {
      await fetchMachines()
      primary.refresh()
    } finally {
      setRefreshing(false)
    }
  }, [fetchMachines])

  return (
    <SafeAreaView style={[machineStyles.container, { backgroundColor: colors.bg }]} edges={['top']}>
      <AppPageHeader
        title={t('mobile_my_computers')}
        onBack={moduleBack}
        trailing={machines.length > 0 ? (
          <HeaderIconButton icon="add" label={t('add_machine')} onPress={openAddMachine} />
        ) : null}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={52}
      >
        <ScrollView
          style={machineStyles.scroll}
          contentContainerStyle={machineStyles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.brand}
            />
          }
        >
          {primary.loading ? <ActivityIndicator color={colors.brand} /> : null}
          {primary.error ? (
            <Pressable accessibilityRole="button" onPress={primary.refresh} style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 8 }}>
              <Text style={[mobileTypography.secondary, { color: colors.error }]}>{t(primary.error)} · {t('retry')}</Text>
            </Pressable>
          ) : null}
          {surfaceState === 'initial-loading' ? (
            <MachineListStateNotice
              state="initial-loading"
              compact={false}
              onRetry={handleRefresh}
            />
          ) : surfaceState === 'forbidden' ? (
            <MachineListStateNotice state="forbidden" compact={false} onRetry={handleRefresh} />
          ) : machines.length === 0 && (surfaceState === 'offline' || surfaceState === 'error') ? (
            <MachineListStateNotice state={surfaceState} compact={false} onRetry={handleRefresh} />
          ) : surfaceState === 'empty' ? (
            <View style={machineStyles.firstMachineSetup}>
              <FirstMachineSetupPanel
                onMachineInvite={(token) =>
                  router.navigate(`/machine-invites/${encodeURIComponent(token)}`)
                }
                onScan={() => router.navigate('/(main)/scan')}
              />
            </View>
          ) : (
            <View style={machineStyles.machineList}>
              {surfaceState === 'offline' || surfaceState === 'error' ? (
                <MachineListStateNotice state={surfaceState} compact onRetry={handleRefresh} />
              ) : null}
              {machines.map((machine, index) => (
                <MachineCard
                  key={machine.id}
                  machine={machine}
                  mode="manage"
                  compact
                  primary={primary.record?.machine?.id === machine.id}
                  onPrimaryPress={() => router.navigate('/(main)/primary-computer')}
                  last={index === machines.length - 1}
                  onExpand={() => router.navigate(`/(main)/machine/${machine.id}`)}
                />
              ))}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
