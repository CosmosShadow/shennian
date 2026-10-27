// @arch docs/features/agent-workspaces.md
// @arch docs/design/desktop/unified-desktop-control.md
// @test ../../__tests__/desktop-agent-workspace-draft.test.ts
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native'
import { getAgentDisplayName, useMachinesStore, useSessionsStore } from '@shennian/shared'
import {
  agentInfoSupportsExecutionMode,
  managedAgentExecutionMode,
  resolveManagedAgentPermissionPolicy,
  type AgentWorkspace,
} from '@shennian/wire'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../config/auth'
import { useTheme } from '../../hooks/useTheme'
import { DesktopModelChoices } from '../desktop-launch/DesktopLaunchChoices'
import { SessionModeSelector } from '../machines/components/SessionModeSelector'
import { ManagedAgentPermissionSettings } from '../agents/ManagedAgentPermissionSettings'
import { DesktopProjectDirectoryPicker } from '../desktop-projects/DesktopProjectDirectoryPicker'
import { DesktopMachineAction } from '../desktop-machines/DesktopMachineAction'
import { desktopControlMetrics, desktopTypography } from '../desktop-shell/desktopDesignTokens'
import { useDesktopControlState } from '../desktop-control/hooks/useDesktopControlState'
import {
  createDesktopAgentDraft,
  desktopAgentDefaultModel,
  desktopAgentDraftComplete,
  desktopAgentProjects,
  desktopManagedRuntimes,
  normalizeDesktopAgentDraft,
  prepareDesktopAgentDraft,
  type DesktopAgentWorkspaceDraft,
} from './desktopAgentWorkspaceDraft'

export type DesktopAgentWorkspaceFormHandle = {
  prepareSubmit(): Promise<DesktopAgentWorkspaceDraft | null>
}
export const DesktopAgentWorkspaceForm = forwardRef<
  DesktopAgentWorkspaceFormHandle,
  {
    initial?: AgentWorkspace
    busy: boolean
    profileAccessory?: ReactNode
    onUserEdit?(): void
    onDraftChange?(draft: DesktopAgentWorkspaceDraft, canSubmit: boolean): void
  }
>(function DesktopAgentWorkspaceForm(
  { initial, busy, profileAccessory, onDraftChange, onUserEdit },
  ref,
) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { width: _width } = useWindowDimensions()
  const accountId = useAuthStore((state) => state.user?.id ?? '')
  const machines = useMachinesStore((state) => state.machines)
  const sessions = useSessionsStore((state) => state.sessions)
  const desktop = useDesktopControlState()
  const projects = useMemo(() => desktopAgentProjects(sessions), [sessions])
  const [draft, setDraft] = useState(() => createDesktopAgentDraft(initial, machines, projects))
  const [directoryOpen, setDirectoryOpen] = useState(false)
  const [projectsOpen, setProjectsOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scope = useRef({ accountId, active: true })
  const currentDraft = useRef(draft)
  currentDraft.current = draft
  const machine = machines.find((item) => item.id === draft.machineId)
  const localClientMissing = Boolean(
    machine &&
    desktop.status?.machineId === machine.id &&
    desktop.connectorSource?.kind === 'missing',
  )
  const runtimes = desktopManagedRuntimes(machine)
  const runtime = runtimes.find((item) => item.type === draft.runtimeAdapter)
  // Hidden by default for new/simple agents; an already-saved advanced value keeps its editor visible for compatibility.
  const showSessionModeSection = initial?.sessionMode === 'manager'
  const showPermissionSection = initial
    ? managedAgentExecutionMode(resolveManagedAgentPermissionPolicy(initial.permissionPolicy, 'legacy')) === 'restricted'
    : false
  const machineProjects = projects.filter((project) => project.machineId === draft.machineId)
  const wide = false
  const update = (patch: Partial<DesktopAgentWorkspaceDraft>) => {
    if (busy || !scope.current.active || useAuthStore.getState().user?.id !== accountId) return
    onUserEdit?.()
    setError(null)
    setDraft((current) => ({ ...current, ...patch, permissionConfirmation: undefined }))
  }
  useEffect(() => {
    const activeScope = { accountId, active: true }
    scope.current = activeScope
    const unsubscribe = useAuthStore.subscribe((next, previous) => {
      if (next.user?.id !== previous.user?.id) activeScope.active = false
    })
    return () => {
      activeScope.active = false
      unsubscribe()
    }
  }, [accountId])
  useEffect(() => {
    onDraftChange?.(
      normalizeDesktopAgentDraft(draft),
      desktopAgentDraftComplete(draft) && !localClientMissing,
    )
  }, [draft, localClientMissing, onDraftChange])
  useEffect(() => {
    if (initial || draft.machineId || machines.length !== 1) return
    setDraft((current) =>
      current.machineId ? current : { ...current, machineId: machines[0]!.id },
    )
  }, [initial, draft.machineId, machines])
  useEffect(() => {
    if (initial || draft.runtimeAdapter || runtimes.length !== 1) return
    const selected = runtimes[0]!
    setDraft((current) =>
      current.runtimeAdapter
        ? current
        : {
            ...current,
            runtimeAdapter: selected.type,
            modelId: desktopAgentDefaultModel(selected),
          },
    )
  }, [initial, draft.runtimeAdapter, runtimes])
  useEffect(() => {
    if (initial || !draft.machineId || draft.workDir.trim()) return
    const recent = projects.find((project) => project.machineId === draft.machineId)
    if (recent)
      setDraft((current) => (current.workDir ? current : { ...current, workDir: recent.workDir }))
  }, [initial, draft.machineId, draft.workDir, projects])
  useImperativeHandle(
    ref,
    () => ({
      prepareSubmit: async () => {
        if (busy || !scope.current.active || useAuthStore.getState().user?.id !== accountId)
          return null
        if (localClientMissing) {
          setError('desktop_client_missing_body')
          return null
        }
        const prepared = prepareDesktopAgentDraft(
          currentDraft.current,
          useMachinesStore.getState().machines,
          initial,
        )
        if (!prepared) setError('agents_permission_update_required_message')
        return prepared
      },
    }),
    [accountId, busy, initial, localClientMissing],
  )
  const chooseMachine = (machineId: string) => {
    const choices = desktopManagedRuntimes(machines.find((item) => item.id === machineId))
    const selected = choices.length === 1 ? choices[0] : undefined
    update({
      machineId,
      workDir: projects.find((project) => project.machineId === machineId)?.workDir ?? '',
      runtimeAdapter: selected?.type ?? null,
      modelId: desktopAgentDefaultModel(selected),
      // Switching machines must not silently drop a saved collaboration mode; only a runtime that cannot manage forces standard.
      sessionMode: selected && selected.supportsManagerMode !== true ? 'standard' : draft.sessionMode,
      managerConfig: null,
    })
    setDirectoryOpen(false)
    setProjectsOpen(false)
  }
  return (
    <View
      testID="desktop-agent-workspace-form"
      style={[
        styles.form,
        { maxWidth: 720, width: '100%', alignSelf: 'center' },
        wide && styles.columns,
      ]}
    >
      <View testID="desktop-agent-public-profile" style={[styles.section, wide && styles.profile]}>
        {profileAccessory}
        <Field
          label={t('agents_name')}
          value={draft.displayName}
          disabled={busy}
          onChange={(displayName) => update({ displayName })}
        />
        <Field
          label={t('agents_public_description')}
          value={draft.description}
          disabled={busy}
          multiline
          onChange={(description) => update({ description })}
        />
      </View>
      <View
        testID="desktop-agent-runtime-settings"
        style={[
          styles.section,
          styles.runtime,
          { borderColor: colors.border },
          wide && styles.runtimeWide,
        ]}
      >
        <Text style={{ color: colors.text }}>{t('agents_machine')}</Text>
        <View accessibilityRole="radiogroup" style={styles.choices}>
          {machines.map((item) => (
            <Choice
              key={item.id}
              label={item.name}
              selected={item.id === draft.machineId}
              disabled={busy}
              onPress={() => chooseMachine(item.id)}
            />
          ))}
        </View>
        {!machines.length ? (
          <Text style={{ color: colors.textSecondary }}>
            {t('agents_runtime_machine_unselected')}
          </Text>
        ) : null}
        <Field
          label={t('agents_work_directory')}
          value={draft.workDir}
          disabled={busy}
          onChange={(workDir) => update({ workDir })}
        />
        <View style={styles.choices}>
          <DesktopMachineAction
            label={t('agents_browse_work_directory')}
            disabled={busy || !draft.machineId || localClientMissing}
            onPress={() => setDirectoryOpen(true)}
          />
          {machineProjects.length ? (
            <DesktopMachineAction
              label={t('agents_project_quick_select')}
              disabled={busy}
              expanded={projectsOpen}
              onPress={() => setProjectsOpen((value) => !value)}
            />
          ) : null}
        </View>
        {projectsOpen ? (
          <View style={styles.section}>
            {machineProjects.map((project) => (
              <DesktopMachineAction
                key={project.workDir}
                label={project.workDir}
                disabled={busy}
                onPress={() => {
                  update({ workDir: project.workDir })
                  setProjectsOpen(false)
                }}
              />
            ))}
          </View>
        ) : null}
        <Text style={{ color: colors.text }}>{t('desktop_machine_tools')}</Text>
        <View accessibilityRole="radiogroup" style={styles.choices}>
          {runtimes.map((item) => (
            <Choice
              key={item.type}
              label={
                getAgentDisplayName(item.type) === 'Kimi'
                  ? 'Kimi CLI'
                  : getAgentDisplayName(item.type)
              }
              selected={item.type === draft.runtimeAdapter}
              disabled={busy}
              onPress={() =>
                update({
                  runtimeAdapter: item.type,
                  modelId: desktopAgentDefaultModel(item),
                  sessionMode: item.supportsManagerMode === true ? draft.sessionMode : 'standard',
                  managerConfig: null,
                })
              }
            />
          ))}
        </View>
        {draft.runtimeAdapter && !runtime ? (
          <Text accessibilityRole="alert" style={{ color: colors.error }}>
            {getAgentDisplayName(draft.runtimeAdapter)} ·{' '}
            {t('agents_validation_runtime_unavailable')}
          </Text>
        ) : null}
        {!runtimes.length && draft.machineId ? (
          <Text accessibilityRole="alert" style={{ color: colors.textSecondary }}>
            {t('agents_permission_update_required_message')}
          </Text>
        ) : null}
        {localClientMissing ? (
          <Text accessibilityRole="alert" style={{ color: colors.error }}>
            {t('desktop_client_missing_body')}
          </Text>
        ) : null}
        {runtime ? (
          <DesktopModelChoices
            compact
            autoSelectOnlyModel={false}
            models={runtime.models}
            selected={draft.modelId}
            disabled={busy}
            onSelect={(modelId) => update({ modelId })}
          />
        ) : (
          <Text style={{ color: colors.text }}>{t('agents_model')}</Text>
        )}
        {draft.modelId &&
        (!runtime ||
          (runtime.models.length > 0 &&
            !runtime.models.some((model) => model.id === draft.modelId))) ? (
          <Text selectable style={{ color: colors.textSecondary }}>
            {draft.modelId}
          </Text>
        ) : null}
        {showSessionModeSection ? (
          <SessionModeSelector
            desktop
            value={draft.sessionMode}
            managerAvailable={runtime?.supportsManagerMode === true}
            embedded
            disabled={busy}
            onChange={(sessionMode) => update({ sessionMode })}
          />
        ) : null}
        {showPermissionSection ? (
          <ManagedAgentPermissionSettings
            desktop
            value={draft.permissionPolicy}
            runtimeProtection={runtime?.managedAgentProtection}
            restrictedModeAvailable={runtime ? agentInfoSupportsExecutionMode(runtime, 'restricted') : false}
            disabled={busy}
            onChange={(permissionPolicy) => update({ permissionPolicy })}
          />
        ) : null}
        <Field
          label={t('agents_system_prompt')}
          value={draft.systemPrompt}
          disabled={busy}
          multiline
          onChange={(systemPrompt) => update({ systemPrompt })}
        />
        {error ? (
          <Text accessibilityRole="alert" style={{ color: colors.error }}>
            {t(error)}
          </Text>
        ) : null}
      </View>
      {directoryOpen && draft.machineId ? (
        <DesktopProjectDirectoryPicker
          machineId={draft.machineId}
          initialPath={draft.workDir || '~'}
          onClose={() => setDirectoryOpen(false)}
          onSelect={(workDir) => update({ workDir })}
        />
      ) : null}
    </View>
  )
})

function Field({
  label,
  value,
  disabled,
  multiline = false,
  onChange,
}: {
  label: string
  value: string
  disabled: boolean
  multiline?: boolean
  onChange(value: string): void
}) {
  const { colors } = useTheme()
  const [focused, setFocused] = useState(false)
  return (
    <View style={styles.field}>
      <Text style={{ color: colors.text }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        editable={!disabled}
        multiline={multiline}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={onChange}
        onFocus={(event) =>
          setFocused(
            (event.nativeEvent.target as unknown as HTMLElement)?.matches?.(':focus-visible') ??
              false,
          )
        }
        onBlur={() => setFocused(false)}
        style={[
          styles.input,
          multiline && styles.multiline,
          {
            color: colors.text,
            backgroundColor: colors.surface,
            borderColor: focused ? colors.brand : colors.textSecondary,
          },
        ]}
      />
    </View>
  )
}
function Choice({
  label,
  selected,
  disabled,
  onPress,
}: {
  label: string
  selected: boolean
  disabled: boolean
  onPress(): void
}) {
  const { colors } = useTheme()
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled }}
      aria-checked={selected}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      onFocus={(event) =>
        setFocused(
          (event.nativeEvent.target as unknown as HTMLElement)?.matches?.(':focus-visible') ??
            false,
        )
      }
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.choice,
        {
          borderColor: focused ? colors.brand : colors.border,
          borderWidth: focused ? 2 : 1,
          backgroundColor: pressed
            ? colors.surfaceHover
            : selected
              ? colors.selectionBackground
              : colors.bg,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Text style={[desktopTypography.control, { color: colors.text }]}>{label}</Text>
    </Pressable>
  )
}
const styles = StyleSheet.create({
  form: { width: '100%', maxWidth: 1120, alignSelf: 'center', gap: 24 },
  columns: { flexDirection: 'row', alignItems: 'flex-start' },
  section: { gap: 16, minWidth: 0 },
  profile: { flex: 1 },
  runtime: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 24 },
  runtimeWide: {
    flex: 2,
    borderTopWidth: 0,
    paddingTop: 0,
    borderLeftWidth: StyleSheet.hairlineWidth,
    paddingLeft: 24,
  },
  heading: desktopTypography.sectionTitle,
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  field: { gap: 8 },
  input: {
    ...desktopTypography.body,
    borderWidth: 1,
    borderRadius: 8,
    minHeight: desktopControlMetrics.standardControlHeight,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  choice: {
    minHeight: desktopControlMetrics.standardControlHeight,
    paddingHorizontal: 12,
    borderRadius: 8,
    justifyContent: 'center',
  },
})
