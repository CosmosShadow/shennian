// import { showVoiceEntryMenu } from '../../src/features/personal-modules/voiceEntryMenu'
import { useMobileModuleBack } from '../../src/components/useMobileModuleBack'
// @arch docs/architecture/session-organization.md
// @test packages/app/src/__tests__/main-layout-hooks.test.ts
// @test packages/app/src/__tests__/project-prefs.test.ts
// @test packages/app/src/__tests__/room-navigation.test.ts

import { useVisibleProjectRecords } from '../../src/features/projects/hooks/useVisibleProjectRecords'
import React, { useMemo, useSyncExternalStore, useCallback } from 'react'
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native'
import { Redirect, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import Ionicons from '@expo/vector-icons/Ionicons'
import { FlatList } from 'react-native-gesture-handler'
import {
  useSessionsStore,
  useMachinesStore,
  useSheetsStore,
  filterProjectSessions,
  sortProjects,
  buildProjectKey,
  getSessionLiveActivity,
} from '@shennian/shared'
import { useTheme } from '../../src/hooks/useTheme'
import { useSessionActivityNow } from '../../src/hooks/useSessionActivityNow'
import { useSessionPreviews } from '../../src/hooks/useSessionPreviews'
import { MobileProjectListItem } from '../../src/features/projects/components/MobileProjectListItem'
import {
  getProjectPrefsSnapshot,
  isProjectPinned,
  setProjectPinned,
  subscribeProjectPrefs,
} from '../../src/features/projects/utils/projectPrefs'
import { createProjectListProjection, createSessionMachineNameProjection } from '../../src/features/projects/utils/projectListProjection'
import { orderMobileProjects } from '../../src/features/projects/utils/mobileProjectOrder'
// import { useVoiceChiefController } from '../../src/features/voice-chief/VoiceChiefCallContext'
import { AppPageHeader, HeaderIconButton } from '../../src/components/ConnectedAppPageHeader'
import { useSessionUnreadCounts } from '../../src/features/unread/useSessionUnreadCounts'
import { useRelayConnectivitySnapshot } from '../../src/hooks/useAppConnectivityStatus'
import { accountRuntime } from '../../src/features/account-runtime/accountRuntime'
import { mobileTypography } from '../../src/theme/mobileTypography'

function ProjectSeparator() {
  const { colors } = useTheme()
  return <View style={[styles.projectSeparator, { backgroundColor: colors.border }]} />
}

function MobileHome() {
  const { t } = useTranslation()
  const moduleBack = useMobileModuleBack()
  const router = useRouter()
  const openMachinePicker = useSheetsStore((s) => s.openMachinePicker)
  const openAddMachine = useSheetsStore((s) => s.openAddMachine)
  const { colors } = useTheme()
  const sessions = useSessionsStore((s) => s.sessions)
  const machines = useMachinesStore((s) => s.machines)
  const machinesRemoteResolved = useMachinesStore((s) => s.remoteResolved)
  const projectRecords = useVisibleProjectRecords()
  const loading = useSessionsStore((s) => s.loading)
  const showInitialPlaceholder =
    sessions.length === 0 && machines.length === 0 && (loading || !machinesRemoteResolved)
  // 项目页暂时隐藏语音入口，保留实现供后续统一通话使用。
  // const voiceChief = useVoiceChiefController()
  // const hasVoiceEntry =
  //   machines.length > 0 && !(voiceChief.active && voiceChief.mode === 'floating')
  const projectPrefs = useSyncExternalStore(
    subscribeProjectPrefs,
    getProjectPrefsSnapshot,
    getProjectPrefsSnapshot,
  )
  const sessionUnreadCounts = useSessionUnreadCounts()
  const relayConnectivity = useRelayConnectivitySnapshot()

  const withMachineName = useMemo(() => createSessionMachineNameProjection(), [])
  const sessionsWithMachineNames = useMemo(() => {
    const machineNames = new Map(machines.map((machine) => [machine.id, machine.name]))
    return filterProjectSessions(sessions).map((session) => {
      const machineName = machineNames.get(session.machineId)?.trim()
      return withMachineName(session, machineName)
    })
  }, [machines, sessions, withMachineName])

  const projectProjection = useMemo(() => createProjectListProjection(), [])
  const machinesById = useMemo(() => new Map(machines.map(machine => [machine.id, machine])), [machines])
  const projects = useMemo(
    () => {
      const grouped = projectProjection(sessionsWithMachineNames, projectRecords)
      const sorted = sortProjects(grouped)
      return orderMobileProjects(
        sorted,
        machines.map((machine) => machine.id),
        (project) => projectPrefs[project.key]?.pinnedAt,
      )
    },
    [machines, projectPrefs, projectRecords, sessionsWithMachineNames, projectProjection],
  )
  const projectUnreadCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const session of sessionsWithMachineNames) {
      const key = buildProjectKey(session.machineId, session.workDir)
      counts.set(key, (counts.get(key) ?? 0) + (sessionUnreadCounts[session.id] ?? 0))
    }
    return counts
  }, [sessionUnreadCounts, sessionsWithMachineNames])
  const activityNow = useSessionActivityNow(sessionsWithMachineNames)
  const projectRunningCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const session of sessionsWithMachineNames) {
      if (!getSessionLiveActivity(session, { now: activityNow })) continue
      const key = buildProjectKey(session.machineId, session.workDir)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [sessionsWithMachineNames, activityNow])
  const showProjectMachineName = machines.length > 1
  const handleRemoveProject = useCallback(
    async (projectId: string, projectKey: string) => {
      if (!projectId) return
      try {
        await accountRuntime.deleteProject(projectId)
        setProjectPinned(projectKey, false)
      } catch {
        Alert.alert(t('remove_project_failed'), t('error_unknown'))
      }
    },
    [t],
  )

  const renderProject = (item: (typeof projects)[number]) => (
    <MobileProjectListItem
      project={item}
      unreadCount={projectUnreadCounts.get(item.key) ?? 0}
      runningCount={projectRunningCounts.get(item.key) ?? 0}
      pinned={isProjectPinned(item.key)}
      showMachineName={showProjectMachineName}
      machineOnline={machinesById.get(item.machineId)?.online ?? null}
      machineName={machinesById.get(item.machineId)?.name || item.machineName || item.machineId}
      relayPhase={relayConnectivity?.phase ?? null}
      onPress={() => router.navigate({ pathname: '/(main)/project', params: { machineId: item.machineId, workDir: item.workDir, __mobileEntry: moduleBack ? 'push' : 'tab' } })}
      onTogglePin={() => setProjectPinned(item.key, !isProjectPinned(item.key))}
      onRemove={item.id && machinesById.get(item.machineId)?.role !== 'granted'
        ? () => void handleRemoveProject(item.id, item.key) : undefined}
    />
  )

  const ds = useMemo(
    () => ({
      container: { backgroundColor: colors.bg },
      emptyText: { color: colors.textSecondary },
      emptyBtn: { backgroundColor: colors.brand },
    }),
    [colors],
  )

  return (
    <SafeAreaView style={[styles.container, ds.container]} edges={['top']}>
      <AppPageHeader
        title={t('workspace_agents')}
        onBack={moduleBack}
        showsConnectivityStatus
        sideWidth={96}
        trailing={<View style={{ flexDirection: 'row' }}>
          {/* 项目页语音入口暂时隐藏，底层通话和录音功能保留。
          {hasVoiceEntry ? <HeaderIconButton icon="call-outline"
            label={t('listening_entry_title')} onPress={() => showVoiceEntryMenu(t, () => router.navigate('/(main)/voice-chief'), () => router.navigate({ pathname: '/(main)/personal-modules', params: { tab: 'recording' } }))}
            testID="home-open-voice-chief" /> : null}
          */}
          {machines.length > 0 ? <HeaderIconButton icon="add" label={t('start_new_project')}
            onPress={openMachinePicker}
            onLongPress={() => Alert.alert(t('start_new_project'), t('start_new_project_hint'))}
            accessibilityHint={t('start_new_project_hint')} testID="home-open-machine-picker" /> : null}
        </View>}
      />

      {showInitialPlaceholder ? (
        <View style={styles.initialPlaceholder} />
      ) : projects.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons
            name={machines.length === 0 ? 'desktop-outline' : 'chatbubbles-outline'}
            size={40}
            color={colors.textTertiary}
          />
          <Text style={[styles.emptyText, ds.emptyText]}>
            {t(machines.length === 0 ? 'no_machines' : 'no_projects_hint')}
          </Text>
          <Pressable
            testID={machines.length === 0 ? 'home-add-machine' : 'home-start-project'}
            style={[styles.emptyBtn, ds.emptyBtn]}
            onPress={machines.length === 0 ? openAddMachine : openMachinePicker}
          >
            <Text style={styles.emptyBtnText}>
              {t(machines.length === 0 ? 'first_machine_setup_title' : 'start_new_project')}
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.listWrap}>
          <FlatList
            data={projects}
            keyExtractor={(item) => item.key}
            style={{ flex: 1, backgroundColor: colors.bg }}
            contentContainerStyle={{
              flexGrow: 1,
              paddingBottom: 12,
            }}
            automaticallyAdjustsScrollIndicatorInsets={false}
            scrollIndicatorInsets={{ top: 0, bottom: 12 }}
            renderItem={({ item }) => renderProject(item)}
            ItemSeparatorComponent={ProjectSeparator}
            windowSize={10}
            maxToRenderPerBatch={16}
            initialNumToRender={16}
          />
        </View>
      )}
    </SafeAreaView>
  )
}

export function ProjectTabScreen() {
  useSessionPreviews()
  return <MobileHome />
}

export default function HomeScreen() {
  return <Redirect href="/(main)/(tabs)/projects" />
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listWrap: {
    flex: 1,
  },
  projectSeparator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 44,
  },
  initialPlaceholder: {
    flex: 1,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyIcon: {},
  emptyText: {
    ...mobileTypography.secondary,
    textAlign: 'center',
  },
  emptyBtn: {
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginTop: 8,
  },
  emptyBtnText: {
    color: '#fff',
    ...mobileTypography.compactAction,
  },
})
