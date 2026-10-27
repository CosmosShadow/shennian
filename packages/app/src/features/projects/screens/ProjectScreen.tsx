import { ActionIconButton } from '../../../components/ActionIconButton'
// @arch docs/architecture/session-organization.md
// @arch docs/architecture/launch-config.md
// @test packages/app/src/__tests__/project-session-realtime-list.test.ts
// @test packages/app/src/__tests__/unread-navigation.test.ts
// @test tests/e2e/mobile/flows/ios/project-session-rename.yaml
// @test tests/e2e/mobile/flows/ios/project-tab-navigation.yaml

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSessionMachineNameProjection } from '../utils/projectListProjection'
import { useProjectSessions } from '../hooks/useProjectSessions'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  InteractionManager,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import Ionicons from '@expo/vector-icons/Ionicons'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  buildProjectKey,
  groupSessionsIntoProjects,
  getProjectDirName,
  useMachinesStore,
  useProjectsStore,
  useSessionsStore,
} from '@shennian/shared'
import type { AgentType, Machine } from '@shennian/wire'
import { useTranslation } from 'react-i18next'
import { saveProjectDefaults } from '../services/saveProjectDefaults'
import { refreshProjectAgents } from '../services/refreshProjectAgents'
import { projectAccountClient } from '../projectAccountClient'
import { useAuthStore } from '../../../config/auth'
import { accountRuntime } from '../../account-runtime/accountRuntime'
import { useTheme } from '../../../hooks/useTheme'
import { useGoBack } from '../../../hooks/useGoBack'
import { useNetworkStatus } from '../../../hooks/useNetworkStatus'
import { ProjectSessionListItem } from '../components/ProjectSessionListItem'
import { SessionItem } from '../../../components/SessionItem'
import { useMachineLaunchState } from '../../machines/hooks/useMachineLaunchState'
import { machineStyles } from '../../machines/styles'
import { ChoiceChip } from '../../../components/ChoiceChip'
import { getMachineAgentModels } from '../../../utils/models'
import { getAgentLaunchLabel } from '../../machines/utils/launch'
import { setProjectPinned } from '../utils/projectPrefs'
import { ProjectRemovalConfirmModal } from '../components/ProjectRemovalConfirmModal'
import { HeaderBackButton, HeaderIconButton } from '../../../components/AppPageHeader'
import { LaunchModelSelector } from '../../machines/components/LaunchModelSelector'
import {
  useAppConnectivityStatus,
  useRelayConnectivitySnapshot,
} from '../../../hooks/useAppConnectivityStatus'
import { useMachinePresentationState } from '../../../hooks/useMachinePresentationState'
import {
  classifyProjectSessionPageFailure,
  resolveProjectSessionPageSurfaceState,
  type ProjectSessionPageFailure,
} from '../services/projectSessionPageState'
import { formatProjectHeaderTitle } from '../services/formatProjectHeaderTitle'
import { machineAccountClient } from '../../machines/machineAccountClient'
import { isHomeDirectoryAlias, resolveProjectDirectory } from '../../machines/utils/projectDirectory'
import { styles } from './projectScreenStyles'
import { UnreadCountBadge } from '../../unread/UnreadCountBadge'
import { ProjectCoordinationPendingRows } from '../coordination/ProjectCoordinationPendingRows'
import { ProjectCoordinationEntry } from '../coordination/ProjectCoordinationEntry'
import { useProjectCoordination } from '../coordination/useProjectCoordination'
import { clearCoordinationCache, coordinationIdentityKey } from '../coordination/localState'
import { coordinationCounts, taskMatchesFilter, type CoordinationFilter } from '../coordination/client'
import { useContextualSteward } from '../../steward/ContextualStewardContext'
import { useSessionUnreadCounts } from '../../unread/useSessionUnreadCounts'
import { getOtherProjectsUnreadCount } from '../../unread/unreadNavigation'

type ProjectLaunchTarget = {
  id: string
  machineId: string
  machineName?: string | null
  workDir: string
  latestAgentType?: AgentType | null
  latestModelId?: string | null
  defaultAgentType?: AgentType | null
  defaultModelId?: string | null
}

function ProjectInlineLaunchPanel({
  machine,
  project,
  onClose,
}: {
  machine: Machine
  project: ProjectLaunchTarget
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const upsertProject = useProjectsStore((store) => store.upsertProject)
  const updateMachineAgents = useMachinesStore((store) => store.updateMachineAgents)
  const [refreshingAgents, setRefreshingAgents] = useState(false)
  const [savingDefault, setSavingDefault] = useState(false)
  const [defaultSaved, setDefaultSaved] = useState(false)
  const [defaultHelpExpanded, setDefaultHelpExpanded] = useState(false)
  const launchState = useMachineLaunchState({
    machine,
    homeLabel: t('home_dir'),
    includeModelSelection: true,
    initialWorkDir: project.workDir,
    initialAgentType: project.defaultAgentType ?? project.latestAgentType ?? undefined,
    initialModelId: project.defaultAgentType
      ? project.defaultModelId
      : (project.latestModelId ?? undefined),
    onLaunched: onClose,
  })
  const machineOffline = !machine.online
  const selectedModel = launchState.selectedModel ?? null
  const matchesDefault =
    project.defaultAgentType === launchState.selectedAgent &&
    (project.defaultModelId ?? null) === selectedModel
  const defaultConfigLabel = project.defaultAgentType
    ? [
        getAgentLaunchLabel(project.defaultAgentType),
        project.defaultModelId
          ? (getMachineAgentModels(machine, project.defaultAgentType).find(
              (model) => model.id === project.defaultModelId,
            )?.name ?? project.defaultModelId)
          : t('project_default_agent_model'),
      ].join(' · ')
    : t('project_default_unset')

  const saveProjectDefault = useCallback(async () => {
    setSavingDefault(true)
    setDefaultSaved(false)
    launchState.setError('')
    try {
      const savedProject = await saveProjectDefaults(project, {
        defaultAgentType: launchState.selectedAgent,
        defaultModelId: selectedModel,
      }, {
        createProject: machineAccountClient.createProject,
        updateDefaults: projectAccountClient.updateDefaults,
      })
      upsertProject(savedProject)
      setDefaultSaved(true)
    } catch (error) {
      launchState.setError(error instanceof Error ? error.message : String(error))
    } finally {
      setSavingDefault(false)
    }
  }, [launchState, project, selectedModel, upsertProject])

  const refreshAgents = useCallback(async () => {
    if (!machine.online || refreshingAgents || launchState.launching) return
    setRefreshingAgents(true)
    launchState.setError('')
    try {
      await refreshProjectAgents({
        machineId: machine.id,
        request: (machineId) => accountRuntime.requestMachine(machineId, 'agents.refresh', {}, {
          connectTimeoutMs: 15_000, responseTimeoutMs: 120_000,
        }),
        update: updateMachineAgents,
        failureMessage: t('machine_agent_refresh_failed'),
      })
    } catch (error) {
      launchState.setError(error instanceof Error ? error.message : String(error))
    } finally {
      setRefreshingAgents(false)
    }
  }, [launchState, machine.id, machine.online, refreshingAgents, t, updateMachineAgents])


  return (
    <View
      style={[
        styles.inlineLaunchPanel,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
      testID="project-inline-launch-panel"
    >
      <View style={styles.launchSelectionSection}>
        <Text style={[machineStyles.launchSectionTitle, { color: colors.text }]}>
          {t('project_directory')}
        </Text>
        <Text
          style={[
            styles.inlineLaunchPath,
            { color: Platform.OS === 'web' ? colors.textTertiary : colors.textMuted },
          ]}
          selectable
        >
          {project.workDir}
        </Text>
      </View>

      <View style={styles.launchSelectionSection}>
        <View style={styles.launchAgentHeading}>
          <Text style={[machineStyles.launchSectionTitle, { color: colors.text }]}>
            {t('agents_runtime')}
          </Text>
          <Pressable
            style={styles.launchAgentRefresh}
            onPress={() => void refreshAgents()}
            disabled={!machine.online || refreshingAgents || launchState.launching}
            accessibilityRole="button"
            accessibilityLabel={t('refresh_agents')}
            accessibilityState={{ disabled: !machine.online || refreshingAgents || launchState.launching, busy: refreshingAgents }}
            testID="project-agent-refresh-button"
          >
            {refreshingAgents ? <ActivityIndicator size="small" color={colors.brand} /> : (
              <Ionicons name="refresh-outline" size={20} color={machine.online ? colors.brand : colors.textTertiary} />
            )}
          </Pressable>
        </View>
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={t('agents_runtime')}
          style={machineStyles.modelGrid}
        >
          {launchState.agentList.map((agent) => (
            <ChoiceChip
              key={agent}
              label={launchState.getAgentLabel(agent)}
              selected={launchState.selectedAgent === agent}
              onPress={() => launchState.handleAgentSelect(agent)}
              disabled={launchState.launching}
            />
          ))}
        </View>
      </View>

      {launchState.availableModels.length > 0 ? (
        <View style={styles.launchSelectionSection}>
          <Text style={[machineStyles.launchSectionTitle, { color: colors.text }]}>
            {t('model')}
          </Text>
          <LaunchModelSelector
            agentType={launchState.selectedAgent}
            models={launchState.availableModels}
            selectedModel={launchState.selectedModel}
            disabled={launchState.launching}
            onSelectModel={launchState.handleModelSelect}
          />
        </View>
      ) : null}

      <Pressable
        style={[
          machineStyles.launchBtn,
          styles.inlineLaunchButton,
          { backgroundColor: colors.brand },
          (launchState.launching || (Platform.OS === 'web' && machineOffline)) && { opacity: 0.6 },
        ]}
        onPress={() => {
          if (Platform.OS === 'web' && machineOffline) {
            launchState.setError(t('machine_offline_error'))
            return
          }
          void launchState.handleLaunch()
        }}
        disabled={launchState.launching}
        accessibilityRole="button"
        accessibilityLabel={t('start_new_chat')}
        accessibilityHint={t('start_new_chat_hint')}
      >
        {launchState.launching ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={machineStyles.launchBtnText}>
            {t('launch')} {launchState.getAgentLabel(launchState.selectedAgent)}
          </Text>
        )}
      </Pressable>

      <View style={[styles.projectDefaultSection, { borderTopColor: colors.border }]}>
        <View style={styles.projectDefaultCopy}>
          <Pressable
            style={styles.projectDefaultTitleButton}
            hitSlop={8}
            onPress={() => setDefaultHelpExpanded((expanded) => !expanded)}
            accessibilityRole="button"
            accessibilityLabel={t(
              defaultHelpExpanded ? 'project_default_help_hide' : 'project_default_help_show',
            )}
            accessibilityState={{ expanded: defaultHelpExpanded }}
          >
            <Text style={[machineStyles.launchSectionTitle, { color: colors.text }]}>
              {t('project_default_config')}
            </Text>
          </Pressable>
          {defaultHelpExpanded ? (
            <Text style={[styles.projectDefaultHint, { color: Platform.OS === 'web' ? colors.textTertiary : colors.textSecondary }]}>
              {t('project_default_config_hint')}
            </Text>
          ) : null}
          <View style={styles.projectDefaultCurrentRow}>
            <Text
              style={[
                styles.projectDefaultCurrentValue,
                { color: project.defaultAgentType ? colors.text : colors.textTertiary },
              ]}
              numberOfLines={1}
            >
              {defaultConfigLabel}
            </Text>
          </View>
        </View>
        <Pressable
          style={[
            styles.projectDefaultButton,
            {
              borderColor: matchesDefault ? colors.border : colors.brand + '66',
              backgroundColor: matchesDefault ? colors.surfaceHover : colors.brand + '10',
            },
          ]}
          onPress={() => void saveProjectDefault()}
          disabled={savingDefault || matchesDefault}
          testID="project-set-default-button"
          accessibilityRole="button"
          accessibilityLabel={t(matchesDefault ? 'project_default_saved' : 'project_set_default')}
        >
          {savingDefault ? (
            <ActivityIndicator size="small" color={colors.brand} />
          ) : (
            <Ionicons
              name={matchesDefault || defaultSaved ? 'checkmark-circle' : 'bookmark-outline'}
              size={17}
              color={matchesDefault ? colors.textSecondary : colors.brand}
            />
          )}
          <Text
            style={[
              styles.projectDefaultButtonText,
              { color: matchesDefault ? colors.textSecondary : colors.brand },
            ]}
          >
            {t(matchesDefault ? 'project_default_saved' : 'project_set_default')}
          </Text>
        </Pressable>
      </View>

      {launchState.error ? (
        <Text style={[machineStyles.errorText, { color: colors.error }]}>{launchState.error}</Text>
      ) : null}
      {machineOffline ? (
        <Text style={[machineStyles.errorText, { color: colors.textTertiary }]}>
          {t('machine_offline_restart_hint')}
        </Text>
      ) : null}
    </View>
  )
}

export default function ProjectScreen() {
  const { machineId = '', workDir = '' } = useLocalSearchParams<{
    machineId: string
    workDir: string
  }>()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { height, width } = useWindowDimensions()
  const router = useRouter()
  const goBack = useGoBack()
  const insets = useSafeAreaInsets()
  const networkStatus = useNetworkStatus()
  const connectivity = useAppConnectivityStatus()
  const accountId = useAuthStore((store) => store.user?.id ?? '')
  const sessions = useProjectSessions(machineId, workDir)
  const sessionUnreadCounts = useSessionUnreadCounts()
  const otherProjectsUnreadCount = useSessionsStore((store) =>
    getOtherProjectsUnreadCount(store.sessions, { machineId, workDir }, sessionUnreadCounts),
  )
  const sessionsLoading = useSessionsStore((store) => store.loading)
  const projectRecords = useProjectsStore((store) => store.projects)
  const machine = useMachinesStore((store) => store.machines.find((item) => item.id === machineId))
  const coordination = useProjectCoordination(machineId, workDir, machine?.online === true && machine.role !== 'granted')
  const [coordinationFilter, setCoordinationFilter] = useState<CoordinationFilter>('all')
  const contextualSteward = useContextualSteward()
  const setContextDetails = contextualSteward?.setDetails
  useEffect(() => {
    setContextDetails?.(previous => ({ ...previous, projectCoordination: coordination.state?.enabled ? 'enabled' : 'disabled' }))
    return () => { setContextDetails?.(previous => ({ ...previous, projectCoordination: 'disabled' })) }
  }, [coordination.state?.enabled, setContextDetails])
  const [savingCoordination, setSavingCoordination] = useState(false)
  const coordinationUnavailable = !machine?.online || !coordination.state || Boolean(coordination.error) || savingCoordination
  const changeCoordination = (enabled: boolean) => {
    if (coordinationUnavailable) return
    const configure = () => {
      setSavingCoordination(true)
      void coordination.request({ command: 'configure', patch: { enabled } })
        .catch(() => Alert.alert(t('coordination_error')))
        .finally(() => setSavingCoordination(false))
    }
    if (enabled) configure()
    else Alert.alert(t('coordination_disable_title'), t('coordination_disable_hint'), [
      { text: t('cancel'), style: 'cancel' }, { text: t('confirm'), onPress: configure },
    ])
  }
  const relayConnectivity = useRelayConnectivitySnapshot()
  const machinePresentation = useMachinePresentationState(
    machine?.online ?? null,
    relayConnectivity?.phase ?? null,
  )
  const [projectActionsOpen, setProjectActionsOpen] = useState(false)
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false)
  const [projectSessionsLoading, setProjectSessionsLoading] = useState(false)
  const [projectSessionsHasMore, setProjectSessionsHasMore] = useState(true)
  const [projectSessionsBefore, setProjectSessionsBefore] = useState<number | undefined>()
  const [projectSessionsRemoteAttempted, setProjectSessionsRemoteAttempted] = useState(false)
  const [projectSessionsFailure, setProjectSessionsFailure] =
    useState<ProjectSessionPageFailure | null>(null)
  const projectSessionRequestGeneration = useRef(0)
  const activeProjectSessionRequest = useRef<{ generation: number; identity: string } | null>(null)
  const projectEndReachedLockedRef = useRef(false)
  const [preserveVisiblePosition, setPreserveVisiblePosition] = useState(false)
  const withMachineName = useMemo(() => createSessionMachineNameProjection(), [])
  const sessionsWithMachineNames = useMemo(
    () =>
      sessions.map((session) =>
        withMachineName(session, machine?.name),
      ),
    [machine?.name, sessions, withMachineName],
  )

  const project = useMemo(
    () =>
      groupSessionsIntoProjects(sessionsWithMachineNames, projectRecords.filter((record) =>
        buildProjectKey(record.machineId, record.workDir) === buildProjectKey(machineId, workDir),
      )).find(
        (item) =>
          buildProjectKey(item.machineId, item.workDir) === buildProjectKey(machineId, workDir),
      ) ?? null,
    [machineId, projectRecords, sessionsWithMachineNames, workDir],
  )

  const projectSessions = sessionsWithMachineNames
  const coordinationTasks = useMemo(() => new Map(
    coordination.state?.tasks.map(task => [task.id, task]) ?? [],
  ), [coordination.state?.tasks])
  const visibleProjectSessions = useMemo(() => !coordination.state?.enabled ? projectSessions : projectSessions.filter(session =>
    taskMatchesFilter(coordinationTasks.get(session.id), coordinationFilter, session.activity?.runPhase)),
  [projectSessions, coordination.state?.enabled, coordinationTasks, coordinationFilter])

  // Legacy aliases are navigation references, not a second session namespace.
  // Keep their records/defaults intact; the canonical project's settings remain authoritative.
  useEffect(() => {
    if (!accountId || !machineId || !isHomeDirectoryAlias(workDir) || machinePresentation !== 'online') return
    let cancelled = false
    void (async () => {
      const resolvedDir = await resolveProjectDirectory(machineId, workDir, accountRuntime)
      if (cancelled) return
      const canonical = await machineAccountClient.createProject(machineId, resolvedDir)
      if (cancelled) return
      await accountRuntime.persistProject(canonical)
      if (cancelled) return
      useProjectsStore.getState().upsertProject(canonical)
      router.replace({ pathname: '/(main)/project', params: { machineId, workDir: canonical.workDir } })
    })().catch((error) => {
      if (!cancelled) Alert.alert(t('error'), error instanceof Error ? error.message : String(error))
    })
    return () => { cancelled = true }
  }, [accountId, machineId, machinePresentation, router, t, workDir])

  const projectIdentity = `${accountId}\u0000${machineId}\u0000${buildProjectKey(machineId, workDir)}\u0000${project?.id ?? ''}`

  const loadProjectSessionPage = useCallback(
    async (reset = false) => {
      if (!project?.id) return
      if (activeProjectSessionRequest.current?.identity === projectIdentity) return
      if (!reset && !projectSessionsHasMore) return
      const generation = ++projectSessionRequestGeneration.current
      activeProjectSessionRequest.current = { generation, identity: projectIdentity }
      setProjectSessionsLoading(true)
      setProjectSessionsRemoteAttempted(true)
      setProjectSessionsFailure(null)
      try {
        const result = await accountRuntime.loadProjectSessions(project.id, {
          limit: 100,
          before: reset ? undefined : projectSessionsBefore,
        })
        if (
          activeProjectSessionRequest.current?.generation !== generation ||
          activeProjectSessionRequest.current.identity !== projectIdentity
        ) return
        setProjectSessionsHasMore(result.hasMore)
        setProjectSessionsBefore(result.nextBefore ?? undefined)
      } catch (error) {
        if (
          activeProjectSessionRequest.current?.generation === generation &&
          activeProjectSessionRequest.current.identity === projectIdentity
        ) {
          setProjectSessionsFailure(classifyProjectSessionPageFailure(error, connectivity))
        }
      } finally {
        if (
          activeProjectSessionRequest.current?.generation === generation &&
          activeProjectSessionRequest.current.identity === projectIdentity
        ) {
          activeProjectSessionRequest.current = null
          setProjectSessionsLoading(false)
        }
      }
    },
    [connectivity, project?.id, projectIdentity, projectSessionsBefore, projectSessionsHasMore],
  )

  // Local hydration is not a new navigation or a reason to restart a remote page.
  useEffect(() => {
    projectSessionRequestGeneration.current += 1
    activeProjectSessionRequest.current = null
    setProjectSessionsBefore(undefined)
    setProjectSessionsHasMore(true)
    setProjectSessionsFailure(null)
    setProjectSessionsLoading(false)
    setProjectSessionsRemoteAttempted(false)
    projectEndReachedLockedRef.current = false
    const refresh = project?.id
      ? InteractionManager.runAfterInteractions(() => { void loadProjectSessionPage(true) })
      : undefined
    if (!project?.id) {
      setProjectSessionsRemoteAttempted(true)
    }
    return () => {
      refresh?.cancel()
      projectSessionRequestGeneration.current += 1
      activeProjectSessionRequest.current = null
    }
  }, [projectIdentity])

  const projectSessionSurfaceState = resolveProjectSessionPageSurfaceState({
    projectAvailable: Boolean(project),
    sessionCount: projectSessions.length,
    localIndexLoading: sessionsLoading,
    pageLoading: projectSessionsLoading,
    remoteAttempted: projectSessionsRemoteAttempted,
    failure: projectSessionsFailure,
  })

  const handleProjectEndReached = useCallback(() => {
    if (!projectSessionsRemoteAttempted || projectEndReachedLockedRef.current) return
    projectEndReachedLockedRef.current = true
    void loadProjectSessionPage()
  }, [loadProjectSessionPage, projectSessionsRemoteAttempted])

  const handleProjectScrollBegin = useCallback(() => {
    projectEndReachedLockedRef.current = false
  }, [])

  const handleProjectListScroll = useCallback((offsetY: number) => {
    const nearTop = offsetY <= 32
    // At the top, preserving the old first row would hide a newly inserted
    // realtime session just above the viewport. Preserve position only while
    // the user has intentionally scrolled away, without adding a second
    // "new tasks" interaction on top of the live list.
    setPreserveVisiblePosition(!nearTop)
  }, [])

  const handleDelete = useCallback(
    async (id: string) => {
      if (networkStatus === 'offline') {
        Alert.alert(t('delete_session_failed'), t('delete_session_offline'))
        return
      }
      try {
        await accountRuntime.deleteSession(id, 'auto')
        if (projectSessions.length <= 1) {
          router.replace('/(main)')
        }
      } catch (error) {
        const isForbidden =
          error instanceof Error &&
          'status' in error &&
          (error as { status?: number }).status === 403
        Alert.alert(
          t('delete_session_failed'),
          isForbidden ? t('delete_session_forbidden') : t('error_unknown'),
        )
      }
    },
    [networkStatus, projectSessions.length, router, t],
  )

  const handleRemoveProject = useCallback(async () => {
    if (!project?.id) return
    try {
      await accountRuntime.deleteProject(project.id)
      clearCoordinationCache(coordinationIdentityKey({ accountId, machineId, workDir }))
      setProjectPinned(project.key, false)
      setRemoveConfirmOpen(false)
      setProjectActionsOpen(false)
      router.replace('/(main)')
    } catch {
      setRemoveConfirmOpen(false)
      Alert.alert(t('remove_project_failed'), t('error_unknown'))
    }
  }, [accountId, machineId, project, router, t, workDir])

  const requestRemoveProject = useCallback(() => {
    setProjectActionsOpen(false)
    if (Platform.OS === 'web') {
      setRemoveConfirmOpen(true)
      return
    }
    Alert.alert(t('remove_project'), t('remove_project_confirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('remove_project'),
        style: 'destructive',
        onPress: () => void handleRemoveProject(),
      },
    ])
  }, [handleRemoveProject, t])

  const machineLabel = project?.machineName || machine?.name || machineId
  const projectLabel = project?.dirName || getProjectDirName(workDir) || workDir
  const machineStatusLabel =
    machinePresentation === 'reconnecting'
      ? t('machine_reconnecting')
      : machinePresentation === 'offline'
        ? t('machine_offline')
        : null
  const headerTitle = formatProjectHeaderTitle(machineLabel, projectLabel, machineStatusLabel)
  // This detail page has no root tab bar; leave only a small spacing below rows.
  const listBottomInset = Math.max(20, insets.bottom + 12)
  const showLaunchLabel = Platform.OS === 'web' && width >= 768
  const useActionsPopover = Platform.OS === 'web' && width >= 768
  const showRemoveProjectAction = Platform.OS === 'web'
  const openCoordination = () => router.push({ pathname: '/(main)/project-coordination', params: { machineId, workDir } })
  const coordinationBadgeCounts = coordination.state?.enabled ? coordinationCounts(coordination.state, projectSessions) : null
  const coordinationPendingRows = coordination.state?.enabled ? <ProjectCoordinationPendingRows state={coordination.state} sessions={projectSessions} filter={coordinationFilter} onManager={openCoordination} onTask={id => router.navigate(`/(main)/chat/${id}`)} /> : null
  const coordinationEmpty = coordinationBadgeCounts && coordinationFilter !== 'all' && coordinationBadgeCounts[coordinationFilter] === 0
    ? <Text style={{ padding: 24, color: colors.textMuted, textAlign: 'center' }}>{t(coordinationFilter === 'attention' ? 'coordination_no_attention' : 'coordination_empty')}</Text> : null

  const openNewChat = () => {
    if (isHomeDirectoryAlias(workDir)) return
    if (machinePresentation === 'online') {
      setProjectActionsOpen(true)
      return
    }
    Alert.alert(machinePresentation === 'offline'
      ? t('machine_not_online_named', { machine: machineLabel })
      : t('machine_reconnecting'))
  }


  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.separator ?? colors.border }]}>
        <HeaderBackButton
          onPress={goBack}
          testID="project-back"
          accessibilityLabel={
            otherProjectsUnreadCount > 0
              ? t('back_to_projects_with_unread', { count: otherProjectsUnreadCount })
              : t('back')
          }
          badge={
            otherProjectsUnreadCount > 0 ? (
              <UnreadCountBadge count={otherProjectsUnreadCount} testID="project-back-unread" />
            ) : undefined
          }
        />
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
            {headerTitle}
          </Text>
        </View>
        {projectSessionSurfaceState === 'forbidden' ? (
          <View style={styles.iconBtn} />
        ) : (
          <ActionIconButton icon="add" color={showLaunchLabel ? colors.brand : colors.text}
            style={[
              styles.launchBtn,
              showLaunchLabel ? [styles.launchBtnExpanded, { width: 'auto' }] : styles.iconBtn,
              machinePresentation !== 'online' && styles.unavailableAction,
            ]}
            onPress={openNewChat}
            disabled={isHomeDirectoryAlias(workDir)}
            onLongPress={() => Alert.alert(t('start_new_chat'), t('start_new_chat_hint'))}
            label={t('start_new_chat')}
            accessibilityHint={t('start_new_chat_hint')}
          >

            {showLaunchLabel ? (
              <Text style={[styles.launchBtnText, { color: colors.brand }]} numberOfLines={1}>
                {t('start_new_chat')}
              </Text>
            ) : null}
          </ActionIconButton>
        )}
      </View>
      {projectSessionSurfaceState !== 'forbidden' && machine?.role !== 'granted' && Platform.OS !== 'web' && coordination.state?.enabled ? (
        <ProjectCoordinationEntry counts={coordinationBadgeCounts ?? undefined} state={coordination.state} unavailable={Boolean(coordination.error) || !machine?.online} filter={coordinationFilter} onFilter={setCoordinationFilter}
          onOpen={openCoordination} />
      ) : null}
      <Modal
        visible={projectActionsOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setProjectActionsOpen(false)}
      >
        <View
          style={[
            styles.actionsOverlay,
            useActionsPopover ? styles.actionsOverlayPopover : styles.actionsOverlaySheet,
          ]}
        >
          <Pressable
            style={styles.actionsBackdrop}
            onPress={() => setProjectActionsOpen(false)}
            accessible={false}
            importantForAccessibility="no-hide-descendants"
          />
          <View
            style={[
              styles.actionsCard,
              useActionsPopover ? styles.actionsPopoverCard : styles.actionsSheetCard,
              {
                backgroundColor: colors.bg,
                borderColor: colors.border,
                maxHeight: Math.max(0, height - insets.top - 24),
                paddingBottom: useActionsPopover ? 12 : Math.max(22, insets.bottom),
              },
            ]}
            accessibilityViewIsModal
          >
            <View style={styles.actionsHeader}>
              <Text style={[styles.actionsTitle, { color: colors.text }]}>
                {t('start_new_chat')}
              </Text>
              <HeaderIconButton
                icon="close"
                label={t('close')}
                onPress={() => setProjectActionsOpen(false)}
              />
            </View>
            <ScrollView
              testID="project-launch-scroll"
              style={styles.actionsScroll}
              contentContainerStyle={styles.actionsContent}
              showsVerticalScrollIndicator
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
            >
              {Platform.OS !== 'web' && machine?.role !== 'granted' ? (
                <View style={[styles.secondaryAction, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                  <Text style={[styles.secondaryActionText, { color: colors.text, flex: 1 }]}>{t('coordination_title')}</Text>
                  {(!coordination.state && machine?.online && !coordination.error) || savingCoordination ? (
                    <ActivityIndicator accessibilityLabel={t('coordination_connecting')} color={colors.brand} />
                  ) : (
                    <Switch
                      testID="project-launch-coordination-toggle"
                      accessibilityLabel={t('coordination_enabled')}
                      disabled={coordinationUnavailable}
                      value={Boolean(coordination.state?.enabled)}
                      onValueChange={changeCoordination}
                    />
                  )}
                </View>
              ) : null}
              {projectActionsOpen && project && machine ? (
                <ProjectInlineLaunchPanel
                  machine={machine}
                  project={project}
                  onClose={() => setProjectActionsOpen(false)}
                />
              ) : null}
              {showRemoveProjectAction && machine?.role !== 'granted' ? (
                <Pressable
                  style={[
                    styles.secondaryAction,
                    { borderColor: colors.error + '55', backgroundColor: colors.surface },
                  ]}
                  onPress={requestRemoveProject}
                  accessibilityRole="button"
                  accessibilityLabel={t('remove_project')}
                >
                  <View
                    style={[styles.actionIconSecondary, { backgroundColor: colors.error + '12' }]}
                  >
                    <Ionicons name="trash-outline" size={19} color={colors.error} />
                  </View>
                  <View style={styles.actionCopy}>
                    <Text style={[styles.secondaryActionText, { color: colors.error }]}>
                      {t('remove_project')}
                    </Text>
                    <Text style={[styles.secondaryActionHint, { color: colors.textTertiary }]}>
                      {t('remove_project_confirm')}
                    </Text>
                  </View>
                </Pressable>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
      <ProjectRemovalConfirmModal
        visible={removeConfirmOpen}
        onClose={() => setRemoveConfirmOpen(false)}
        onConfirm={() => void handleRemoveProject()}
      />
      {/* Keep the mobile list unframed in every state without exposing revoked content. */}
      {projectSessionSurfaceState === 'forbidden' ? <View style={{ flex: 1 }} /> : Platform.OS === 'web' ? (
        <FlatList key={`project-filter-${coordination.state?.enabled ? coordinationFilter : 'all'}`}
          ListHeaderComponent={coordinationPendingRows}
          ListEmptyComponent={coordinationEmpty}
          data={visibleProjectSessions}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <SessionItem session={item} onDelete={handleDelete} />}
          automaticallyAdjustsScrollIndicatorInsets={false}
          scrollIndicatorInsets={{ top: 0, bottom: listBottomInset }}
          onScrollBeginDrag={handleProjectScrollBegin}
          onMomentumScrollBegin={handleProjectScrollBegin}
          onScroll={({ nativeEvent }) => handleProjectListScroll(nativeEvent.contentOffset.y)}
          scrollEventThrottle={100}
          maintainVisibleContentPosition={
            preserveVisiblePosition ? { minIndexForVisible: 0 } : undefined
          }
          onEndReached={handleProjectEndReached}
          onEndReachedThreshold={0.4}
        />
      ) : (
        <FlatList key={`project-filter-${coordination.state?.enabled ? coordinationFilter : 'all'}`}
          ListHeaderComponent={coordinationPendingRows}
          ListEmptyComponent={coordinationEmpty}
          data={visibleProjectSessions}
          keyExtractor={(item) => item.id}
          initialNumToRender={12}
          maxToRenderPerBatch={8}
          windowSize={5}
          // Row modals share this responder tree; do not consume their first action to blur.
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: listBottomInset }}
          automaticallyAdjustsScrollIndicatorInsets={false}
          scrollIndicatorInsets={{ top: 0, bottom: listBottomInset }}
          onScrollBeginDrag={handleProjectScrollBegin}
          onMomentumScrollBegin={handleProjectScrollBegin}
          onScroll={({ nativeEvent }) => handleProjectListScroll(nativeEvent.contentOffset.y)}
          scrollEventThrottle={100}
          maintainVisibleContentPosition={
            preserveVisiblePosition ? { minIndexForVisible: 0 } : undefined
          }
          onEndReached={handleProjectEndReached}
          onEndReachedThreshold={0.4}
          renderItem={({ item }) => (
            <ProjectSessionListItem
              session={item}
              coordinationStatus={coordination.state?.enabled ? (() => {
                const status = coordinationTasks.get(item.id)?.status
                const keys: Record<string, string> = { queued: 'coordination_queued', running: 'coordination_running', waiting: 'coordination_attention', review: 'coordination_review', completed: 'coordination_completed', failed: 'coordination_failed', paused: 'coordination_paused', memo: 'coordination_memo' }
                return status && keys[status] ? t(keys[status]) : undefined
              })() : undefined}
              onDelete={handleDelete}
            />
          )}
        />
      )}
    </SafeAreaView>
  )
}
