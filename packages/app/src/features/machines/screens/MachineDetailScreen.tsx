import { MachineFolderEntry } from '../../remote-folders/MachineFolderEntry'
// @arch docs/features/free-growth-phase.md
// @test src/__tests__/machine-avatar.test.ts
// @arch docs/features/desktop-machine-access-boundary.md
// @arch docs/features/desktop-daemon-pause-lifecycle.md
// @arch docs/features/platform-security-boundary.md#p0-c机器暂停使用协议与-app-交互
// @test src/__tests__/machine-detail-source.test.ts

import { useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  ActionSheetIOS,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { useMachinesStore } from '@shennian/shared'
import type { Machine } from '@shennian/wire'
import { accountRuntime } from '../../account-runtime/accountRuntime'
import { AppPageHeader, HeaderIconButton } from '../../../components/AppPageHeader'
import { useGoBack } from '../../../hooks/useGoBack'
import { useTheme } from '../../../hooks/useTheme'
import { mobileTypography } from '../../../theme/mobileTypography'
import { UpgradeModal } from '../components/UpgradeModal'
import { MachineUpdateRow } from '../components/MachineUpdateRow'
import { useMachineCardActions } from '../hooks/useMachineCardActions'
import { getMachineOsLabel, isMachineCliVersionBlocked, MIN_RELAY_UPLOAD_CLI_VERSION } from '../utils/launch'
import { getAgentStatusKind, groupInstalledAgents } from '../utils/acp-agent-presentation'
import { MachineAvatar } from '../components/MachineAvatar'
import {
  canPauseMachineRemoteAccess,
  isRemoteAccessPauseUnsupported,
  parseRemoteAccessPauseAcknowledgement,
} from '../utils/remote-access-pause'
import { machineAccountClient } from '../machineAccountClient'

export default function MachineDetailScreen() {
  const { machineId } = useLocalSearchParams<{ machineId: string }>()
  const { t } = useTranslation()
  const goBack = useGoBack()
  const router = useRouter()
  const { colors } = useTheme()
  const { fontScale } = useWindowDimensions()
  const usesAccessibilityTextLayout = fontScale >= 1.6
  const machines = useMachinesStore((store) => store.machines)
  const setMachines = useMachinesStore((store) => store.setMachines)
  const [refreshing, setRefreshing] = useState(false)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [upgradePolicyPending, setUpgradePolicyPending] = useState(false)
  const [upgradePolicyError, setUpgradePolicyError] = useState('')
  const [pausePending, setPausePending] = useState(false)
  const [pauseError, setPauseError] = useState('')

  const machine = machines.find((item) => item.id === machineId)
  const actionMachine =
    machine ??
    ({
      id: '',
      name: '',
      os: '',
      agentList: [],
      paired: false,
      online: false,
      lastSeen: '',
    } as Machine)
  const actions = useMachineCardActions(actionMachine, t)
  const groupedAgents = useMemo(() => groupInstalledAgents(machine), [machine])
  const installedAgents = groupedAgents.all
  const installedAgentCount = installedAgents.length
  const attentionAgentCount = installedAgents.filter(({ info }) => {
    const status = getAgentStatusKind(Boolean(machine?.online), info)
    return status === 'auth_required' || status === 'version_mismatch' || status === 'auth_error'
  }).length
  const agentSummary = !installedAgentCount
    ? t('machine_agent_none_installed')
    : !machine?.online
      ? t('machine_agents_summary_offline', { count: installedAgentCount })
      : attentionAgentCount
        ? t('machine_agents_summary_attention', {
            count: installedAgentCount,
            attentionCount: attentionAgentCount,
          })
        : t('machine_agents_summary', { count: installedAgentCount })
  const cliVersionBlocked = isMachineCliVersionBlocked(machine?.cliVersion)
  const remoteAccessPaused = Boolean(machine?.remoteAccessDisabledAt)
  const canPauseRemoteAccess = Boolean(machine && canPauseMachineRemoteAccess(machine))
  const canOpenUpgrade = Boolean(machine?.online && actions.isOwner)

  const handleAutoUpgradeChange = useCallback(
    async (enabled: boolean) => {
      if (!machine?.online || !actions.isOwner || upgradePolicyPending) return
      const policy = enabled ? 'patch' : 'none'
      setUpgradePolicyPending(true)
      setUpgradePolicyError('')
      try {
        const response = await accountRuntime.requestMachine(
          machine.id,
          'upgrade.set-policy',
          { policy },
          { connectTimeoutMs: 15_000, responseTimeoutMs: 30_000 },
        )
        if (!response.ok) throw new Error(response.error ?? t('machine_auto_upgrade_failed'))
        useMachinesStore
          .getState()
          .updateMachineStatus(
            machine.id,
            machine.online,
            machine.region,
            machine.cliVersion,
            policy,
          )
      } catch (error) {
        setUpgradePolicyError(error instanceof Error ? error.message : String(error))
      } finally {
        setUpgradePolicyPending(false)
      }
    },
    [actions.isOwner, machine, t, upgradePolicyPending],
  )

  const fetchMachines = useCallback(async () => {
    const nextMachines = await machineAccountClient.listMachines().catch(() => null)
    if (nextMachines) setMachines(nextMachines)
  }, [setMachines])

  const handlePauseRemoteAccess = useCallback(async () => {
    if (!machine || !canPauseRemoteAccess || pausePending) return
    setPausePending(true)
    setPauseError('')
    try {
      const response = await accountRuntime.requestMachine(
        machine.id,
        'machine.remote-access.pause',
        {},
        { connectTimeoutMs: 15_000, responseTimeoutMs: 45_000 },
      )
      if (!response.ok) throw new Error(response.error ?? t('machine_pause_failed'))
      const remoteAccessDisabledAt = parseRemoteAccessPauseAcknowledgement(response.payload)
      if (!remoteAccessDisabledAt) throw new Error(t('machine_pause_failed'))
      useMachinesStore
        .getState()
        .updateMachineStatus(
          machine.id,
          false,
          undefined,
          machine.cliVersion,
          machine.autoUpgrade === 'patch' ? 'patch' : 'none',
          { remoteAccessDisabledAt },
        )
      await fetchMachines()
    } catch (error) {
      setPauseError(
        isRemoteAccessPauseUnsupported(error)
          ? t('machine_pause_upgrade_required')
          : error instanceof Error
            ? error.message
            : t('machine_pause_failed'),
      )
    } finally {
      setPausePending(false)
    }
  }, [canPauseRemoteAccess, fetchMachines, machine, pausePending, t])

  const showResumeInstructions = useCallback(() => {
    Alert.alert(t('machine_resume_instructions_title'), t('machine_resume_instructions_body'))
  }, [t])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await fetchMachines()
    } finally {
      setRefreshing(false)
    }
  }, [fetchMachines])

  const confirmUnbind = useCallback(() => {
    if (actions.unbinding) return
    Alert.alert(t('unbind_machine'), t('unbind_machine_owner_confirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('unbind_machine_action'),
        style: 'destructive',
        onPress: () => void actions.handleUnbindConfirm(),
      },
    ])
  }, [actions, t])

  const confirmPause = useCallback(() => {
    Alert.alert(t('machine_pause_confirm_title'), t('machine_pause_confirm_body'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('machine_pause_confirm_action'), style: 'destructive', onPress: () => void handlePauseRemoteAccess() },
    ])
  }, [handlePauseRemoteAccess, t])

  const showMoreActions = useCallback(() => {
    if (!actions.isOwner || pausePending || actions.unbinding) return
    const items = [
      ...(remoteAccessPaused
        ? [{ text: t('machine_resume_action'), onPress: showResumeInstructions }]
        : canPauseRemoteAccess ? [{ text: t('machine_pause_action'), onPress: confirmPause }] : []),
      { text: t('unbind_machine'), onPress: confirmUnbind },
    ]
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({
        title: machine?.name,
        options: [...items.map(item => item.text), t('cancel')],
        cancelButtonIndex: items.length,
        destructiveButtonIndex: items.length - 1,
      }, index => items[index]?.onPress())
    } else {
      Alert.alert(machine?.name ?? t('machine_more_actions'), undefined, [
        ...items.map(item => ({ ...item, style: item.text === t('unbind_machine') ? 'destructive' as const : 'default' as const })),
        { text: t('cancel'), style: 'cancel' },
      ])
    }
  }, [actions.isOwner, actions.unbinding, canPauseRemoteAccess, confirmPause, confirmUnbind, machine?.name, pausePending, remoteAccessPaused, showResumeInstructions, t])

  if (!machine) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.groupedBackground }]} edges={['top']}>
        <AppPageHeader title={t('machine_detail_title')} onBack={goBack} />
        <View style={styles.center}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            {t('machine_not_found')}
          </Text>
        </View>
      </SafeAreaView>
    )
  }



  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.groupedBackground }]} edges={['top']}>
      <AppPageHeader
        title={t('machine_detail_title')}
        onBack={goBack}
        backgroundColor={colors.groupedBackground}
        trailing={actions.isOwner ? <HeaderIconButton icon="ellipsis-horizontal" label={t('machine_more_actions')} onPress={showMoreActions} /> : null}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.brand}
          />
        }
      >
          <View
            style={[
              styles.hero,
            ]}
          >
            <View style={styles.heroTop}>
              <View style={styles.identity}>
                <MachineAvatar machine={machine} hero />
                {actions.editing ? (
                  <View style={styles.identityText}>
                    <View style={styles.nameEditRow}>
                      <TextInput
                        ref={actions.inputRef}
                        value={actions.nameInput}
                        onChangeText={actions.setNameInput}
                        placeholder={t('rename_machine_placeholder')}
                        placeholderTextColor={colors.textTertiary}
                        style={[
                          styles.nameInput,
                          {
                            color: colors.text,
                            borderColor: colors.border,
                            backgroundColor: colors.bg,
                          },
                        ]}
                        editable={!actions.saving}
                        onSubmitEditing={() => void actions.confirmRename()}
                        returnKeyType="done"
                        autoCorrect={false}
                      />
                      {actions.saving ? (
                        <ActivityIndicator size="small" color={colors.brand} />
                      ) : (
                        <>
                          <Pressable style={styles.iconOnlyBtn} onPress={actions.cancelEdit}>
                            <Ionicons name="close-outline" size={18} color={colors.textSecondary} />
                          </Pressable>
                          <Pressable
                            style={styles.iconOnlyBtn}
                            onPress={() => void actions.confirmRename()}
                          >
                            <Ionicons name="checkmark-outline" size={18} color={colors.brand} />
                          </Pressable>
                        </>
                      )}
                    </View>
                    <Text style={[styles.machineMeta, { color: colors.textSecondary }]} numberOfLines={1}>{getMachineOsLabel(machine.os)}</Text>
                  </View>
                ) : (
                  <View style={styles.identityText}>
                    <Pressable
                      style={styles.nameEditTarget}
                      onPress={actions.isOwner ? actions.startEdit : undefined}
                      disabled={!actions.isOwner}
                      accessibilityRole={actions.isOwner ? 'button' : undefined}
                      accessibilityLabel={actions.isOwner ? t('rename_machine') : undefined}
                    >
                      <View style={styles.nameRow}>
                        <Text
                          style={[styles.machineName, { color: colors.text }]}
                          numberOfLines={1}
                        >
                          {machine.name}
                        </Text>
                        {actions.isOwner ? (
                          <View
                            style={[styles.nameEditHint, { backgroundColor: colors.surfaceHover }]}
                          >
                            <Ionicons name="pencil-outline" size={12} color={colors.textTertiary} />
                          </View>
                        ) : null}
                      </View>
                    </Pressable>
                    <View style={styles.identityMeta}>
                      <Text style={[styles.machineMeta, { color: colors.textSecondary }]}>{getMachineOsLabel(machine.os)}</Text>
                      <View style={[styles.statusBadge, { backgroundColor: remoteAccessPaused ? colors.warning + '18' : machine.online ? colors.success + '18' : colors.surfaceHover }]}>
                        <View style={[styles.statusDot, { backgroundColor: remoteAccessPaused ? colors.warning : machine.online ? colors.success : colors.textTertiary }]} />
                        <Text style={[styles.statusText, { color: remoteAccessPaused ? colors.warningText : machine.online ? colors.success : colors.textSecondary }]}>
                          {remoteAccessPaused ? t('machine_paused') : machine.online ? t('machine_online') : t('machine_offline')}
                        </Text>
                      </View>
                    </View>
                    {!actions.isOwner ? (
                      <Text style={[styles.grantedAccessHint, { color: colors.textSecondary }]}>
                        {machine.ownerName
                          ? t('machine_shared_from', { name: machine.ownerName })
                          : t('machine_detail_granted_access_hint')}
                      </Text>
                    ) : null}
                  </View>
                )}
              </View>
            </View>
            {actions.renameError ? (
              <Text style={[styles.errorText, { color: colors.error }]}>{actions.renameError}</Text>
            ) : null}
          </View>


        {cliVersionBlocked && actions.isOwner ? (
          <View
            style={[
              styles.upgradeWarning,
              { backgroundColor: '#f59e0b0f', borderColor: '#f59e0b33' },
            ]}
          >
            <Ionicons name="warning-outline" size={18} color="#f59e0b" />
            <View style={styles.upgradeWarningBody}>
              <Text style={[styles.upgradeWarningTitle, { color: colors.text }]}>
                {t('machine_cli_blocked_title')}
              </Text>
              <Text style={[styles.upgradeWarningText, { color: colors.textSecondary }]}>
                {t('machine_cli_blocked_detail', {
                  version: machine.cliVersion ?? t('unknown'),
                  minVersion: MIN_RELAY_UPLOAD_CLI_VERSION,
                })}
              </Text>
            </View>
            <Pressable
              style={[
                styles.upgradeWarningBtn,
                { backgroundColor: colors.bg, borderColor: colors.border },
              ]}
              onPress={() => setUpgradeOpen(true)}
            >
              <Text style={[styles.upgradeWarningBtnText, { color: colors.text }]}>
                {t('machine_cli_upgrade_action')}
              </Text>
            </Pressable>
          </View>
        ) : null}

        <Text style={[styles.groupLabel, { color: colors.textSecondary }]}>{t('machine_detail_connection_section')}</Text>
        <View
          style={[
            styles.section,
            { backgroundColor: colors.groupedSurface, borderColor: colors.groupedSeparator },
          ]}
        >
          <Pressable
            accessibilityRole={canOpenUpgrade ? 'button' : undefined}
            accessibilityLabel={canOpenUpgrade
              ? `${t('machine_connector_version_title')}, ${machine.cliVersion ?? t('machine_version_unknown')}`
              : undefined}
            disabled={!canOpenUpgrade}
            onPress={() => setUpgradeOpen(true)}
            style={[
              styles.clientVersionRow,
              usesAccessibilityTextLayout && styles.clientVersionRowLargeText,
            ]}
          >
            <View
              style={[
                styles.clientVersionInfo,
                usesAccessibilityTextLayout && styles.clientVersionInfoLargeText,
              ]}
            >
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {t('machine_connector_version_title')}
              </Text>
              <Text
                style={[
                  styles.clientVersionText,
                  { color: cliVersionBlocked ? colors.warningText : colors.textSecondary },
                ]}
              >
                {machine.cliVersion
                  ? t('machine_version_badge', { version: machine.cliVersion })
                  : t('machine_version_unknown')}
                {cliVersionBlocked ? ` · ${t('machine_cli_upgrade_required_short')}` : ''}
              </Text>
            </View>
            {canOpenUpgrade ? <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} /> : null}
          </Pressable>
          {actions.isOwner ? (
            <View style={[styles.autoUpdateControl, { borderTopColor: colors.border }]}>
              <Text style={[styles.autoUpdateLabel, { color: colors.text }]}>
                {t('machine_auto_upgrade_title')}
              </Text>
              {upgradePolicyPending ? (
                <ActivityIndicator size="small" color={colors.brand} />
              ) : (
                <Switch
                  value={machine.autoUpgrade === 'patch'}
                  onValueChange={(value) => void handleAutoUpgradeChange(value)}
                  disabled={!machine.online}
                  trackColor={{ false: colors.border, true: colors.success }}
                  thumbColor="#FFFFFF"
                />
              )}
            </View>
          ) : null}
          {upgradePolicyError ? (
            <Text style={[styles.errorText, { color: colors.error }]}>{upgradePolicyError}</Text>
          ) : null}
          <MachineUpdateRow machine={machine} colors={colors} isOwner={actions.isOwner} />
        </View>

        <Text style={[styles.groupLabel, { color: colors.textSecondary }]}>{t('machine_detail_tools_section')}</Text>
        <View style={[styles.toolsSection, { backgroundColor: colors.groupedSurface }]}>
          <View style={{ paddingHorizontal: 16 }}><MachineFolderEntry machine={machine} compact /></View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t('machine_detail_agents')} ${agentSummary}`}
            onPress={() =>
              router.navigate({
                pathname: '/(main)/machine-agents',
                params: { machineId: machine.id },
              })
            }
            style={[styles.shareEntry, styles.agentEntry, { borderColor: colors.groupedSeparator, borderTopWidth: actions.isOwner ? StyleSheet.hairlineWidth : 0 }]}
          >
            <View style={styles.shareEntryBody}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {t('machine_detail_agents')}
              </Text>
              <Text style={[styles.shareEntrySummary, { color: colors.textSecondary }]}>{agentSummary}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </Pressable>
        </View>

        {actions.isOwner ? (
          <>
          <Text style={[styles.groupLabel, { color: colors.textSecondary }]}>{t('machine_detail_sharing_section')}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('machine_share_page_title')}
            onPress={() =>
              router.navigate({
                pathname: '/(main)/machine-sharing',
                params: { machineId: machine.id },
              })
            }
            style={[
              styles.shareEntry,
              { backgroundColor: colors.groupedSurface, borderColor: colors.groupedSeparator },
            ]}
          >
            <View style={styles.shareEntryBody}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {t('machine_detail_sharing_entry')}
              </Text>
              <Text
                style={[styles.shareEntrySummary, { color: colors.textSecondary }]}
                numberOfLines={2}
              >
                {machine.sharedCount
                  ? t('machine_share_summary_people', {
                      names: (machine.sharedWith ?? []).slice(0, 2).join('、'),
                      count: machine.sharedCount,
                    })
                  : t('machine_share_summary_private')}
                {machine.pendingShareCount
                  ? ` · ${t('machine_share_summary_pending', { count: machine.pendingShareCount })}`
                  : ''}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </Pressable>
          <Text style={[styles.shareHint, { color: colors.textSecondary }]}>{t('machine_detail_sharing_hint')}</Text>
          </>
        ) : null}


        {remoteAccessPaused ? (
          <View style={[styles.pausedBlock, { backgroundColor: colors.groupedSurface, borderColor: colors.groupedSeparator }]}>
            <Text style={[styles.pauseHelpText, { color: colors.textSecondary }]}>{t('machine_pause_terminal_resume')}</Text>
            {actions.isOwner ? <Pressable accessibilityRole="button" style={styles.resumeButton} onPress={showResumeInstructions}>
              <Text style={[styles.resumeButtonText, { color: colors.brand }]}>{t('machine_resume_action')}</Text>
            </Pressable> : null}
          </View>
        ) : null}
        {pausePending || actions.unbinding ? <ActivityIndicator color={colors.brand} /> : null}
        {pauseError || actions.unbindError ? <Text accessibilityRole="alert" style={[styles.errorText, { color: colors.error }]}>{pauseError || actions.unbindError}</Text> : null}

      </ScrollView>

      {upgradeOpen && actions.isOwner ? (
        <UpgradeModal machine={machine} onClose={() => setUpgradeOpen(false)} />
      ) : null}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40, gap: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { fontSize: 14 },
  hero: { paddingHorizontal: 4, paddingVertical: 12, gap: 8 },
  statusBadge: { borderRadius: 99, paddingHorizontal: 7, paddingVertical: 2, flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusText: { fontSize: 12, fontWeight: '600' },
  groupLabel: { fontSize: 13, fontWeight: '600', marginTop: 15, marginBottom: 2, marginHorizontal: 8 },
  shareHint: { fontSize: 12, lineHeight: 18, marginHorizontal: 10, marginTop: 3 },
  shareEntry: {
    minHeight: 64,
    borderWidth: 0,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  toolsSection: { borderRadius: 12, overflow: 'hidden' },
  agentEntry: { borderRadius: 0, borderTopWidth: StyleSheet.hairlineWidth, marginHorizontal: 16, paddingHorizontal: 0 },
  shareEntryBody: { flex: 1, minWidth: 0 },
  shareEntrySummary: { marginTop: 4, fontSize: 13, lineHeight: 18, ...(Platform.OS !== 'web' && mobileTypography.secondary) },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  identity: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0, gap: 12 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  identityText: { flex: 1, minWidth: 0 },
  machineName: { fontSize: 22, lineHeight: 28, fontWeight: '600', flexShrink: 1 },
  identityMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  machineMeta: { fontSize: 13, ...(Platform.OS !== 'web' && mobileTypography.metadata) },
  grantedAccessHint: { marginTop: 5, fontSize: 12, lineHeight: 17 },
  nameEditTarget: { alignSelf: 'flex-start', maxWidth: '100%', minHeight: 44, justifyContent: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7, minWidth: 0, flexWrap: 'wrap' },
  nameEditRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  nameInput: {
    flex: 1,
    minWidth: 120,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 16,
    fontWeight: '700',
  },
  iconOnlyBtn: {
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameEditHint: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 1,
    flexShrink: 0,
  },
  upgradeWarning: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  upgradeWarningBody: { flex: 1, minWidth: 0, gap: 3 },
  upgradeWarningTitle: { fontSize: 14, fontWeight: '800' },
  upgradeWarningText: { fontSize: 12, lineHeight: 18 },
  upgradeWarningBtn: {
    minHeight: 32,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upgradeWarningBtnText: { fontSize: 12, fontWeight: '800' },
  section: { borderRadius: 12, paddingHorizontal: 16, paddingVertical: 4, gap: 0 },
  pausedBlock: { width: '100%', borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, padding: 12, gap: 5, alignItems: 'center' },
  pauseHelpText: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
  resumeButton: { minHeight: 48, justifyContent: 'center', alignItems: 'center' },
  resumeButtonText: { fontSize: 14, fontWeight: '700' },
  sectionTitle: { ...mobileTypography.body },
  clientVersionRow: { minHeight: 52, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 16 },
  clientVersionRowLargeText: { flexDirection: 'column', alignItems: 'stretch', gap: 12 },
  clientVersionInfo: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' as const },
  clientVersionInfoLargeText: { flexDirection: 'column', alignItems: 'flex-start', gap: 4 },
  clientVersionText: { fontSize: 13, lineHeight: 18, ...(Platform.OS !== 'web' && mobileTypography.metadata) },
  autoUpdateControl: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderTopWidth: StyleSheet.hairlineWidth, minHeight: 52, paddingVertical: 8 },
  autoUpdateLabel: { ...mobileTypography.body },
  errorText: { fontSize: 12, lineHeight: 18 },
})
