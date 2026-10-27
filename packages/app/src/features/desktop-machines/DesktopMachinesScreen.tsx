// @arch docs/design/desktop/unified-desktop-control.md
// @test ../../__tests__/desktop-machine-list-projection.test.ts
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useState } from 'react'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useProjectsStore } from '@shennian/shared'
import { useTheme } from '../../hooks/useTheme'
import { useDesktopControlState } from '../desktop-control/hooks/useDesktopControlState'
import { useDesktopMachineListModel } from './useDesktopMachineListModel'
import { desktopMachineDetailStyles } from './DesktopMachineDetailLayout'
import { DesktopMachineOverviewRow } from './DesktopMachineOverviewRow'
import { DesktopMachineListState } from './DesktopMachineListState'
import { DesktopClientMissingCard } from './DesktopClientMissingCard'
import { DESKTOP_WORKSPACE_HEADER_HEIGHT } from '../desktop-shell/desktopWorkspaceMetrics'
import { DesktopFirstUseEmptyState } from '../desktop-onboarding/DesktopFirstUseEmptyState'
import { desktopControlMetrics, desktopTypography } from '../desktop-shell/desktopDesignTokens'

export default function DesktopMachinesScreen() {
  const { t, i18n } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const { machines, surface, retry } = useDesktopMachineListModel()
  const desktop = useDesktopControlState()
  const projects = useProjectsStore((state) => state.projects)
  const openAddMachine = () => router.navigate('/(main)/machines?add=1' as never)
  const [addFocused, setAddFocused] = useState(false)
  const [addHovered, setAddHovered] = useState(false)
  const localMachine = machines.find((machine) => machine.id === desktop.status?.machineId)
  const visibleMachines = localMachine
    ? [localMachine, ...machines.filter((machine) => machine.id !== localMachine.id)]
    : machines
  const onlineCount = machines.filter((machine) => machine.online && !machine.remoteAccessDisabledAt).length
  const zh = i18n.language.startsWith('zh')
  const showNotice =
    surface === 'initial-loading' ||
    surface === 'forbidden' ||
    surface === 'offline' ||
    surface === 'error'
  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]} testID="desktop-machines-screen">
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.heading}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
            {t('machines')}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('add_machine')}
          onPress={openAddMachine}
          onFocus={() => setAddFocused(true)}
          onBlur={() => setAddFocused(false)}
          onHoverIn={() => setAddHovered(true)}
          onHoverOut={() => setAddHovered(false)}
          style={({ pressed }) => [
            styles.button,
            {
              borderColor: addFocused ? colors.text : colors.brand,
              backgroundColor: pressed || addHovered ? colors.brandDark : colors.brand,
              opacity: pressed ? 0.82 : 1,
            },
          ]}
        >
          <Ionicons name="add" size={desktopControlMetrics.compactIconGlyphSize} color="#fff" />
          <Text style={styles.buttonText}>{t('add_machine')}</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={[desktopMachineDetailStyles.content, styles.content]}>
        {machines.length > 0 ? (
          <View testID="desktop-machine-summary" style={[styles.summary, { backgroundColor: colors.surfaceHover }]}>
            <View style={styles.summaryCount}>
              <Text style={[styles.summaryNumber, { color: colors.text }]}>{machines.length}</Text>
              <Text style={[styles.summaryCaption, { color: colors.textSecondary }]}>{zh ? '台机器' : machines.length === 1 ? 'machine' : 'machines'}</Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
            <View style={styles.summaryCount}>
              <View style={[styles.onlineDot, { backgroundColor: colors.success }]} />
              <Text style={[styles.summaryCaption, { color: colors.textSecondary }]}>{zh
                ? onlineCount === machines.length ? '全部在线' : `${onlineCount} 台在线`
                : onlineCount === machines.length ? 'All online' : `${onlineCount} online`}</Text>
            </View>
          </View>
        ) : null}
        {desktop.bridge && desktop.connectorSource?.kind === 'missing' ? (
          <DesktopClientMissingCard bridge={desktop.bridge} onRecheck={desktop.refresh} />
        ) : null}
        {showNotice ? (
          <DesktopMachineListState state={surface} compact={machines.length > 0} onRetry={retry} />
        ) : null}
        {surface === 'empty' ? (
          <DesktopFirstUseEmptyState
            colors={colors}
            onAddMachine={openAddMachine}
            onBrowseRooms={() => router.navigate('/(main)/spaces')}
          />
        ) : null}
        {visibleMachines.length ? (
          <View style={[styles.machineList, { borderColor: colors.border }]}>
            {visibleMachines.map((machine) => (
              <DesktopMachineOverviewRow
                key={machine.id}
                machine={machine}
                local={machine.id === localMachine?.id}
                projectCount={projects.filter((project) => project.machineId === machine.id).length}
                onPress={() => router.navigate(`/(main)/machine/${machine.id}`)}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  )
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    minHeight: DESKTOP_WORKSPACE_HEADER_HEIGHT,
    paddingHorizontal: 24,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  heading: { minWidth: 0, flex: 1 },
  title: desktopTypography.windowTitle,
  button: {
    minHeight: desktopControlMetrics.standardControlHeight,
    minWidth: desktopControlMetrics.standardControlHeight,
    paddingHorizontal: 12,
    borderRadius: desktopControlMetrics.radiusControl,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  buttonText: { ...desktopTypography.control, color: '#fff', fontWeight: '600' },
  content: { gap: 16 },
  summary: { minHeight: 76, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 26, paddingHorizontal: 24 },
  summaryCount: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  summaryNumber: { fontSize: 26, lineHeight: 32, fontWeight: '700' },
  summaryCaption: { fontSize: 14, lineHeight: 20 },
  summaryDivider: { width: StyleSheet.hairlineWidth, height: 26 },
  onlineDot: { width: 9, height: 9, borderRadius: 5 },
  machineList: {
    gap: 10,
  },
})
