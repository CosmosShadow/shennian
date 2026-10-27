// @arch docs/architecture/app/modular-features.md#机器-feature
// @test src/__tests__/first-machine-setup.test.ts

import { useEffect } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useMachinesStore, useSheetsStore } from '@shennian/shared'
import { useTheme } from '../../../hooks/useTheme'
import { machineStyles } from '../styles'
import { MachinePickerCard } from './MachinePickerCard'
import { OfflineMachineCard } from './OfflineMachineCard'
import {
  useAppConnectivityStatus,
  useRelayConnectivitySnapshot,
} from '../../../hooks/useAppConnectivityStatus'

export { VersionBadge } from './VersionBadge'

export function MachinePickerContent({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const machines = useMachinesStore((store) => store.machines)
  const relayConnectivity = useRelayConnectivitySnapshot()
  const appConnectivity = useAppConnectivityStatus()

  if (relayConnectivity?.phase !== 'connected') {
    const reconnecting = appConnectivity !== 'disconnected'
    return (
      <View style={machineStyles.emptyState} testID="machine-picker-connection-state">
        {reconnecting ? (
          <ActivityIndicator size="small" color={colors.textTertiary} />
        ) : (
          <Ionicons name="cloud-offline-outline" size={32} color={colors.textTertiary} />
        )}
        <Text style={{ color: colors.textSecondary }}>
          {t(reconnecting ? 'machine_reconnecting' : 'relay_not_connected_short')}
        </Text>
      </View>
    )
  }

  const launchableMachines = machines.filter(
    (machine) => machine.online && !(machine.role === 'granted' && machine.permission === 'view'),
  )
  const offlineMachines = machines.filter((machine) => !machine.online)

  if (machines.length === 0) {
    return (
      <View style={machineStyles.emptyState}>
        <Text style={{ color: colors.textSecondary }}>{t('setup_no_machine')}</Text>
      </View>
    )
  }

  return (
    <View style={{ gap: 12, paddingTop: 16 }}>
      {launchableMachines.map((machine) => (
        <MachinePickerCard key={machine.id} machine={machine} onClose={onClose} />
      ))}
      {offlineMachines.map((machine) => (
        <OfflineMachineCard key={machine.id} machine={machine} />
      ))}
    </View>
  )
}

// Compatibility bridge for existing entry points; the task itself lives in the stack.
export default function MachinePickerSheet() {
  const router = useRouter()
  const isOpen = useSheetsStore((store) => store.machinePickerOpen)
  useEffect(() => {
    if (!isOpen) return
    useSheetsStore.getState().closeMachinePicker()
    router.navigate('/(main)/create-project')
  }, [isOpen, router])
  return null
}
