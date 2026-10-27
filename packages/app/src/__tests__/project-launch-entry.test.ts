import { readI18nSource } from './i18n-source-test-helper'
/**
 * @covers packages/app/src/features/desktop-shell/DesktopSidebar.tsx
 * @covers packages/app/src/features/machines/components/MachinePickerCard.tsx
 * @covers packages/app/src/features/projects/screens/ProjectScreen.tsx
 * @covers packages/app/app/(main)/index.tsx
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { formatProjectHeaderTitle } from '../features/projects/services/formatProjectHeaderTitle'
import { refreshProjectAgents } from '../features/projects/services/refreshProjectAgents'

function readSource(path: string): string {
  return readFileSync(resolve(__dirname, path), 'utf-8')
}

describe('project Agent refresh', () => {
  it('applies a successful machine snapshot immediately', async () => {
    const update = vi.fn()
    const agents = [{ type: 'codex', models: [{ id: 'model', name: 'Model' }] }]
    await refreshProjectAgents({
      machineId: 'test-mac',
      request: vi.fn(async () => ({
        type: 'res' as const,
        id: 'r1',
        ok: true,
        payload: { agentList: ['codex'], agents },
      })),
      update,
      failureMessage: 'Refresh failed',
    })
    expect(update).toHaveBeenCalledWith('test-mac', ['codex'], agents)
  })

  it('keeps the existing list on a rejected or malformed refresh', async () => {
    const update = vi.fn()
    for (const frame of [
      { type: 'res' as const, id: 'r1', ok: false, error: 'Offline' },
      { type: 'res' as const, id: 'r2', ok: true, payload: { agentList: ['codex'] } },
    ]) {
      await expect(
        refreshProjectAgents({
          machineId: 'test-mac',
          request: async () => frame,
          update,
          failureMessage: 'Refresh failed',
        }),
      ).rejects.toThrow(frame.ok ? 'Refresh failed' : 'Offline')
    }
    expect(update).not.toHaveBeenCalled()
  })
})

describe('project launch entry copy', () => {
  it('places machine connectivity after the complete machine and project title', () => {
    expect(formatProjectHeaderTitle('Mac', 'shennian', '正在重连…')).toBe(
      'Mac · shennian（正在重连…）',
    )
    expect(formatProjectHeaderTitle('Mac', 'shennian', '已离线')).toBe('Mac · shennian（已离线）')
    expect(formatProjectHeaderTitle('Mac', 'shennian', null)).toBe('Mac · shennian')
  })

  it('keeps the project launch plus button understandable across desktop and mobile', () => {
    const sidebar = readSource('../features/desktop-shell/DesktopSidebar.tsx')
    const headers = readSource('../features/desktop-shell/DesktopSidebarTreeHeaders.tsx')
    const machinePickerCard = readSource('../features/machines/components/MachinePickerCard.tsx')
    const projectScreen = readSource('../features/projects/screens/ProjectScreen.tsx')
    const mobileHome = readSource('../../app/(main)/index.tsx')
    const projectLaunchSheet = readSource('../components/sheets/ProjectLaunchSheet.tsx')
    const chatScreen = readSource('../features/chat/screens/ChatScreen.tsx')

    expect(headers).toContain("accessibilityLabel={t('start_new_chat')}")
    expect(headers).toContain('onToggleExpanded()')
    expect(sidebar).not.toContain("pathname: '/(main)/project'")
    expect(sidebar).toContain('machineId: project.machineId')
    expect(sidebar).toContain('workDir: project.workDir')
    expect(projectLaunchSheet).toContain('context.machineId')
    expect(projectLaunchSheet).toContain('initialWorkDir: context?.workDir')
    expect(projectLaunchSheet).not.toContain('reasoningEffort')
    expect(chatScreen).not.toContain('handleAgentSelect')
    expect(chatScreen).not.toContain('<AgentBadge')
    expect(headers).toContain('showLaunchTooltip')
    expect(headers).toContain('onHoverIn={() => setLaunchHovered(true)}')
    expect(headers).toContain('onFocus={() => setLaunchFocused(true)}')
    expect(headers).toContain("accessibilityHint={t('start_new_chat_hint')}")
    expect(headers).not.toContain('showLaunchLabel')
    expect(headers).not.toContain('projectLaunchBtnExpanded')
    expect(machinePickerCard).toContain(
      'resolveProjectDirectory(machine.id, finalDir, accountRuntime)',
    )
    expect(machinePickerCard).toContain(
      'machineAccountClient.createProject(machine.id, resolvedDir)',
    )
    expect(machinePickerCard).not.toContain('authApi')
    expect(machinePickerCard).not.toContain('<AgentBadge')
    expect(machinePickerCard).not.toContain('<ModelSelectorSheet')

    expect(mobileHome).toContain("label={t('start_new_project')}")
    expect(mobileHome).toContain("accessibilityHint={t('start_new_project_hint')}")
    expect(mobileHome).not.toContain('iconSize={21}')
    expect(mobileHome).toContain(
      "machines.length === 0 ? 'first_machine_setup_title' : 'start_new_project'",
    )
    expect(projectScreen).toContain(
      "onLongPress={() => Alert.alert(t('start_new_chat'), t('start_new_chat_hint'))}",
    )
    expect(projectScreen).not.toContain('isDesktopControlSurfaceEnabled')
    expect(projectScreen).toContain('visible={projectActionsOpen}')
    expect(projectScreen).toContain("projectSessionSurfaceState === 'forbidden' ? (")
    expect(projectScreen).not.toContain("accessibilityLabel={t('voice_chief_call_project')}")
    expect(projectScreen).not.toContain('call-outline')
    expect(projectScreen).toContain("label={t('start_new_chat')}")
    expect(projectScreen).toContain('<HeaderIconButton')
    expect(projectScreen).toContain('icon="close"')
    expect(projectScreen).not.toContain("{t('project_actions')}")
    expect(projectScreen).not.toContain('styles.inlineLaunchTitle')
    expect(projectScreen).toContain('<ActionIconButton icon="add"')
    expect(projectScreen).toContain('onPress={openNewChat}')
    expect(projectScreen).not.toContain('openProjectMenu')
    expect(projectScreen).not.toContain('setProjectCoordination')
    const launchSheet = projectScreen.slice(projectScreen.indexOf('testID="project-launch-scroll"'))
    expect(launchSheet).toContain('testID="project-launch-coordination-toggle"')
    expect(launchSheet).toContain('disabled={coordinationUnavailable}')
    expect(launchSheet).toContain('value={Boolean(coordination.state?.enabled)}')
    expect(launchSheet).toContain('onValueChange={changeCoordination}')
    const uploadMenu = readSource('../features/steward/useDirectoryUploadMenu.ts')
    expect(uploadMenu).not.toContain('project-coordination')
    expect(projectScreen).toContain("command: 'configure', patch: { enabled }")

    expect(projectScreen).toContain('color={showLaunchLabel ? colors.brand : colors.text}')
    expect(projectScreen).toContain('<ActionIcon')
    expect(projectScreen).toContain("label={t('start_new_chat')}")
    expect(projectScreen).not.toContain("accessibilityLabel={t('web_share_publish_project')}")
    expect(projectScreen).toContain('await saveProjectDefaults(project,')
    expect(projectScreen).toContain("t('project_default_config')")
    expect(projectScreen).not.toContain("t('project_default_current')")
    expect(projectScreen).toContain("t('project_default_unset')")
    expect(projectScreen).toContain('defaultConfigLabel')
    expect(projectScreen).toContain('testID="project-set-default-button"')
    expect(projectScreen).not.toContain('information-circle-outline')
    expect(projectScreen).toContain('styles.projectDefaultTitleButton')
    expect(projectScreen).toContain('defaultHelpExpanded ? (')
    expect(projectScreen).toContain('accessibilityState={{ expanded: defaultHelpExpanded }}')
    expect(projectScreen).toContain(
      "t(matchesDefault ? 'project_default_saved' : 'project_set_default')",
    )
    expect(projectScreen).toContain('ProjectInlineLaunchPanel')
    expect(projectScreen).toContain('testID="project-inline-launch-panel"')
    expect(projectScreen).toContain('useMachineLaunchState({')
    expect(projectScreen).toContain('styles.secondaryAction')
    expect(projectScreen).not.toContain('styles.primaryAction')
    expect(projectScreen).toContain("const showRemoveProjectAction = Platform.OS === 'web'")
    expect(projectScreen).toContain("{showRemoveProjectAction && machine?.role !== 'granted' ? (")
    expect(projectScreen).toContain("accessibilityLabel={t('remove_project')}")
    expect(projectScreen).toContain("t('remove_project_confirm')")
    expect(projectScreen).toContain('await accountRuntime.loadProjectSessions(project.id')
    expect(projectScreen).toContain('onEndReached={handleProjectEndReached}')
    expect(projectScreen).not.toContain('testID="project-machine-status"')
    expect(projectScreen).toContain("machinePresentation === 'reconnecting'")
    expect(mobileHome).toContain('machineOnline={')
    expect(mobileHome).toContain('relayPhase={relayConnectivity?.phase ?? null}')
    expect(projectScreen).toContain('onScrollBeginDrag={handleProjectScrollBegin}')
    expect(mobileHome).toContain('onRemove=')
    expect(machinePickerCard).toContain("accessibilityLabel={t('start_new_project')}")
  })

  it('keeps the legacy bulk conversation cleanup out of the project list', () => {
    const projectScreen = readSource('../features/projects/screens/ProjectScreen.tsx')
    const zh = readI18nSource('../../../../open-source/packages/shared/src/i18n/zh.ts')
    const en = readI18nSource('../../../../open-source/packages/shared/src/i18n/en.ts')

    expect(projectScreen).not.toContain('project_prune_')
    expect(projectScreen).not.toContain('pruneOldestProjectSessions')
    expect(projectScreen).not.toContain('projectSessions.length > 30')
    expect(zh).not.toContain('project_prune_')
    expect(en).not.toContain('project_prune_')
  })

  it('renders desktop launch tooltips from the sidebar overlay layer', () => {
    const sidebar = readSource('../features/desktop-shell/DesktopSidebar.tsx')
    const headers = readSource('../features/desktop-shell/DesktopSidebarTreeHeaders.tsx')

    expect(sidebar).toContain('tooltipPortalOverlay')
    expect(sidebar).toContain('setProjectLaunchTooltipPos(position)')
    expect(headers).toContain('onShowLaunchTooltip({')
    expect(headers).toContain('right: Math.max(PROJECT_TOOLTIP_EDGE_GAP, width - px - buttonWidth)')
    const sidebarStyles = readSource('../features/desktop-shell/desktopSidebarStyles.ts')
    expect(sidebarStyles).toContain("overflow: 'visible'")
    expect(sidebarStyles).toContain('zIndex: 1000')
    expect(sidebarStyles).toContain('elevation: 1000')
    expect(sidebar).toContain('projectLaunchTooltipPos ? (')
    expect(sidebar).toContain('testID="sidebar-projects-section"')
  })

  it('keeps project launch copy bilingual', () => {
    const zh = readI18nSource('../../../../open-source/packages/shared/src/i18n/zh.ts')
    const en = readI18nSource('../../../../open-source/packages/shared/src/i18n/en.ts')

    expect(zh).toContain("start_new_project: '创建项目'")
    expect(en).toContain("start_new_project: 'Create project'")
    expect(zh).toContain("machine_picker_title: '创建项目'")
    expect(en).toContain("machine_picker_title: 'Create project'")
    expect(zh).toContain("start_new_chat: '开启新对话'")
    expect(en).toContain("start_new_chat: 'Start new chat'")
    expect(zh).toContain("project_actions: '项目操作'")
    expect(en).toContain("project_actions: 'Project actions'")
    expect(zh).toContain("project_default_config: '项目默认配置'")
    expect(en).toContain("project_default_config: 'Project defaults'")
    expect(zh).toContain("project_default_current: '当前默认'")
    expect(en).toContain("project_default_current: 'Current'")
    expect(zh).toContain("project_default_unset: '尚未设置'")
    expect(en).toContain("project_default_unset: 'Not set'")
    expect(zh).toContain("project_set_default: '设为项目默认'")
    expect(en).toContain("project_set_default: 'Set as project default'")
    expect(zh).toContain("project_default_help_show: '查看项目默认配置说明'")
    expect(en).toContain("project_default_help_show: 'Show project default details'")
    expect(zh).not.toContain('web_share_publish_project')
    expect(en).not.toContain('web_share_publish_project')
    expect(zh).toContain('start_new_project_hint')
    expect(en).toContain('start_new_project_hint')
    expect(zh).toContain('选择机器和目录创建项目')
    expect(en).toContain('Choose a machine and directory')
    expect(zh).toContain('start_new_chat_hint')
    expect(en).toContain('start_new_chat_hint')
    expect(zh).toContain("remove_project: '删除项目'")
    expect(en).toContain("remove_project: 'Delete project'")
    expect(zh).toContain('确定删除这个项目及其全部对话吗？')
    expect(en).toContain('Delete this project and all its conversations?')
  })

  it('removes the obsolete project/global mode switch from navigation settings', () => {
    const sidebar = readSource('../features/desktop-shell/DesktopSidebar.tsx')
    const profileScreen = readSource('../features/profile/ProfileScreen.tsx')

    expect(sidebar).not.toContain('HOME_VIEW_MODE_OPTIONS')
    expect(sidebar).not.toContain('setHomeViewMode(')
    expect(sidebar).not.toContain('home-view-mode-')
    expect(profileScreen).not.toContain("t('home_view_mode')")
    expect(profileScreen).not.toContain('setHomeViewMode(')
  })
})
