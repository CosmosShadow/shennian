import { styles, skeletonStyles } from './desktopSidebarStyles'
import { DesktopSidebarUpdateButton } from './DesktopSidebarUpdateButton'
import { useDesktopSidebarWindowState } from './useDesktopSidebarWindowState'
import { DesktopNavigationList, type NavigationRenderItem } from './DesktopNavigationList'
import { DesktopSidebarProjectReveal } from './desktopSidebarProjectReveal'
import { initializeDesktopProjectExpansion, isDesktopProjectExpanded } from './desktopSidebarProjectExpansion'
import { useDesktopShellController } from './DesktopShellController'
import { desktopProjectLaunchDefaults } from '../desktop-projects/desktopProjectScreenModel'
import { useDesktopMachineListModel } from '../desktop-machines/useDesktopMachineListModel'
import {
  getDesktopMachineSummary,
  getDesktopMachineSummaryTone,
} from '../desktop-machines/desktopMachineSummary'
// @arch docs/architecture/session-organization.md
// @arch docs/features/desktop-local-first-client.md
// @arch docs/features/desktop-settings-information-architecture.md
// @test src/__tests__/agent-workspaces-navigation.test.ts
// @test src/__tests__/desktop-machine-sidebar.test.ts
// @test src/__tests__/desktop-sidebar-virtualization.test.ts
// @test src/__tests__/desktop-shell-window-state.test.ts

import {
  View,
  Text,
  Image,
  Pressable,
  ActivityIndicator,
  Platform,
  StyleSheet,
} from 'react-native'
import { useGlobalSearchParams, usePathname } from 'expo-router'
import { useDesktopNavigationRouter as useRouter } from './useDesktopNavigationRouter'
import { useTranslation } from 'react-i18next'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  useSessionsStore,
  useSheetsStore,
  sortSessions,
  sortProjects,
  buildProjectKey,
  getProjectDirName,
  type SessionProject,
} from '@shennian/shared'
import { useTheme } from '../../hooks/useTheme'
import { useSessionPreviews } from '../../hooks/useSessionPreviews'
import { SessionItem } from '../../components/SessionItem'
import { useDesktopUpdateState } from '../desktop-control/hooks/useDesktopUpdateState'
import { accountRuntime } from '../account-runtime/accountRuntime'
import { useSessionUnreadCounts } from '../unread/useSessionUnreadCounts'
import {
  getProjectPrefsSnapshot,
  subscribeProjectPrefs,
  isProjectPinned,
  setProjectPinned,
} from '../projects/utils/projectPrefs'
import { resolveDesktopRoomListPreview } from '../desktop-rooms/desktopRoomListPreview'
import { DesktopConversationRow } from '../desktop-conversations/DesktopConversationRow'
import { formatSessionClockTime } from '../session-list/display'
import { Toast } from '../../components/Toast'
import { useToast } from '../../hooks/useToast'
import { useKeyboardShortcut } from '../../hooks/useKeyboardShortcut'
import { RoomListRow, RoomPendingRequestRow } from '../rooms/components/RoomListPanel'
import { useDesktopRoomListModel } from '../desktop-control/useDesktopRoomListModel'
import { useAuthStore } from '../../config/auth'
import { getApiBaseUrl } from '../../config/api'
import { resolveProfileAvatarUrl } from '../profile/profileAvatar'
import { shouldEnableProjectSessionShortcuts } from '../sessions/projectSessionShortcuts'
import { isDesktopControlSurfaceEnabled } from '../../utils/controlSurfaceLayout'
import {
  getActiveRoomNavigationId,
  getAuthenticatedRoomNavigationTarget,
} from '../rooms/roomNavigationTarget'
import {
  buildSidebarTreeItems,
  type SidebarProjectBranch,
  type SidebarSection,
  type SidebarTreeItem,
} from '../../components/sidebarTreeModel'
import {
  DesktopSidebarChrome,
  SidebarProjectHeader,
  SidebarSectionHeader,
  type TooltipPosition,
} from './DesktopSidebarTreeHeaders'
import { buildDesktopProjectNavigation } from '../projects/utils/desktopProjectNavigation'
import { getActiveSidebarProjectKey } from './desktopSidebarSelection'

const PROJECT_SESSION_PAGE_SIZE = 5
type Props = {
  width: number
  onDeleteSession?: (id: string) => void
}

function SkeletonBlock({ width }: { width: number | string }) {
  const { colors } = useTheme()
  return (
    <View
      style={[
        skeletonStyles.block,
        { width: width as number, backgroundColor: colors.surfaceHover },
      ]}
    />
  )
}

export function DesktopSidebar({ width, onDeleteSession }: Props) {
  const { t, i18n } = useTranslation()
  const router = useRouter()
  const pathname = usePathname()
  const {
    roomId: routeRoomId,
    machineId: routeProjectMachineId,
    workDir: routeProjectWorkDir,
  } = useGlobalSearchParams<{
    roomId?: string | string[]
    machineId?: string | string[]
    workDir?: string | string[]
  }>()
  const roomMode = pathname.includes('/spaces')
  const { colors, isDark } = useTheme()
  const { toast, showToast, hideToast } = useToast()
  const desktopUpdate = useDesktopUpdateState()
  const isDesktop = isDesktopControlSurfaceEnabled()
  const sessions = useSessionsStore((s) => s.sessions)
  const sessionUnreadCounts = useSessionUnreadCounts()
  const machineInventory = useDesktopMachineListModel()
  const machines = machineInventory.machines
  const machineSummary = getDesktopMachineSummary(machines)
  const machineSummaryTone = getDesktopMachineSummaryTone(machineSummary)
  const machineSummaryColor =
    machineSummaryTone === 'complete'
      ? colors.successText
      : machineSummaryTone === 'partial'
        ? colors.warningText
        : machineSummaryTone === 'offline'
          ? colors.errorText
          : colors.textSecondary
  const machinesLoading = machineInventory.surface === 'initial-loading'
  const { projectRecords } = useDesktopShellController()
  const loading = useSessionsStore((s) => s.loading)
  const openMachinePicker = useSheetsStore((s) => s.openMachinePicker)
  const openProjectLaunch = useSheetsStore((s) => s.openProjectLaunch)
  const user = useAuthStore((state) => state.user)
  const accountName = user?.name?.trim() || t('settings_account')
  const projectPrefs = useSyncExternalStore(
    subscribeProjectPrefs,
    getProjectPrefsSnapshot,
    getProjectPrefsSnapshot,
  )
  const [_settingsHovered, setSettingsHovered] = useState(false)
  const [settingsFocused, setSettingsFocused] = useState(false)
  const machineSummaryRef = useRef<View>(null)
  const [machineTooltipPos, setMachineTooltipPos] = useState<TooltipPosition | null>(null)
  const [machinesFocused, setMachinesFocused] = useState(false)
  const [projectLaunchTooltipPos, setProjectLaunchTooltipPos] = useState<TooltipPosition | null>(
    null,
  )
  const activeRoomId = useMemo(() => {
    return getActiveRoomNavigationId({ pathname, roomId: routeRoomId })
  }, [pathname, routeRoomId])
  const openRoom = useCallback(
    (roomId: string) => {
      router.navigate(
        getAuthenticatedRoomNavigationTarget({
          roomId,
          platform: Platform.OS,
          desktopControlSurface: isDesktop,
        }) as never,
      )
    },
    [isDesktop, router],
  )
  const roomList = useDesktopRoomListModel({
    onOpenRoom: openRoom,
    activeRoomId,
  })
  const {
    visibleSessionCounts,
    setVisibleSessionCounts,
    expandedKeys,
    setExpandedKeys,
    setProjectExpanded,
    setSectionExpanded,
    projectsOpen,
    setProjectsOpen,
    roomsOpen,
    setRoomsOpen,
    listRef,
    onNavigationContentSizeChange,
    onNavigationLayout,
    onNavigationScroll,
  } = useDesktopSidebarWindowState(
    user?.id ?? '',
    !loading && !machinesLoading && !roomList.loading,
  )
  const openNewConversation = useCallback(() => {
    setRoomsOpen(true)
    router.navigate('/(main)/contacts/new-conversation' as never)
  }, [router, setRoomsOpen])
  const previousNavigationPath = useRef(pathname)

  useEffect(() => {
    // Also runs for the first route so a restored target is never hidden inside a
    // folded section. These reveals are temporary and never become a preference.
    previousNavigationPath.current = pathname
    if (roomMode) setRoomsOpen(true)
    else if (pathname.includes('/chat/') || pathname.includes('/project')) setProjectsOpen(true)
  }, [pathname, roomMode, setRoomsOpen, setProjectsOpen])

  useSessionPreviews()

  const projectNavigation = useMemo(
    () => buildDesktopProjectNavigation(sessions, projectRecords, machines),
    [machines, projectRecords, sessions],
  )
  const sessionsWithMachineNames = projectNavigation.sessions

  const projects = useMemo(
    () =>
      sortProjects(projectNavigation.projects, {
        isPinned: (project) => Boolean(projectPrefs[project.key]?.pinnedAt),
      }),
    [projectNavigation.projects, projectPrefs],
  )
  const showProjectMachineName = projectNavigation.showMachineName
  const machinesById = useMemo(
    () => new Map(machines.map((machine) => [machine.id, machine])),
    [machines],
  )

  const sessionsByProject = useMemo(() => {
    const map = new Map<string, typeof sessions>()
    for (const session of sessionsWithMachineNames) {
      const key = buildProjectKey(session.machineId, session.workDir)
      const list = map.get(key)
      if (list) {
        list.push(session)
      } else {
        map.set(key, [session])
      }
    }
    for (const [key, projectSessions] of map) {
      map.set(key, sortSessions(projectSessions))
    }
    return map
  }, [sessionsWithMachineNames])

  const activeProjectKey = useMemo(
    () =>
      getActiveSidebarProjectKey({
        pathname,
        machineId: routeProjectMachineId,
        workDir: routeProjectWorkDir,
        sessions: sessionsWithMachineNames,
      }),
    [pathname, routeProjectMachineId, routeProjectWorkDir, sessionsWithMachineNames],
  )
  const activeSession = useMemo(
    () =>
      sessionsWithMachineNames.find(
        (session) =>
          pathname === `/chat/${session.id}` || pathname === `/(main)/chat/${session.id}`,
      ) ?? null,
    [pathname, sessionsWithMachineNames],
  )
  const projectSessionShortcutsEnabled = useMemo(
    () => shouldEnableProjectSessionShortcuts(pathname, sessionsWithMachineNames),
    [pathname, sessionsWithMachineNames],
  )

  const navigateSessionByDelta = useCallback(
    (delta: number) => {
      if (!projectSessionShortcutsEnabled) return
      if (sessionsWithMachineNames.length === 0) return
      const activeIndex = sessionsWithMachineNames.findIndex((session) =>
        pathname.includes(session.id),
      )
      const baseIndex = activeIndex >= 0 ? activeIndex : delta > 0 ? -1 : 0
      const nextIndex = Math.max(
        0,
        Math.min(sessionsWithMachineNames.length - 1, baseIndex + delta),
      )
      const nextSession = sessionsWithMachineNames[nextIndex]
      if (!nextSession || nextSession.id === sessionsWithMachineNames[activeIndex]?.id) return
      router.navigate(`/(main)/chat/${nextSession.id}`)
    },
    [pathname, projectSessionShortcutsEnabled, router, sessionsWithMachineNames],
  )

  useKeyboardShortcut({ key: 'j', ignoreWidgets: true }, projectSessionShortcutsEnabled, () =>
    navigateSessionByDelta(1),
  )
  useKeyboardShortcut({ key: 'k', ignoreWidgets: true }, projectSessionShortcutsEnabled, () =>
    navigateSessionByDelta(-1),
  )
  useKeyboardShortcut(
    { key: 'arrowdown', ignoreWidgets: true },
    projectSessionShortcutsEnabled,
    () => navigateSessionByDelta(1),
  )
  useKeyboardShortcut({ key: 'arrowup', ignoreWidgets: true }, projectSessionShortcutsEnabled, () =>
    navigateSessionByDelta(-1),
  )

  const visibleSessionRoute = useRef(pathname)
  const projectReveal = useRef(new DesktopSidebarProjectReveal()).current
  const projectsReady = !loading && !machinesLoading
  useEffect(() => {
    const routeChanged = visibleSessionRoute.current !== pathname
    visibleSessionRoute.current = pathname
    const revealActive = projectReveal.take(
      user?.id ?? '',
      pathname,
      activeProjectKey ?? null,
      projectsReady && projects.some((project) => project.key === activeProjectKey),
    )
    if (projects.length === 0) return
    setExpandedKeys((current) => {
      const next = initializeDesktopProjectExpansion(current, projects, projectsReady)
      return revealActive && activeProjectKey && next[activeProjectKey] !== true
        ? { ...next, [activeProjectKey]: true }
        : next
    })
    if ((!routeChanged && !revealActive) || !activeProjectKey || !activeSession) return
    const projectSessions = sessionsByProject.get(activeProjectKey) ?? []
    const activeIndex = projectSessions.findIndex((session) => session.id === activeSession.id)
    if (activeIndex < 0) return
    setVisibleSessionCounts((current) => {
      const requiredCount = activeIndex + 1
      const currentCount = current[activeProjectKey] ?? PROJECT_SESSION_PAGE_SIZE
      return currentCount >= requiredCount
        ? current
        : { ...current, [activeProjectKey]: requiredCount }
    })
  }, [
    projectReveal,
    user?.id,
    activeProjectKey,
    activeSession,
    pathname,
    projects,
    projectsReady,
    sessionsByProject,
    setExpandedKeys,
    setVisibleSessionCounts,
  ])

  const toggleExpanded = useCallback(
    (projectKey: string) => {
      setProjectExpanded(projectKey, !isDesktopProjectExpanded(expandedKeys, projectKey, projects.length))
    },
    [expandedKeys, projects.length, setProjectExpanded],
  )

  const showProjectLaunchTooltip = useCallback((position: TooltipPosition) => {
    setProjectLaunchTooltipPos(position)
  }, [])

  const hideProjectLaunchTooltip = useCallback(() => {
    setProjectLaunchTooltipPos(null)
  }, [])

  const handleRemoveProject = useCallback(
    async (project: SessionProject) => {
      if (!project.id) return
      try {
        await accountRuntime.deleteProject(project.id)
        setProjectPinned(project.key, false)
        showToast(t('remove_project'), 'success')
      } catch {
        showToast(t('remove_project_failed'), 'error')
      }
    },
    [showToast, t],
  )

  const projectBranches = useMemo<SidebarProjectBranch[]>(
    () =>
      projects.map((project) => ({
        project,
        sessions: sessionsByProject.get(project.key) ?? [],
        expanded: isDesktopProjectExpanded(expandedKeys, project.key, projects.length),
        visibleSessionCount: visibleSessionCounts[project.key] ?? PROJECT_SESSION_PAGE_SIZE,
      })),
    [expandedKeys, projects, sessionsByProject, visibleSessionCounts],
  )
  const navigationItems = useMemo(
    () =>
      buildSidebarTreeItems({
        projectsOpen,
        projectsLoading: loading || machinesLoading,
        projectBranches,
        roomsOpen,
        roomsLoading: roomList.loading,
        roomsFailed: roomList.failed,
        pendingRequests: roomList.pendingRequests,
        rooms: roomList.rooms,
        includeMachines: false,
        machinesOpen: false,
        machines: [],
      }),
    [
      isDesktop,
      loading,
      machinesLoading,
      projectBranches,
      projectsOpen,
      roomList.failed,
      roomList.loading,
      roomList.pendingRequests,
      roomList.rooms,
      roomsOpen,
    ],
  )
  const activeNavigationItemKey = useMemo(() => {
    if (activeSession) {
      // Keep the final target stable while its ancestor is being revealed and
      // its page count is being expanded. Falling back to the project row here
      // causes two visible jumps: project first, then the selected session.
      if (activeProjectKey) {
        return `project:${activeProjectKey}:session:${activeSession.id}` as const
      }
    }
    if (activeRoomId) {
      const roomItem = navigationItems.find(
        (item) => item.kind === 'room' && item.room.id === activeRoomId,
      )
      if (roomItem) return roomItem.key
    }
    if (activeProjectKey) {
      return (
        navigationItems.find(
          (item) => item.kind === 'project' && item.branch.project.key === activeProjectKey,
        )?.key ?? null
      )
    }
    return null
  }, [activeProjectKey, activeRoomId, activeSession, navigationItems])
  const visibleNavigationItemKeys = useRef(new Set<string>())
  const onNavigationViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: { item: SidebarTreeItem; isViewable: boolean }[] }) => {
      visibleNavigationItemKeys.current = new Set(
        viewableItems.filter((token) => token.isViewable).map((token) => token.item.key),
      )
    },
  ).current
  const previousActiveNavigationItemKey = useRef<string | null>(null)
  useEffect(() => {
    if (
      !activeNavigationItemKey ||
      previousActiveNavigationItemKey.current === activeNavigationItemKey
    ) {
      return
    }
    const index = navigationItems.findIndex((item) => item.key === activeNavigationItemKey)
    if (index < 0) return
    previousActiveNavigationItemKey.current = activeNavigationItemKey
    // Switching between rows already on screen should update selection without
    // recentering the user's sidebar. Once the user scrolls after a reveal, the
    // stable previous key prevents projection refreshes from stealing position.
    if (visibleNavigationItemKeys.current.has(activeNavigationItemKey)) return
    const frame = requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.5 })
    })
    return () => cancelAnimationFrame(frame)
  }, [activeNavigationItemKey, listRef, navigationItems])

  // A folded section must not hide new activity, so its header carries the total.
  const collapsedSectionUnread = useMemo(
    () => ({
      projects: projectBranches.reduce(
        (total, branch) =>
          total +
          branch.sessions.reduce((sum, session) => sum + (sessionUnreadCounts[session.id] ?? 0), 0),
        0,
      ),
      rooms: roomList.rooms.reduce((total, room) => total + ((room.unreadCount ?? 0) > 0 ? 1 : 0), 0),
    }),
    [projectBranches, roomList.rooms, sessionUnreadCounts],
  )
  const renderSectionHeader = useCallback(
    (section: SidebarSection) => {
      if (section === 'projects') {
        return (
          <SidebarSectionHeader
            label={t('workspace_agents')}
            expanded={projectsOpen}
            unreadCount={projectsOpen ? 0 : collapsedSectionUnread.projects}
            onToggle={() => setSectionExpanded('projects', !projectsOpen)}
            testID="sidebar-projects-section"
            action={{ label: t('start_new_project'), onPress: openMachinePicker }}
          />
        )
      }
      if (section === 'rooms') {
        return (
          <SidebarSectionHeader
            label={i18n.language.startsWith('zh') ? '对话' : 'Conversations'}
            expanded={roomsOpen}
            unreadCount={roomsOpen ? 0 : collapsedSectionUnread.rooms}
            onToggle={() => setSectionExpanded('rooms', !roomsOpen)}
            testID="sidebar-rooms-section"
            action={{
              label: i18n.language.startsWith('zh') ? '新建对话' : 'New conversation',
              onPress: openNewConversation,
            }}
          />
        )
      }
      return null
    },
    [
      collapsedSectionUnread,
      i18n.language,
      openMachinePicker,
      openNewConversation,
      projectsOpen,
      roomsOpen,
      setSectionExpanded,
      t,
    ],
  )

  const renderNavigationItem = useCallback(
    ({ item, index }: NavigationRenderItem) => {
      const nextItem = navigationItems[index + 1]
      switch (item.kind) {
        case 'section':
          return renderSectionHeader(item.section)
        case 'project-skeleton':
          return (
            <View style={skeletonStyles.row}>
              <SkeletonBlock width="70%" />
            </View>
          )
        case 'projects-empty':
          return (
            <View style={styles.inlineEmpty}>
              <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
                {t(machines.length === 0 ? 'no_machines' : 'no_projects_hint')}
              </Text>
            </View>
          )
        case 'project': {
          const { branch } = item
          const { project, sessions: projectSessions, expanded } = branch
          const pinned = isProjectPinned(project.key)
          const projectMachine = machinesById.get(project.machineId)
          const projectOffline = projectMachine ? !projectMachine.online : false
          return (
            <SidebarProjectHeader
              project={project}
              unreadCount={projectSessions.reduce(
                (total, session) => total + (sessionUnreadCounts[session.id] ?? 0),
                0,
              )}
              offline={projectOffline}
              active={activeProjectKey === project.key}
              pinned={pinned}
              expanded={expanded}
              showMachineName={showProjectMachineName}
              onToggleExpanded={() => toggleExpanded(project.key)}
              onCreateSession={() => {
                if (projectOffline) {
                  showToast(t('machine_offline_error'), 'error')
                  return
                }
                openProjectLaunch({
                  machineId: project.machineId,
                  machineName: project.machineName,
                  projectName: project.dirName || getProjectDirName(project.workDir),
                  workDir: project.workDir,
                  ...desktopProjectLaunchDefaults(project),
                })
              }}
              onTogglePin={() => setProjectPinned(project.key, !pinned)}
              onRemove={
                projectMachine?.role !== 'granted'
                  ? () => void handleRemoveProject(project)
                  : undefined
              }
              onShowLaunchTooltip={showProjectLaunchTooltip}
              onHideLaunchTooltip={hideProjectLaunchTooltip}
            />
          )
        }
        case 'session':
          return (
            <View style={styles.projectSessionRow}>
              <SessionItem
                session={item.session}
                onDelete={onDeleteSession}
                grouped
                compact
                titleOnly={isDesktop}
                hideMachineName
              />
            </View>
          )
        case 'project-more': {
          const { branch } = item
          return (
            <Pressable
              testID={`sidebar-project-${branch.project.key}-show-more`}
              style={({ pressed }) => [
                styles.showMoreButton,
                { backgroundColor: colors.surfaceHover, opacity: pressed ? 0.72 : 1 },
              ]}
              onPress={() =>
                setVisibleSessionCounts((current) => ({
                  ...current,
                  [branch.project.key]: Math.min(
                    branch.visibleSessionCount + PROJECT_SESSION_PAGE_SIZE,
                    branch.sessions.length,
                  ),
                }))
              }
              accessibilityRole="button"
            >
              <Text style={[styles.showMoreText, { color: colors.textTertiary }]}>{t('more')}</Text>
            </Pressable>
          )
        }
        case 'project-file':
          return null
        case 'rooms-loading':
          return (
            <View style={styles.compactStatus}>
              <ActivityIndicator color={colors.brand} />
            </View>
          )
        case 'rooms-error':
          return (
            <View style={styles.compactStatus}>
              <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
                {t('spaces_load_failed')}
              </Text>
              <Pressable
                onPress={() => void roomList.retry()}
                style={[styles.retryButton, { backgroundColor: colors.surfaceHover }]}
                accessibilityRole="button"
              >
                <Text style={[styles.retryText, { color: colors.brand }]}>{t('retry')}</Text>
              </Pressable>
            </View>
          )
        case 'rooms-empty':
          return (
            <View style={styles.inlineEmpty}>
              <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
                {t('spaces_empty_title')}
              </Text>
            </View>
          )
        case 'room-pending-header':
          return (
            <Text style={[styles.pendingSectionTitle, { color: colors.textSecondary }]}>
              {t('spaces_pending_requests_title')}
            </Text>
          )
        case 'room-pending':
          return <RoomPendingRequestRow request={item.request} compact />
        case 'room':
          return item.room.conversationKind === 'published_ai' ? (
            <DesktopConversationRow conversation={{
              id: item.room.id,
              title: item.room.name,
              preview: item.room.latestMessage?.text ?? '',
              timeLabel: formatSessionClockTime(item.room.latestMessage?.createdAt ?? item.room.updatedAt),
              kind: 'agent',
              unreadCount: item.room.unreadCount ?? 0,
              active: activeRoomId === item.room.id,
            }} onOpen={openRoom} />
          ) : (
            <RoomListRow
              room={item.room}
              accountId={roomList.accountId}
              compact
              active={activeRoomId === item.room.id}
              unreadCount={(item.room.unreadCount ?? 0) > 0 ? 1 : 0}
              compactSeparator={nextItem?.kind === 'room' && activeRoomId !== nextItem.room.id}
              onPress={() => openRoom(item.room.id)}
              onTogglePin={() => void roomList.togglePin(item.room)}
              previewResolver={resolveDesktopRoomListPreview}
            />
          )
        default:
          return null
      }
    },
    [
      activeRoomId,
      activeProjectKey,
      colors,
      handleRemoveProject,
      hideProjectLaunchTooltip,
      isDesktop,
      machines.length,
      machinesById,
      navigationItems,
      onDeleteSession,
      openProjectLaunch,
      openRoom,
      pathname,
      renderSectionHeader,
      roomList,
      router,
      sessionUnreadCounts,
      setVisibleSessionCounts,
      showProjectLaunchTooltip,
      showProjectMachineName,
      showToast,
      t,
      toggleExpanded,
    ],
  )

  return (
    <View
      style={[
        styles.container,
        { width, backgroundColor: colors.sidebarBackground, borderRightColor: colors.border },
      ]}
    >
      <DesktopSidebarChrome />
      <Pressable testID="sidebar-open-contacts" accessibilityRole="button"
        accessibilityState={{ selected: pathname === '/contacts' || pathname === '/plaza' }}
        onPress={() => router.navigate('/(main)/contacts' as never)}
        style={({ pressed }) => [styles.contactNavigationRow, {
          backgroundColor: pressed || pathname === '/contacts' || pathname === '/plaza'
            ? colors.selectionBackground : 'transparent',
        }]}>
        <Ionicons name="people-outline" size={18} color={colors.textSecondary} />
        <Text style={[styles.machineSummaryLabel, { color: colors.text }]}>{i18n.language.startsWith('zh') ? '联系人' : 'Contacts'}</Text>
      </Pressable>
      <DesktopNavigationList
        key={user?.id ?? ''}
        ref={listRef}
        onScroll={onNavigationScroll}
        onContentSizeChange={onNavigationContentSizeChange}
        onLayout={onNavigationLayout}
        data={navigationItems}
        renderItem={renderNavigationItem}
        onViewableItemsChanged={onNavigationViewableItemsChanged}
      />

      <View
        style={[
          styles.bottom,
          { cursor: 'pointer' },
          { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
        ]}
      >
        <Pressable
          testID="sidebar-open-settings"
          style={[
            styles.settingsRow,
            {
              backgroundColor: 'transparent',
              borderColor: settingsFocused ? colors.brand : 'transparent',
            },
          ]}
          onPress={() => router.navigate('/(main)/profile')}
          onHoverIn={() => setSettingsHovered(true)}
          onHoverOut={() => setSettingsHovered(false)}
          onFocus={event => setSettingsFocused((event.nativeEvent.target as unknown as HTMLElement)?.matches?.(':focus-visible') ?? false)}
          onBlur={() => setSettingsFocused(false)}
          accessibilityRole="button"
          accessibilityLabel={`${accountName}, ${t('settings')}`}
        >
          {user?.avatar?.smallUrl ? (
            <Image
              accessible={false}
              source={{
                uri: resolveProfileAvatarUrl(
                  user.avatar.smallUrl,
                  getApiBaseUrl(),
                  user.avatar.version,
                ),
              }}
              style={styles.accountAvatar}
            />
          ) : (
            <View
              accessible={false}
              style={[styles.accountAvatar, { backgroundColor: colors.selectionBackground }]}
            >
              <Ionicons name="person-outline" size={15} color={colors.textSecondary} />
            </View>
          )}
          <Text style={[styles.settingsLabel, { color: colors.text }]} numberOfLines={1}>
            {accountName}
          </Text>
        </Pressable>
        <Pressable
          testID="sidebar-open-machine-settings"
          accessibilityRole="button"
          ref={machineSummaryRef}
          accessibilityLabel={
            machineSummaryTone === 'offline'
              ? t('desktop_machine_offline_tooltip')
              : t('desktop_machine_summary', machineSummary)
          }
          onPress={() =>
            router.navigate({ pathname: '/(main)/profile', params: { category: 'machines' } })
          }
          onHoverIn={() => {
            if (machineSummaryTone !== 'offline') return
            machineSummaryRef.current?.measureInWindow((x, y) =>
              setMachineTooltipPos({ top: y - 34, left: x }),
            )
          }}
          onHoverOut={() => setMachineTooltipPos(null)}
          onFocus={event => setMachinesFocused((event.nativeEvent.target as unknown as HTMLElement)?.matches?.(':focus-visible') ?? false)}
          onBlur={() => setMachinesFocused(false)}
          style={[
            styles.machineSummaryRow,
            {
              backgroundColor:
                'transparent',
              borderColor: machinesFocused ? colors.brand : 'transparent',
            },
          ]}
        >
          <Ionicons
            name="desktop-outline"
            size={15}
            color={machineSummaryTone === 'offline' ? machineSummaryColor : colors.textSecondary}
          />
          <Text style={[styles.machineSummaryLabel, { color: machineSummaryColor }]}>
            {machineSummaryTone === 'offline'
              ? t('desktop_machine_offline_compact')
              : t('desktop_machine_summary_compact', machineSummary)}
          </Text>
        </Pressable>
        <DesktopSidebarUpdateButton
          update={desktopUpdate}
          onOpenUpdates={() =>
            router.navigate({ pathname: '/(main)/profile', params: { category: 'version' } })
          }
        />
      </View>
      {projectLaunchTooltipPos ? (
        <View pointerEvents="none" style={styles.tooltipPortalOverlay}>
          <View
            style={[
              styles.projectLaunchTooltip,
              {
                top: projectLaunchTooltipPos.top,
                right: projectLaunchTooltipPos.right,
                left: projectLaunchTooltipPos.left,
                backgroundColor: colors.text,
                shadowColor: isDark ? '#000' : '#111827',
              },
            ]}
          >
            <Text
              style={[styles.projectLaunchTooltipText, { color: colors.surface }]}
              numberOfLines={1}
            >
              {t('start_new_chat')}
            </Text>
          </View>
        </View>
      ) : null}
      {machineTooltipPos ? (
        <View pointerEvents="none" style={styles.tooltipPortalOverlay}>
          <View
            style={[
              styles.projectLaunchTooltip,
              {
                top: machineTooltipPos.top,
                left: machineTooltipPos.left,
                backgroundColor: colors.text,
                shadowColor: isDark ? '#000' : '#111827',
              },
            ]}
          >
            <Text style={[styles.projectLaunchTooltipText, { color: colors.surface }]}>
              {t('desktop_machine_offline_tooltip')}
            </Text>
          </View>
        </View>
      ) : null}
      <Toast
        message={toast?.message ?? ''}
        visible={!!toast}
        type={toast?.type}
        onHide={hideToast}
      />
    </View>
  )
}
