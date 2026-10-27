import { DesktopSwitch } from '../desktop-shell/DesktopSwitch'
// @arch docs/design/desktop/unified-desktop-control.md
// @arch docs/features/desktop-machine-access-boundary.md
// @test ../../__tests__/desktop-machine-detail.test.ts
import { useEffect, useRef, useState } from 'react'
import { ScrollView, Text, TextInput, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import type { Machine } from '@shennian/wire'
import { useProjectsStore } from '@shennian/shared'
import { useAuthStore } from '../../config/auth'
import { useTheme } from '../../hooks/useTheme'
import { useMachinePresentationState } from '../../hooks/useMachinePresentationState'
import { useRelayConnectivitySnapshot } from '../../hooks/useAppConnectivityStatus'
import { useDesktopControlState } from '../desktop-control/hooks/useDesktopControlState'
import { DesktopMachineUpgradeDialog } from './DesktopMachineUpgradeDialog'
import { DesktopMachineVersion } from './DesktopMachineVersion'
import { isMachineOwner } from '../machines/utils/machineAccessPolicy'
import { canPauseMachineRemoteAccess } from '../machines/utils/remote-access-pause'
import { isMachineCliVersionBlocked, MIN_RELAY_UPLOAD_CLI_VERSION } from '../machines/utils/launch'
import {
  DesktopMachineDetailHeader,
  DesktopMachineMetadata,
  DesktopMachineDetailSkeleton,
  DesktopMachineDetailStatePanel,
  desktopMachineDetailStyles,
} from './DesktopMachineDetailLayout'
import { resolveDesktopMachineDetailSurface } from './desktopMachineDetailState'
import { resolveDesktopMachineUpdateOwner } from './desktopMachinePresentation'
import { useDesktopMachineDetailModel } from './useDesktopMachineDetailModel'
import { DesktopLocalMachineServiceSection } from './DesktopLocalMachineServiceSection'
import { DesktopMachineAction } from './DesktopMachineAction'
import { DesktopMachineResourcesSection } from './DesktopMachineResourcesSection'
import { DesktopMachineListState } from './DesktopMachineListState'
import { useDesktopMachineUpgrade } from './useDesktopMachineUpgrade'
import { DesktopDialog } from '../desktop-shell/DesktopDialog'
import { desktopTypography } from '../desktop-shell/desktopDesignTokens'

export default function DesktopMachineDetailScreen() {
  const { machineId = '', returnFocus } = useLocalSearchParams<{ machineId: string; returnFocus?: string }>()
  const accountId = useAuthStore(state => state.user?.id)
  return <DesktopMachineDetail key={`${accountId}:${machineId}`} machineId={machineId} returnFocus={returnFocus} />
}
export function DesktopMachineDetail({ machineId, returnFocus, onBack, onOpenSharing, onOpenTools, embedded = false }: { machineId: string; returnFocus?: string; onBack?: () => void; onOpenSharing?: () => void; onOpenTools?: () => void; embedded?: boolean }) {
  const { t } = useTranslation(); const { colors } = useTheme()
  const router = useRouter()
  const model = useDesktopMachineDetailModel(machineId)
  const { machine: projectedMachine, pending, error, surface } = model
  const detailSurface = resolveDesktopMachineDetailSurface(Boolean(projectedMachine), surface)
  const machine = detailSurface.kind === 'content' ? projectedMachine : undefined
  const desktop = useDesktopControlState()
  const projectRecords = useProjectsStore(state => state.projects)
  const projects = projectRecords.filter(project => project.machineId === machineId)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [confirming, setConfirming] = useState<'pause' | 'remove' | null>(null)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const renameButtonRef = useRef<View>(null)
  const renameInputRef = useRef<TextInput>(null)
  const confirmationCancelRef = useRef<View>(null)
  const sharingButtonRef = useRef<View>(null)
  const owner = isMachineOwner(machine)
  useEffect(() => {
    if (returnFocus !== 'sharing' || !machine || !owner) return
    const frame = requestAnimationFrame(() => {
      sharingButtonRef.current?.focus()
      router.setParams({ returnFocus: undefined })
    })
    return () => cancelAnimationFrame(frame)
  }, [returnFocus, machine?.id, owner, router])
  const local = owner && machine?.id === desktop.status?.machineId
  const updateOwner = resolveDesktopMachineUpdateOwner({ machineId, status: desktop.status, source: desktop.connectorSource })
  useEffect(() => { if (updateOwner !== 'cli') setUpgradeOpen(false) }, [updateOwner])
  const paused = Boolean(machine?.remoteAccessDisabledAt)
  const connectivity = useRelayConnectivitySnapshot()
  const presence = useMachinePresentationState(machine?.online ?? null, connectivity?.phase ?? null)
  const openMachineList = onBack ?? (() => router.replace({ pathname: '/(main)/profile', params: { category: 'machines' } }))
  const closeRenameEditor = () => { if (!pending) setEditing(false) }
  const Content = embedded ? View : ScrollView
  return <View style={{ flex: 1, backgroundColor: colors.bg }} testID="desktop-machine-detail">
    <DesktopMachineDetailHeader onBack={openMachineList} name={machine?.name ?? t('machine_detail_title')}
      renameLabel={t('rename_machine')} onRename={machine && owner ? () => { setName(machine.name); setEditing(true) } : undefined}
      renameButtonRef={renameButtonRef} />
    <Content {...(embedded ? { style: { paddingVertical: 16, gap: 16 } } : { contentContainerStyle: desktopMachineDetailStyles.content })}>
      {detailSurface.kind === 'loading' ? <DesktopMachineDetailSkeleton label={t('machines_loading')} /> : null}
      {detailSurface.kind === 'forbidden' || detailSurface.kind === 'missing' ? <DesktopMachineDetailStatePanel
        kind={detailSurface.kind}
        title={t(detailSurface.kind === 'forbidden' ? 'machines_permission_title' : 'machine_not_found')}
        body={t(detailSurface.kind === 'forbidden' ? 'machines_permission_body' : 'machine_not_found_body')}
        actionLabel={t('go_manage_machines')}
        onAction={openMachineList}
      /> : null}
      {detailSurface.kind === 'offline' || detailSurface.kind === 'error' ? <DesktopMachineListState
        state={detailSurface.kind}
        compact={false}
        onRetry={model.retry}
      /> : null}
      {detailSurface.kind === 'content' && detailSurface.notice ? <DesktopMachineListState
        state={detailSurface.notice}
        compact
        onRetry={model.retry}
      /> : null}
      {machine ? <>
        <DesktopMachineMetadata os={machine.os ?? ''}
          statusLabel={t(paused ? 'machine_paused' : presence === 'online' ? 'machine_online' : presence === 'offline' ? 'machine_offline' : presence === 'reconnecting' ? 'machine_reconnecting' : 'unknown')}
          statusColor={paused ? colors.warning : presence === 'online' ? colors.success : colors.textTertiary} />
        {local ? <DesktopLocalMachineServiceSection
          machineId={machine.id}
          serverOnline={presence === 'online' ? true : presence === 'offline' ? false : null}
        /> : null}
        {!owner ? <Text style={{ color: colors.textSecondary }}>{machine.ownerName ? t('machine_shared_from', { name: machine.ownerName }) : t('machine_detail_granted_access_hint')}</Text> : null}
        <View style={[desktopMachineDetailStyles.section, { borderColor: colors.border }]}>
          <Text style={[desktopMachineDetailStyles.sectionTitle, { color: colors.text }]}>{t('desktop_machine_client_version_title')}</Text>
          <DesktopMachineVersion machine={machine} colors={colors} />
          {owner ? <>
            {updateOwner === 'cli' ? <View style={desktopMachineDetailStyles.row}>
            <Text style={[desktopMachineDetailStyles.rowLabel, { color: colors.text }]}>{t('machine_auto_upgrade_title')}</Text>
            <DesktopSwitch accessibilityLabel={t('machine_auto_upgrade_title')} value={machine.autoUpgrade === 'patch'} disabled={!machine.online || pending}
              onValueChange={value => void model.run(() => model.commands.setAutoUpgrade(value))} />
            </View> : null}
            {isMachineCliVersionBlocked(machine.cliVersion) ? <Text style={{ color: colors.warning }}>{t('machine_cli_blocked_detail', { version: machine.cliVersion ?? t('unknown'), minVersion: MIN_RELAY_UPLOAD_CLI_VERSION })}</Text> : null}
            {updateOwner === 'desktop' ? <Text style={{ color: colors.textSecondary }}>{t('desktop_machine_update_with_desktop')}</Text>
              : updateOwner === 'cli' ? <View style={{ alignSelf: 'flex-start' }}><DesktopMachineAction label={t('machine_cli_upgrade_action')} onPress={() => setUpgradeOpen(true)} /></View>
              : <Text style={{ color: colors.textSecondary }}>{t('desktop_machine_update_owner_unknown')}</Text>}
          </> : null}
        </View>
        <DesktopMachineResourcesSection machine={machine} projects={projects} owner={owner}
          sharingButtonRef={sharingButtonRef}
          relayConnected={connectivity?.phase === 'connected'}
          machineOnline={presence === 'online'}
          onOpenTools={onOpenTools ?? (() => router.navigate({ pathname: '/(main)/machine-agents', params: { machineId } }))}
          onOpenProject={project => router.navigate({ pathname: '/(main)/project', params: { machineId: project.machineId, workDir: project.workDir } })}
          onOpenSharing={onOpenSharing ?? (() => router.navigate({ pathname: '/(main)/machine-sharing', params: { machineId } }))} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingTop: 8 }}>
          {paused ? <Text style={{ color: colors.textSecondary }}>{t(local ? 'desktop_local_resume_help' : 'machine_pause_terminal_resume')}</Text> : canPauseMachineRemoteAccess(machine) ?
            <DesktopMachineAction compact label={t('machine_pause_action')} disabled={pending} onPress={() => setConfirming('pause')} /> : null}
          {owner ? <DesktopMachineAction compact label={t('unbind_machine')} destructive disabled={pending} onPress={() => setConfirming('remove')} /> : null}
        </View>
      </> : null}
      {detailSurface.kind === 'content' && error ? <Text accessibilityRole="alert" style={{ color: colors.error }}>{error}</Text> : null}
    </Content>
    {editing && machine && owner ? <DesktopDialog
      title={`${t('rename_machine')} · ${machine.name}`}
      initialFocusRef={renameInputRef}
      busy={pending}
      onClose={closeRenameEditor}>
      <TextInput ref={renameInputRef} accessibilityLabel={t('rename_machine')} value={name} onChangeText={setName} editable={!pending}
        style={{ ...desktopTypography.body, minHeight: 36, color: colors.text, backgroundColor: colors.bg,
          borderColor: colors.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }} />
      {error ? <Text accessibilityRole="alert" style={[desktopTypography.body, { color: colors.errorText, marginTop: 8 }]}>{error}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <DesktopMachineAction compact label={t('cancel')} disabled={pending} onPress={closeRenameEditor} />
        <DesktopMachineAction compact primary label={t('confirm')} disabled={pending || !name.trim()}
          onPress={() => void model.run(() => model.commands.rename(name)).then(ok => { if (ok) setEditing(false) })} />
      </View>
    </DesktopDialog> : null}
    {confirming && machine && owner ? <DesktopDialog
      title={`${t(confirming === 'pause' ? 'machine_pause_action' : 'unbind_machine')} · ${machine.name}`}
      initialFocusRef={confirmationCancelRef}
      busy={pending}
      onClose={() => { if (!pending) setConfirming(null) }}>
      <Text style={[desktopTypography.body, { color: colors.textSecondary }]}>
        {confirming === 'pause' ? t('machine_pause_confirm_body') : t('unbind_machine_owner_confirm')}
      </Text>
      {error ? <Text accessibilityRole="alert" style={[desktopTypography.body, { color: colors.errorText, marginTop: 8 }]}>{error}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <DesktopMachineAction compact actionRef={confirmationCancelRef} label={t('cancel')} disabled={pending} onPress={() => setConfirming(null)} />
        <DesktopMachineAction compact label={t(confirming === 'pause' ? 'machine_pause_confirm_action' : 'unbind_machine_action')} destructive disabled={pending}
          onPress={() => void model.run(confirming === 'pause' ? model.commands.pause : model.commands.remove).then(ok => {
            if (!ok) return
            if (confirming === 'remove') openMachineList()
            setConfirming(null)
          })} />
      </View>
    </DesktopDialog> : null}
    {upgradeOpen && machine && owner && updateOwner === 'cli' ? <DesktopUpgrade machine={machine} onClose={() => setUpgradeOpen(false)} /> : null}
  </View>
}
function DesktopUpgrade({ machine, onClose }: { machine: Machine; onClose(): void }) {
  const model = useDesktopMachineUpgrade(machine)
  return <DesktopMachineUpgradeDialog machine={machine} onClose={onClose} model={model} />
}
