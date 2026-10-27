// @covers packages/app/src/features/machines/screens/MachineDetailScreen.tsx
// @covers packages/app/src/features/machines/screens/MachineAgentsScreen.tsx
// @covers packages/app/src/features/machines/screens/MachinesScreen.tsx
// @covers packages/app/src/features/machines/components/MachineCard.tsx
// @covers packages/app/src/features/machines/components/MachineNameRow.tsx

import { readI18nSource } from './i18n-source-test-helper'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, relativePath), 'utf8')
}

describe('machine detail information architecture', () => {
  it('does not treat Agent capabilities as machine-managed Shennian packages', () => {
    const source = readSource('../features/machines/screens/MachineDetailScreen.tsx')

    expect(source).not.toContain('type DetailTab')
    expect(source).not.toContain('<MachineSkillPanel')
    expect(source).not.toContain("method: 'skill.list'")
    expect(source).not.toContain('<MachineShareAccessPanel')
    expect(source).not.toContain('<MachineCard machine={machine} mode="manage" />')
    expect(source).not.toContain('<SummaryTile')
    expect(source).not.toContain('CollapsibleSection')
  })

  it('restores a summary-only machine sharing entry for owners', () => {
    const source = readSource('../features/machines/screens/MachineDetailScreen.tsx')

    expect(source).not.toContain('<MachineShareAccessPanel')
    expect(source).toContain("t('machine_detail_sharing_entry')")
    expect(source).toContain("pathname: '/(main)/machine-sharing'")
    expect(source).toContain('actions.isOwner ?')
    expect(source).not.toContain('/(main)/organizations?shareMachineId=')
  })

  it('keeps every machine-management action owner-only on granted details', () => {
    const detail = readSource('../features/machines/screens/MachineDetailScreen.tsx')
    const agents = readSource('../features/machines/screens/MachineAgentsScreen.tsx')

    expect(detail).toContain('cliVersionBlocked && actions.isOwner')
    expect(detail).toContain('if (!actions.isOwner || pausePending || actions.unbinding) return')
    expect(detail).toContain('upgradeOpen && actions.isOwner')
    expect(detail).toContain("t('machine_shared_from', { name: machine.ownerName })")
    const desktop = readSource('../features/desktop-machines/DesktopMachineDetailScreen.tsx')
    expect(desktop).toContain('const local = owner && machine?.id === desktop.status?.machineId')
    expect(detail).not.toContain('useDesktopControlState')

    expect(agents).toContain('const isOwner = isMachineOwner(machine)')
    expect(agents).toContain('{isOwner ? <MachineAgentHelp /> : null}')
    expect(agents).toContain('agent: trimmedAgentName')
    expect(agents).toContain('skillUrl: SHENNIAN_SKILL_URL')
    expect(agents).toContain('installUrl: SHENNIAN_AGENT_INSTALL_DOC_URL')
    expect(agents).toContain("t('machine_agents_tool_label')")
    expect(agents).toContain('{isOwner && selectedAcpAgent?.acpCapabilities?.listSessions ? (')
  })

  it('keeps machine detail compact and opens one dedicated Agent list', () => {
    const detail = readSource('../features/machines/screens/MachineDetailScreen.tsx')
    const agents = readSource('../features/machines/screens/MachineAgentsScreen.tsx')
    const route = readSource('../../app/(main)/machine-agents.tsx')

    expect(detail).toContain("pathname: '/(main)/machine-agents'")
    expect(detail).not.toContain("t('machine_agents_summary_acp'")
    expect(detail).toContain("t('machine_agents_summary_attention'")
    expect(detail).not.toContain("(['deep', 'acp'] as const).map")
    expect(detail).not.toContain("method: 'agent.external-sessions.list'")
    expect(detail.indexOf("t('machine_connector_version_title')")).toBeLessThan(
      detail.indexOf("t('machine_detail_agents')"),
    )
    expect(route).toContain('MachineAgentsScreen')

    expect(agents).toContain('groupInstalledAgents(machine)')
    expect(agents).toContain('return grouped.all')
    expect(agents).not.toContain("t('machine_agent_group_deep')")
    expect(agents).not.toContain("t('machine_agent_group_acp')")
    expect(agents).not.toContain("t('machine_agent_acp_badge')")
    expect(agents).not.toContain('styles.agentIcon')
    expect(agents).not.toContain("method: 'agent.config.upsert'")
    expect(agents).not.toContain('styles.installOptions')
    expect(agents).not.toContain("t('machine_agents_current_title')")
    expect(agents).not.toContain("t('machine_detail_available_agents')")
    expect(agents).toContain("t('machine_agent_installed')")
    expect(agents).toContain("t('machine_agent_detail_version',")
    expect(agents).not.toContain("t('acp_agent_detail_summary')")
    expect(agents).toContain("t('acp_capabilities_title')")
    expect(agents).toContain("t('acp_capability_history')")
    expect(agents).toContain("'agent.external-sessions.list'")
    expect(agents).toContain("'agent.external-sessions.import'")
    expect(agents).toContain('machineAccountClient.deleteSession(createdSessionId)')
    expect(agents).not.toContain('authApi')
    expect(agents).not.toContain('RefreshControl')
    expect(agents).not.toContain('refresh-outline')
    expect(agents).toContain("t('acp_external_takeover_action')}`}")
    expect(detail).toContain('fontScale >= 1.6')
    expect(detail).toContain('styles.clientVersionRowLargeText')
  })

  it('reduces Codex compatibility to one clear status', () => {
    const source = readSource('../features/machines/screens/MachineAgentsScreen.tsx')

    expect(source).toContain('getAgentStatusKind(machine.online, info)')
    expect(source).toContain("t('machine_agent_version_mismatch_badge')")
    expect(source).not.toContain("t('machine_agent_connected_version'")
    expect(source).not.toContain("t('machine_agent_codex_versions'")
    expect(source).not.toContain("t('machine_agent_codex_version_mismatch_detail')")
    expect(source).not.toContain('upgradeAgent')
    expect(source).not.toContain('agent.upgrade')
  })

  it('opens the desktop shell on the main control surface and keeps local status user-invoked', () => {
    const desktopEntry = readSource('../../app/desktop.tsx')
    const detail = readSource('../features/desktop-machines/DesktopMachineDetailScreen.tsx')
    const local = readSource('../features/desktop-machines/DesktopLocalMachineServiceSection.tsx')

    expect(desktopEntry).toContain("isAuthenticated ? '/(main)' : '/(auth)/login?desktop=1'")
    expect(desktopEntry).not.toContain('startup=1')
    expect(fs.existsSync(path.join(__dirname, '../../app/(main)/local-control.tsx'))).toBe(false)
    expect(
      fs.existsSync(
        path.join(__dirname, '../features/desktop-control/screens/DesktopControlScreen.tsx'),
      ),
    ).toBe(false)
    expect(
      fs.existsSync(
        path.join(__dirname, '../features/desktop-control/components/LocalControlRow.tsx'),
      ),
    ).toBe(false)
    expect(local).toContain("t('desktop_local_section_title')")
    expect(local).toContain("t('desktop_local_export_log')")
    expect(local).toContain("label={t('desktop_local_diagnostics')}")
    expect(detail).toContain("t('unbind_machine')")
    expect(detail.indexOf('<DesktopLocalMachineServiceSection')).toBeLessThan(
      detail.indexOf("t('unbind_machine')"),
    )
    expect(detail).not.toContain("t('machine_more_actions')")
  })

  it('restores the labeled machine detail and inline rename entry', () => {
    const detail = readSource('../features/machines/screens/MachineDetailScreen.tsx')

    expect(detail).toContain("title={t('machine_detail_title')}")
    expect(detail).toContain("accessibilityLabel={actions.isOwner ? t('rename_machine') : undefined}")
    expect(detail).toContain('onPress={actions.isOwner ? actions.startEdit : undefined}')
    expect(detail).toContain('numberOfLines={1}>{getMachineOsLabel(machine.os)}</Text>')
    expect(detail).toContain("t('machine_detail_connection_section')")
    expect(detail).toContain("t('machine_detail_sharing_section')")
    expect(detail).toContain('ActionSheetIOS.showActionSheetWithOptions')
    expect(detail).toContain("t('machine_detail_sharing_hint')")
    expect(detail).not.toContain('style={styles.identityText}\n                  onPress=')
    expect(detail).not.toContain("t('machine_skill_summary_count'")
  })

  it('shows standalone machine rows with platform icons, agent count and update hint', () => {
    const screen = readSource('../features/machines/screens/MachinesScreen.tsx')
    const card = readSource('../features/machines/components/MachineCard.tsx')
    const nameRow = readSource('../features/machines/components/MachineNameRow.tsx')
    const platform = readSource('../features/machines/utils/machinePlatformAppearance.ts')
    const styles = readSource('../features/machines/styles.ts')

    expect(screen).not.toContain('MachineGroup')
    expect(card).not.toContain('configTarget')
    expect(nameRow).toContain('if (compact && !actions.editing)')
    expect(nameRow).toContain('compactMachineMetadataRow')
    expect(nameRow).toContain("t('machine_agents_count_short'")
    expect(card).toContain('agentCount={showCompactManage ? installedAgentCount : undefined}')
    expect(nameRow).toContain('canUpgrade={!compact && actions.isOwner && machine.online}')
    expect(nameRow).toContain('<VersionBadge\n              machine={machine}')
    expect(readSource('../features/machines/components/VersionBadge.tsx')).toContain('event.stopPropagation()')
    expect(platform).toContain("'logo-apple'")
    expect(platform).toContain("'logo-windows'")
    expect(platform).toContain("'logo-tux'")
    expect(nameRow).toContain('<MachineAvatar machine={machine} />')
    expect(screen).toContain('last={index === machines.length - 1}')
    expect(styles).toContain('machineList: { gap: 0 }')
    expect(screen).not.toContain('machineSummary')
    expect(screen).not.toContain('machineListHint')
    expect(screen).toContain('<AppPageHeader')
  })

  it('keeps management in a native menu with separate destructive confirmations', () => {
    const detail = readSource('../features/machines/screens/MachineDetailScreen.tsx')
    expect(detail).toContain("t('machine_detail_connection_section')")
    expect(detail).toContain("t('machine_detail_tools_section')")
    expect(detail).toContain("t('machine_detail_sharing_section')")
    expect(detail).toContain('ActionSheetIOS.showActionSheetWithOptions')
    expect(detail).toContain('cancelButtonIndex: items.length')
    expect(detail).toContain('destructiveButtonIndex: items.length - 1')
    expect(detail).toContain('onPress: confirmPause')
    expect(detail).toContain('onPress: confirmUnbind')
    expect(detail).not.toContain('dangerFooter')
  })

  it('names runtime counts and the Shennian client without colliding with Smart Agents', () => {
    const zh = readI18nSource('../../../../open-source/packages/shared/src/i18n/zh.ts')

    expect(zh).toContain("machine_agents_count_short: '{{count}} 个 Agent'")
    expect(zh).toContain("machine_cli_update_available_short: '可更新'")
    expect(zh).toContain("machine_connector_version_title: 'Shennian CLI'")
    expect(zh).toContain("machine_auto_upgrade_title: '自动更新'")
    const en = readI18nSource('../../../../open-source/packages/shared/src/i18n/en.ts')
    expect(en).toContain("machine_pause_action: 'Pause remote access'")
  })

  it('offers an opt-in patch-only auto-upgrade switch', () => {
    const source = readSource('../features/machines/screens/MachineDetailScreen.tsx')
    expect(source).toContain("'upgrade.set-policy'")
    expect(source).toContain("const policy = enabled ? 'patch' : 'none'")
    expect(source).toContain("value={machine.autoUpgrade === 'patch'}")
    expect(source).toContain('{actions.isOwner ? (')
    expect(source).toContain('styles.autoUpdateControl,')
    expect(source).toContain('disabled={!machine.online}')
    expect(source).toContain("t('machine_connector_version_title')")
    expect(source).toContain("t('machine_auto_upgrade_title')")
    expect(source).toContain('styles.clientVersionRow')
    expect(source).toContain('trackColor={{ false: colors.border, true: colors.success }}')
    expect(source).toContain('thumbColor="#FFFFFF"')
    expect(source).not.toContain("true: colors.brand + '80'")
    expect(source).not.toContain("t('machine_auto_upgrade_desc')")
    expect(source).not.toContain("t('machine_auto_upgrade_offline')")
    expect(source.indexOf("t('machine_connector_version_title')")).toBeLessThan(
      source.indexOf("t('machine_auto_upgrade_title')"),
    )
  })

  it('surfaces an available update as a whole tappable row instead of a version tag', () => {
    const detail = readSource('../features/machines/screens/MachineDetailScreen.tsx')
    const row = readSource('../features/machines/components/MachineUpdateRow.tsx')
    const zh = readI18nSource('../../../../open-source/packages/shared/src/i18n/zh.ts')
    const en = readI18nSource('../../../../open-source/packages/shared/src/i18n/en.ts')

    expect(detail).not.toContain('<VersionBadge')
    expect(detail).toContain(
      '<MachineUpdateRow machine={machine} colors={colors} isOwner={actions.isOwner} />',
    )
    expect(detail.indexOf("t('machine_auto_upgrade_title')")).toBeLessThan(
      detail.indexOf('<MachineUpdateRow'),
    )
    expect(row).toContain('if (!hasUpdate || !latestVersion) return null')
    expect(row).toContain(
      "accessibilityLabel={t('machine_cli_update_to', { version: latestVersion })}",
    )
    expect(row).toContain('const canUpdate = isOwner && machine.online')
    expect(row).toContain('disabled={!canUpdate}')
    expect(row).toContain('name="chevron-forward"')
    expect(row).toContain("t('machine_cli_update_offline')")
    expect(row).toContain('if (!isOwner)')
    expect(row).toContain('minHeight: 44')
    expect(zh).toContain("machine_cli_update_found: '发现新版本 {{version}}'")
    expect(zh).toContain("machine_cli_update_action: '更新'")
    expect(en).toContain("machine_cli_update_to: 'Update to {{version}}'")
  })

  it('places pause before unbind and resumes only through the local Desktop bridge', () => {
    const source = readSource('../features/machines/screens/MachineDetailScreen.tsx')
    expect(source).toContain("'machine.remote-access.pause'")
    expect(source).toContain("t('machine_pause_confirm_body')")
    expect(source).toContain("t('machine_pause_terminal_resume')")
    const local = readSource('../features/desktop-machines/DesktopLocalMachineServiceSection.tsx')
    expect(local).toContain("'desktop_local_resume_access'")
    expect(local).toContain('desktop.status?.machineId !== machineId')
    // Bridge lifecycle behavior is exercised by desktop-machine-detail.test.ts.
    expect(source).not.toContain('desktop.bridge')
    expect(source.indexOf("t('machine_pause_action')")).toBeLessThan(
      source.indexOf("{ text: t('unbind_machine'), onPress: confirmUnbind }"),
    )
    expect(source).not.toContain('machine.remote-access.resume')
    expect(source).toContain('destructiveButtonIndex: items.length - 1')
    expect(source).toContain('onPress={showMoreActions}')
    expect(source).toContain('minHeight: 44')
  })

  it('uses the standard destructive confirmation dialog when removing a machine', () => {
    const source = readSource('../features/machines/screens/MachineDetailScreen.tsx')
    const zh = readI18nSource('../../../../open-source/packages/shared/src/i18n/zh-docs.ts')

    expect(source).toContain("Alert.alert(t('unbind_machine'), t('unbind_machine_owner_confirm')")
    expect(source).toContain("text: t('unbind_machine_action')")
    expect(source).toContain("style: 'destructive'")
    expect(source).not.toContain('styles.confirmBar')
    expect(source).not.toContain("t('unbind_machine_grant_confirm')")
    expect(zh).toContain('移除这台机器，也会将依赖它的智能体从相关群聊移出')
    expect(zh).toContain('智能体资料和群聊历史将保留，不会自动重新加群')
    expect(zh).not.toContain('相关智能体会保留在群聊中')
  })
})
