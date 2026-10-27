// @arch docs/features/desktop-settings-information-architecture.md
// @test ../../__tests__/desktop-machine-list-projection.test.ts

import { useState, useCallback } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { useProjectsStore } from '@shennian/shared'
import { useTheme } from '../../hooks/useTheme'
import { desktopControlMetrics, desktopTypography } from '../desktop-shell/desktopDesignTokens'
import { useDesktopControlState } from '../desktop-control/hooks/useDesktopControlState'
import { DesktopMachineListState } from '../desktop-machines/DesktopMachineListState'
import { DesktopMachineOverviewRow } from '../desktop-machines/DesktopMachineOverviewRow'
import { getDesktopMachineSummary } from '../desktop-machines/desktopMachineSummary'
import { useDesktopMachineListModel } from '../desktop-machines/useDesktopMachineListModel'

import { DesktopMachineAgents } from '../desktop-machines/DesktopMachineAgentsScreen'
import { DesktopMachineDetail } from '../desktop-machines/DesktopMachineDetailScreen'
import DesktopAddMachineScreen from '../desktop-machines/DesktopAddMachineScreen'
import DesktopMachineSharingScreen from '../desktop-machines/DesktopMachineSharingScreen'

export function DesktopMachineSettings() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [selectedMachine, setSelectedMachine] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [showTools, setShowTools] = useState(false)
  const [sharing, setSharing] = useState(false)
  const backToList = useCallback(() => { setSelectedMachine(null); setAdding(false); setSharing(false); setShowTools(false) }, [])
  const connected = useCallback((id: string) => { setAdding(false); setSelectedMachine(id) }, [])
  const { machines, surface, retry } = useDesktopMachineListModel()
  const desktop = useDesktopControlState()
  const projects = useProjectsStore((state) => state.projects)
  const [addFocused, setAddFocused] = useState(false)
  const summary = getDesktopMachineSummary(machines)
  const localMachine = machines.find((machine) => machine.id === desktop.status?.machineId)
  const visibleMachines = localMachine
    ? [localMachine, ...machines.filter((machine) => machine.id !== localMachine.id)]
    : machines
  const showNotice =
    surface === 'initial-loading' ||
    surface === 'forbidden' ||
    surface === 'offline' ||
    surface === 'error'
  const openAddMachine = () => setAdding(true)

  if (adding) return <DesktopAddMachineScreen onBack={backToList} onConnected={connected} />
  if (selectedMachine && showTools) return <DesktopMachineAgents machineId={selectedMachine} onBack={() => setShowTools(false)} />
  if (selectedMachine) return sharing
    ? <DesktopMachineSharingScreen machineIdOverride={selectedMachine} onBack={() => setSharing(false)} />
    : <DesktopMachineDetail key={selectedMachine} machineId={selectedMachine} embedded onBack={backToList} onOpenSharing={() => setSharing(true)} onOpenTools={() => setShowTools(true)} />

  return (
    <View testID="desktop-machine-settings" style={styles.root}>
      <View style={[styles.summary, { borderColor: colors.border, backgroundColor: colors.bg }]}>
        <View style={[styles.summaryIcon, { backgroundColor: colors.surfaceHover }]}>
          <Ionicons name="desktop-outline" size={20} color={colors.textSecondary} />
        </View>
        <View style={styles.summaryCopy}>
          <Text style={[styles.summaryTitle, { color: colors.text }]}>
            {t('desktop_machine_summary', summary)}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('add_machine')}
          testID="desktop-machine-settings-add"
          onPress={openAddMachine}
          onFocus={event => setAddFocused((event.nativeEvent.target as unknown as HTMLElement)?.matches?.(':focus-visible') ?? false)}
          onBlur={() => setAddFocused(false)}
          style={({ pressed }) => [
            styles.addButton,
            {
              borderColor: addFocused ? colors.text : colors.brand,
              backgroundColor: pressed ? colors.brandDark : colors.brand,
              opacity: pressed ? 0.82 : 1,
            },
          ]}
        >
          <Ionicons
            name="add"
            size={desktopControlMetrics.iconGlyphSize}
            color="#fff"
          />
          <Text style={styles.addLabel}>{t('add_machine')}</Text>
        </Pressable>
      </View>

      {showNotice ? (
        <DesktopMachineListState state={surface} compact={machines.length > 0} onRetry={retry} />
      ) : null}
      {surface === 'empty' ? (
        <View style={[styles.empty, { borderColor: colors.border, backgroundColor: colors.bg }]}>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>{t('no_machines')}</Text>
          <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
            {t('desktop_machine_settings_empty')}
          </Text>
        </View>
      ) : null}
      {visibleMachines.length > 0 ? (
        <View style={[styles.machineList, { borderColor: colors.border }]}>
          {visibleMachines.map((machine) => (
            <DesktopMachineOverviewRow
              key={machine.id}
              machine={machine}
              local={machine.id === localMachine?.id}
              projectCount={projects.filter((project) => project.machineId === machine.id).length}
              onPress={() => setSelectedMachine(machine.id)}
            />
          ))}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { gap: 14 },
  summary: {
    minHeight: 60,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: desktopControlMetrics.radiusContainer,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  summaryIcon: {
    width: 36,
    height: 36,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryCopy: { flex: 1, minWidth: 0, gap: 2 },
  summaryTitle: { ...desktopTypography.body, fontWeight: '600' },
  addButton: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderWidth: 2,
    borderRadius: desktopControlMetrics.radiusControl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  addLabel: { ...desktopTypography.control, color: '#fff', fontWeight: '600' },
  machineList: {
    gap: 10,
  },
  empty: {
    minHeight: 96,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: desktopControlMetrics.radiusContainer,
    padding: 16,
    justifyContent: 'center',
    gap: 4,
  },
  emptyTitle: { ...desktopTypography.body, fontWeight: '600' },
  emptyBody: desktopTypography.metadata,
})
