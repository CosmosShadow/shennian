// @arch docs/features/desktop-project-creation.md
// @test ../../__tests__/desktop-create-project-sheet.test.ts
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useSheetsStore } from '@shennian/shared'
import type { Machine } from '@shennian/wire'
import { DesktopDialog } from '../desktop-shell/DesktopDialog'
import { useAuthStore } from '../../config/auth'
import { useTheme } from '../../hooks/useTheme'
import { getLastLaunch } from '../../utils/launchStorage'
import { useRelayConnectivitySnapshot } from '../../hooks/useAppConnectivityStatus'
import { useMachinePresentationState } from '../../hooks/useMachinePresentationState'
import { createDesktopLaunchSheetLifetime } from '../desktop-launch/desktopLaunchSheetLifetime'
import { useDesktopMachineListModel } from '../desktop-machines/useDesktopMachineListModel'
import { DesktopMachineAction } from '../desktop-machines/DesktopMachineAction'
import { useDesktopControlState } from '../desktop-control/hooks/useDesktopControlState'
import { pickDesktopProjectDirectory } from '../desktop-control/desktopFileOperations'
import {
  desktopAccountActions,
  getDesktopAccountRuntimeState,
  subscribeDesktopAccountRuntimeState,
} from '../desktop-control/useDesktopAccountSync'
import { DesktopProjectCreationModel } from './desktopProjectCreationModel'
import { DesktopProjectDirectoryPicker } from './DesktopProjectDirectoryPicker'

export function DesktopCreateProjectSheet() {
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  const open = useSheetsStore((state) => state.machinePickerOpen)
  const lifetime = useMemo(
    () =>
      createDesktopLaunchSheetLifetime({
        account: () => useAuthStore.getState().user?.id ?? null,
        context: () =>
          useSheetsStore.getState().machinePickerOpen ? useSheetsStore.getState() : null,
        subscribeAccount: (listener) => useAuthStore.subscribe(listener),
        close: () => useSheetsStore.getState().closeMachinePicker(),
      }),
    [],
  )
  useEffect(() => lifetime.start(), [lifetime])
  if (!open || !accountId) return null
  return <CreateProjectContent key={accountId} accountId={accountId} />
}

function CreateProjectContent({ accountId }: { accountId: string }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const { machines, surface, retry } = useDesktopMachineListModel()
  const close = useSheetsStore((state) => state.closeMachinePicker)
  const [selectedMachineId, setSelectedMachineId] = useState('')
  const [busy, setBusy] = useState(false)
  const [nestedDialog, setNestedDialog] = useState(false)
  const selectedMachine =
    machines.find((machine) => machine.id === selectedMachineId) ?? machines[0]
  useEffect(() => {
    if (!selectedMachineId && machines[0]) setSelectedMachineId(machines[0].id)
    else if (selectedMachineId && !machines.some((machine) => machine.id === selectedMachineId)) {
      setSelectedMachineId(machines[0]?.id ?? '')
    }
  }, [machines, selectedMachineId])
  const add = () => {
    close()
    router.navigate('/(main)/machines?add=1' as never)
  }
  return (
    <DesktopDialog
      onClose={close}
      busy={busy}
      suspended={nestedDialog}
      title={t('machine_picker_title')}
    >
      <View testID="desktop-create-project-form" style={styles.content}>
        {surface === 'initial-loading' ? <ActivityIndicator color={colors.brand} /> : null}
        {surface === 'error' || surface === 'forbidden' || surface === 'offline' ? (
          <View
            style={[
              styles.availabilityBanner,
              { borderColor: colors.border, backgroundColor: colors.surface },
            ]}
          >
            <Ionicons name="cloud-offline-outline" size={18} color={colors.textSecondary} />
            <Text
              accessibilityRole="alert"
              style={[styles.availabilityText, { color: colors.textSecondary }]}
            >
              {t(
                surface === 'forbidden'
                  ? 'machines_permission_body'
                  : surface === 'offline'
                    ? 'machines_cached_offline_body'
                    : 'machines_cached_load_failed_body',
              )}
            </Text>
            <DesktopMachineAction
              compact
              label={t('retry')}
              onPress={() => {
                void retry()
              }}
            />
          </View>
        ) : null}
        {surface === 'empty' ? (
          <View style={styles.empty}>
            <Text style={{ color: colors.textSecondary }}>{t('no_machines')}</Text>
            <DesktopMachineAction compact label={t('add_machine')} onPress={add} />
          </View>
        ) : null}
        {selectedMachine ? (
          <MachineSelector
            machines={machines}
            selected={selectedMachine}
            disabled={busy}
            onSelect={setSelectedMachineId}
          />
        ) : null}
        {selectedMachine ? (
          <CreateProjectMachine
            key={selectedMachine.id}
            machine={selectedMachine}
            accountId={accountId}
            onBusyChange={setBusy}
            onNestedDialogChange={setNestedDialog}
            onClose={close}
          />
        ) : null}
      </View>
    </DesktopDialog>
  )
}

function CreateProjectMachine({
  machine,
  accountId,
  onBusyChange,
  onNestedDialogChange,
  onClose,
}: {
  machine: Machine
  accountId: string
  onBusyChange(busy: boolean): void
  onNestedDialogChange(open: boolean): void
  onClose(): void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const latest = useRef(machine)
  latest.current = machine
  const [browsing, setBrowsing] = useState(false)
  const [pickingLocalDirectory, setPickingLocalDirectory] = useState(false)
  const [directoryFocused, setDirectoryFocused] = useState(false)
  const workDirInputRef = useRef<TextInput>(null)
  const browseWasOpen = useRef(false)
  const scope = useMemo(() => ({ active: false }), [accountId, machine.id])
  const current = () => scope.active && useAuthStore.getState().user?.id === accountId
  const relay = useRelayConnectivitySnapshot()
  const desktop = useDesktopControlState()
  const runtime = useSyncExternalStore(
    subscribeDesktopAccountRuntimeState,
    getDesktopAccountRuntimeState,
    getDesktopAccountRuntimeState,
  )
  const ready =
    runtime.accountId === accountId && runtime.bootstrapped && runtime.status?.phase === 'ready'
  const presence = useMachinePresentationState(machine.online, relay?.phase ?? null)
  const localMachine = machine.id === desktop.status?.machineId
  const localClientMissing = Boolean(localMachine && desktop.connectorSource?.kind === 'missing')
  const localReady = Boolean(
    localMachine &&
    desktop.status?.running &&
    desktop.status.paired &&
    !desktop.status.stale &&
    !desktop.status.error,
  )
  const available = localMachine ? localReady : presence === 'online'
  const allowed =
    ready &&
    available &&
    !(machine.role === 'granted' && machine.permission === 'view') &&
    !machine.remoteAccessDisabledAt
  const canEditDirectory =
    available &&
    !(machine.role === 'granted' && machine.permission === 'view') &&
    !machine.remoteAccessDisabledAt
  const readinessRef = useRef({ runtime, available })
  readinessRef.current = { runtime, available }
  useEffect(() => {
    scope.active = true
    return () => {
      scope.active = false
    }
  }, [scope])
  const model = useMemo(
    () =>
      new DesktopProjectCreationModel({
        accountId,
        machineId: machine.id,
        initialWorkDir: getLastLaunch(machine.id)?.workDir || '~',
        current: () => {
          const latestReadiness = readinessRef.current
          return {
            accountId: useAuthStore.getState().user?.id ?? null,
            machine: latest.current,
            connected:
              latestReadiness.runtime.accountId === accountId &&
              latestReadiness.runtime.bootstrapped &&
              latestReadiness.runtime.status?.phase === 'ready' &&
              latestReadiness.runtime.status.connectivity?.phase === 'connected',
            available: latestReadiness.available,
          }
        },
        canonicalize: (input) => desktopAccountActions.canonicalizeProject(input),
        onCreated: (project) => {
          onClose()
          router.navigate({
            pathname: '/(main)/project',
            params: { machineId: project.machineId, workDir: project.workDir },
          })
        },
        describeError: (error) => {
          const message = error instanceof Error ? error.message : ''
          if (message === 'machine_offline_error') return t('machine_offline_error')
          if (message === 'permission_denied') return t('machines_permission_body')
          if (message === 'project_context_required') return t('agents_validation_workdir_invalid')
          if (message === 'desktop_project_invalid_result') return t('error_unknown')
          return message || t('error_unknown')
        },
      }),
    [accountId, machine.id, onClose, router, t],
  )
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState)
  useEffect(() => model.start(), [model])
  useEffect(() => {
    if (!state.focusWorkDirRequest) return
    workDirInputRef.current?.focus()
    setDirectoryFocused(true)
  }, [state.focusWorkDirRequest])
  useEffect(() => {
    if (browseWasOpen.current && !browsing) {
      workDirInputRef.current?.focus()
      setDirectoryFocused(true)
    }
    browseWasOpen.current = browsing
  }, [browsing])
  const busy = state.pending
  useEffect(() => {
    onNestedDialogChange(browsing)
    return () => onNestedDialogChange(false)
  }, [browsing, onNestedDialogChange])
  useEffect(() => {
    onBusyChange(busy)
    return () => onBusyChange(false)
  }, [busy, onBusyChange])
  const browseDirectory = async () => {
    if (!localMachine) {
      setBrowsing(true)
      return
    }
    setPickingLocalDirectory(true)
    try {
      const selected = await pickDesktopProjectDirectory()
      if (selected && current()) model.setWorkDir(selected)
    } catch (error) {
      if (current()) {
        model.setExternalError(error instanceof Error ? error.message : t('error_unknown'))
      }
    } finally {
      if (current()) setPickingLocalDirectory(false)
    }
  }
  const submit = async () => {
    await model.create()
  }
  return (
    <View style={styles.machine}>
      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.text }]}>
          {t('desktop_create_project_work_dir')}
        </Text>
        <View style={styles.directoryRow}>
          <View
            style={[
              styles.inputFrame,
              { borderColor: directoryFocused ? colors.brand : colors.border },
            ]}
          >
            <TextInput
              ref={workDirInputRef}
              accessibilityLabel={t('desktop_create_project_work_dir')}
              value={state.workDir}
              onChangeText={model.setWorkDir}
              editable={!busy && canEditDirectory}
              autoCapitalize="none"
              autoCorrect={false}
              onFocus={() => setDirectoryFocused(true)}
              onBlur={() => setDirectoryFocused(false)}
              onSubmitEditing={() => {
                if (allowed && !busy) void submit()
              }}
              style={[
                styles.input,
                {
                  color: colors.text,
                  borderColor: directoryFocused ? colors.brand : colors.border,
                  backgroundColor: colors.bg,
                },
              ]}
            />
          </View>
          <DesktopMachineAction
            compact
            label={t('agents_browse_work_directory')}
            disabled={busy || pickingLocalDirectory || !canEditDirectory}
            onPress={() => void browseDirectory()}
          />
        </View>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          {t('desktop_create_project_name_hint')}
        </Text>
      </View>
      {!allowed ? (
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          {t(
            localClientMissing
              ? 'desktop_client_missing_body'
              : presence === 'offline'
                ? 'machine_offline_restart_hint'
                : !ready || presence !== 'online'
                  ? 'relay_not_connected_short'
                  : 'machines_permission_body',
          )}
        </Text>
      ) : null}
      {state.error ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>
          {state.error}
        </Text>
      ) : null}
      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <View style={styles.footerMessage}>
          {busy ? (
            <ActivityIndicator accessibilityLabel={t('start_new_project')} color={colors.brand} />
          ) : null}
        </View>
        <DesktopMachineAction compact label={t('cancel')} disabled={busy} onPress={onClose} />
        <DesktopMachineAction
          compact
          primary
          label={t('start_new_project')}
          disabled={busy || !allowed}
          onPress={() => {
            void submit()
          }}
        />
      </View>
      {browsing && canEditDirectory && !localMachine ? (
        <DesktopProjectDirectoryPicker
          machineId={machine.id}
          initialPath={state.workDir}
          onSelect={(path) => {
            if (current()) {
              model.setWorkDir(path)
              setBrowsing(false)
            }
          }}
          onClose={() => setBrowsing(false)}
        />
      ) : null}
    </View>
  )
}

function MachineSelector({
  machines,
  selected,
  disabled,
  onSelect,
}: {
  machines: Machine[]
  selected: Machine
  disabled: boolean
  onSelect(machineId: string): void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [focused, setFocused] = useState(false)
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.text }]}>
        {t('desktop_create_project_machine')}
      </Text>
      <View
        style={{
          borderWidth: 1,
          borderColor: focused ? colors.brand : colors.border,
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        <select
          data-testid="desktop-create-project-machine-select"
          aria-label={t('desktop_create_project_machine')}
          value={selected.id}
          disabled={disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => {
            if (!disabled) onSelect(event.currentTarget.value)
          }}
          onKeyDown={(event) => {
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) event.stopPropagation()
          }}
          style={{
            minHeight: 42,
            width: '100%',
            appearance: 'auto',
            borderRadius: 8,
            padding: '8px 12px',
            font: 'inherit',
            fontSize: 14,
            lineHeight: '20px',
            color: colors.text,
            backgroundColor: colors.bg,
            opacity: disabled ? 0.5 : 1,
          }}
        >
          {machines.map((machine) => (
            <option key={machine.id} value={machine.id}>
              {machine.name}
            </option>
          ))}
        </select>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: 16 },
  availabilityBanner: {
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  availabilityText: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 18 },
  empty: { minHeight: 160, alignItems: 'center', justifyContent: 'center', gap: 12 },
  machine: { gap: 18 },
  field: { position: 'relative', gap: 8 },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  directoryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inputFrame: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
    lineHeight: 20,
  },
  hint: { fontSize: 12, lineHeight: 18 },
  error: { fontSize: 12, lineHeight: 18 },
  footer: {
    minHeight: 62,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  footerMessage: { flex: 1, minWidth: 0, paddingRight: 12 },
})
