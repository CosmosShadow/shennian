// @arch docs/design/desktop/unified-desktop-control.md
// @arch docs/architecture/session-organization.md
// @test ../../__tests__/desktop-project-screen-model.test.ts
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { buildProjectKey, filterProjectSessions, groupSessionsIntoProjects, getProjectDirName,
  getSessionLiveActivity, hasSessionUnread, useMachinesStore, useProjectsStore, useSessionsStore, useSheetsStore } from '@shennian/shared'
import { useAuthStore } from '../../config/auth'
import { useTheme } from '../../hooks/useTheme'
import { useAppConnectivityStatus, useRelayConnectivitySnapshot } from '../../hooks/useAppConnectivityStatus'
import { useMachinePresentationState } from '../../hooks/useMachinePresentationState'
import { desktopAccountActions } from '../desktop-control/useDesktopAccountSync'
import type { SessionPageResult } from '../account-runtime/accountRuntime.types'
import { getAgentLaunchLabel } from '../machines/utils/launch'
import { formatSessionClockTime } from '../session-list/display'
import { resolveProjectSessionPageSurfaceState } from '../projects/services/projectSessionPageState'
import { DesktopProjectWorkspace } from './DesktopProjectWorkspace'
import { DesktopProjectScreenModel, canLaunchDesktopProject, desktopProjectLaunchDefaults, isDesktopProjectAlias } from './desktopProjectScreenModel'

export default function DesktopProjectScreen() {
  const params = useLocalSearchParams<{ machineId: string; workDir: string }>()
  const machineId = typeof params.machineId === 'string' ? params.machineId : ''
  const workDir = typeof params.workDir === 'string' ? params.workDir : ''
  const accountId = useAuthStore((state) => state.user?.id ?? '')
  return <DesktopProjectContent key={`${accountId}\u0000${machineId}\u0000${workDir}`}
    accountId={accountId} machineId={machineId} workDir={workDir} />
}

function DesktopProjectContent({ accountId, machineId, workDir }: { accountId: string; machineId: string; workDir: string }) {
  const router = useRouter()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const sessions = useSessionsStore((state) => state.sessions)
  const sessionsLoading = useSessionsStore((state) => state.loading)
  const records = useProjectsStore((state) => state.projects)
  const machine = useMachinesStore((state) => state.machines.find((entry) => entry.id === machineId))
  const connectivity = useAppConnectivityStatus()
  const relay = useRelayConnectivitySnapshot()
  const machineState = useMachinePresentationState(machine?.online ?? null, relay?.phase ?? null)
  const connectedRef = useRef(connectivity === 'connected')
  connectedRef.current = connectivity === 'connected'
  const openProjectLaunch = useSheetsStore((state) => state.openProjectLaunch)
  const openMachinePicker = useSheetsStore((state) => state.openMachinePicker)
  const [preserveVisiblePosition, setPreserveVisiblePosition] = useState(false)
  const ordinarySessions = useMemo(() => filterProjectSessions(sessions).map((session) =>
    machine?.name ? { ...session, machineName: machine.name } : session), [sessions, machine?.name])
  const project = useMemo(() => groupSessionsIntoProjects(ordinarySessions, records).find((entry) =>
    buildProjectKey(entry.machineId, entry.workDir) === buildProjectKey(machineId, workDir)) ?? null,
  [ordinarySessions, records, machineId, workDir])
  const projectSessions = useMemo(() => ordinarySessions.filter((session) =>
    buildProjectKey(session.machineId, session.workDir) === buildProjectKey(machineId, workDir)),
  [ordinarySessions, machineId, workDir])
  const model = useMemo(() => new DesktopProjectScreenModel({
    accountId: () => useAuthStore.getState().user?.id ?? null,
    connected: () => connectedRef.current,
    canonicalize: desktopAccountActions.canonicalizeProject,
    loadPage: async (id, page) => await desktopAccountActions.loadProjectSessions(id, page) as SessionPageResult,
    navigate: (canonical) => router.replace({ pathname: '/(main)/project', params: { machineId: canonical.machineId, workDir: canonical.workDir } }),
  }), [router])
  const page = useSyncExternalStore(model.subscribe, model.getState, model.getState)
  const alias = isDesktopProjectAlias(workDir)
  const aliasOnline = alias && machineState === 'online'
  useEffect(() => {
    model.open({ accountId, machineId, workDir, projectId: project?.id || null, online: aliasOnline })
    return () => model.dispose()
  }, [model, accountId, machineId, workDir, project?.id, aliasOnline])
  const state = alias
    ? page.failure ?? 'pending'
    : resolveProjectSessionPageSurfaceState({ projectAvailable: Boolean(project), sessionCount: projectSessions.length,
      localIndexLoading: sessionsLoading, pageLoading: page.loading, remoteAttempted: page.attempted, failure: page.failure })
  const canLaunch = canLaunchDesktopProject({ accountId, projectAvailable: Boolean(project), machineAvailable: Boolean(machine),
    workDir, machineState, forbidden: state === 'forbidden' })
  const rows = useMemo(() => projectSessions.map((session) => ({
    id: session.id, title: session.title || t('new_conversation'), agentLabel: getAgentLaunchLabel(session.agentType),
    updatedLabel: formatSessionClockTime(session.lastVisibleEventAt || session.lastMessagePreviewAt || session.createdAt),
    active: Boolean(getSessionLiveActivity(session)), unread: hasSessionUnread(session),
  })), [projectSessions, t])
  return <View style={{ flex: 1, minHeight: 0, backgroundColor: colors.bg }}>
    <DesktopProjectWorkspace title={project?.dirName || getProjectDirName(workDir) || workDir}
      machineName={machine?.name || project?.machineName || machineId} workDir={workDir}
      machineState={machineState} state={state} sessions={alias || state === 'forbidden' ? [] : rows}
      canLaunch={canLaunch} preserveVisiblePosition={preserveVisiblePosition}
      onStartSession={() => {
        if (!canLaunch || !project || useAuthStore.getState().user?.id !== accountId) return
        openProjectLaunch({ machineId: project.machineId, machineName: machine?.name || project.machineName,
          projectName: project.dirName || getProjectDirName(project.workDir), workDir: project.workDir,
          ...desktopProjectLaunchDefaults(project) })
      }}
      onOpenSession={(sessionId) => router.navigate(`/(main)/chat/${sessionId}`)}
      onRepairProject={openMachinePicker}
      onRetry={() => void model.retry()} onEndReached={() => model.endReached()}
      onScrollBegin={() => model.scrollBegin()} onScroll={(offset) => setPreserveVisiblePosition(offset > 32)} />
  </View>
}
