// @arch docs/features/agent-workspaces.md
// @test src/__tests__/agent-workspace-form.test.ts

import type { ReactNode } from 'react'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { getAgentDisplayName, useMachinesStore, useSessionsStore } from '@shennian/shared'
import {
  DEFAULT_NATIVE_FULL_MANAGED_AGENT_PERMISSION_POLICY,
  agentInfoSupportsAgent,
  agentInfoSupportsExecutionMode,
  managedAgentExecutionMode,
  resolveManagedAgentPermissionPolicy,
  isAvailableAgentType,
  type AgentType,
  type AgentWorkspace,
  type ManagedAgentPermissionConfirmationRequest,
  type ManagedAgentPermissionPolicy,
  type SessionMode,
  type Machine,
} from '@shennian/wire'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { ChoiceChip } from '../../components/ChoiceChip'
import { DirBrowser } from '../../components/DirBrowser'
import { useTheme } from '../../hooks/useTheme'
import { mobileTypography } from '../../theme/mobileTypography'
import { getMachineAgentModels } from '../../utils/models'
import {
  applyAgentVoicePatch,
  type AgentVoiceConfigurationResponse,
  type AgentVoiceTextDraft,
} from './agent-voice-configuration'
import { ManagedAgentPermissionSettings } from './ManagedAgentPermissionSettings'
import { LaunchModelSelector } from '../machines/components/LaunchModelSelector'
import { SessionModeSelector } from '../machines/components/SessionModeSelector'
import { useVisibleProjectRecords } from '../projects/hooks/useVisibleProjectRecords'
import { getAgentWorkspaceProjects, type AgentWorkspaceProject } from './agentWorkspaceProjects'
import { useAuthStore } from '../../config/auth'
import { requestAiDataConsent } from '../privacy/aiDataConsent'

export type AgentWorkspaceDraft = Pick<
  AgentWorkspace,
  | 'displayName'
  | 'description'
  | 'systemPrompt'
  | 'machineId'
  | 'runtimeAdapter'
  | 'workDir'
  | 'modelId'
  | 'sessionMode'
  | 'managerConfig'
> & {
  permissionPolicy: ManagedAgentPermissionPolicy
  permissionConfirmation?: ManagedAgentPermissionConfirmationRequest
}

export type AgentWorkspaceFormHandle = {
  getVoiceTextDraft: () => AgentVoiceTextDraft
  applyVoiceConfiguration: (
    response: AgentVoiceConfigurationResponse,
    baseline: AgentVoiceTextDraft,
  ) => { summary: string; canUndo: boolean }
  undoVoiceConfiguration: () => string
  prepareSubmit: () => Promise<AgentWorkspaceDraft | null>
}

export const AgentWorkspaceForm = forwardRef<
  AgentWorkspaceFormHandle,
  {
    initial?: AgentWorkspace
    busy: boolean
    submitLabel: string
    profileAccessory?: ReactNode
    createLayout?: boolean
    showSubmitButton?: boolean
    onDraftChange?: (draft: AgentWorkspaceDraft, canSubmit: boolean) => void
    onFieldFocus?: (target: unknown) => void
    onSubmit: (draft: AgentWorkspaceDraft) => void
  }
>(function AgentWorkspaceForm(
  {
    initial,
    busy,
    submitLabel,
    profileAccessory,
    createLayout = false,
    showSubmitButton = true,
    onDraftChange,
    onFieldFocus,
    onSubmit,
  },
  ref,
) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const accountId = useAuthStore((state) => state.user?.id ?? '')
  const sessions = useSessionsStore((state) => state.sessions)
  const machines = useMachinesStore((state) => state.machines)
  const projectRecords = useVisibleProjectRecords()
  const projects = useMemo(
    () => getAgentWorkspaceProjects(sessions, projectRecords),
    [sessions, projectRecords],
  )
  const fallback =
    projects.find(
      (project) => project.machineId === initial?.machineId && project.workDir === initial.workDir,
    ) ?? projects[0]
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt ?? '')
  const [machineId, setMachineId] = useState(initial?.machineId ?? fallback?.machineId ?? '')
  const [workDir, setWorkDir] = useState(initial?.workDir ?? fallback?.workDir ?? '')
  const [runtimeAdapter, setRuntimeAdapter] = useState<AgentType | null>(
    supportedRuntime(initial?.runtimeAdapter) ?? supportedRuntime(fallback?.agentType),
  )
  const [modelId, setModelId] = useState<string | null>(
    initial?.modelId ?? fallback?.modelId ?? null,
  )
  const [sessionMode, setSessionMode] = useState<SessionMode>(initial?.sessionMode ?? 'standard')
  const [workDirFocused, setWorkDirFocused] = useState(false)
  const workDirInputRef = useRef<TextInput>(null)
  const [permissionPolicy, setPermissionPolicy] = useState<ManagedAgentPermissionPolicy>(() =>
    initial
      ? resolveManagedAgentPermissionPolicy(initial.permissionPolicy, 'legacy')
      : {
          ...DEFAULT_NATIVE_FULL_MANAGED_AGENT_PERMISSION_POLICY,
          externalCapabilities: {
            ...DEFAULT_NATIVE_FULL_MANAGED_AGENT_PERMISSION_POLICY.externalCapabilities,
          },
        },
  )
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const [createPicker, setCreatePicker] = useState<'machine' | 'runtime' | 'model' | 'directory' | null>(null)
  const [createAdvancedOpen, setCreateAdvancedOpen] = useState(false)
  const [directoryBrowserOpen, setDirectoryBrowserOpen] = useState(false)
  const [voiceUndoDraft, setVoiceUndoDraft] = useState<{
    before: AgentVoiceTextDraft
    after: AgentVoiceTextDraft
  } | null>(null)
  const textDraftRef = useRef<AgentVoiceTextDraft>({
    displayName,
    description,
    systemPrompt,
  })
  textDraftRef.current = { displayName, description, systemPrompt }
  const machine = machines.find((item) => item.id === machineId)
  const runtimes = runtimeChoices(machine)
  const models = runtimeAdapter ? getMachineAgentModels(machine, runtimeAdapter) : []
  const runtimeProtection = machine?.agents?.find(
    (agent) => agent.type === runtimeAdapter,
  )?.managedAgentProtection
  const runtimeInfo = machine?.agents?.find((agent) => agent.type === runtimeAdapter)
  // Hidden by default for new/simple agents; an already-saved advanced value keeps its editor visible for compatibility.
  const showSessionModeSection = initial?.sessionMode === 'manager'
  const showPermissionSection = initial
    ? managedAgentExecutionMode(resolveManagedAgentPermissionPolicy(initial.permissionPolicy, 'legacy')) === 'restricted'
    : false
  const machineProjects = projects.filter((project) => project.machineId === machineId)
  const recentMachineProject = machineProjects[0]
  const canSubmit = Boolean(
    displayName.trim() && description.trim() && machineId && workDir.trim() && runtimeAdapter,
  )
  const draft = useMemo<AgentWorkspaceDraft>(
    () => ({
      displayName: displayName.trim(),
      description: description.trim(),
      systemPrompt: systemPrompt.trim(),
      machineId,
      runtimeAdapter,
      workDir: workDir.trim(),
      modelId,
      sessionMode,
      permissionPolicy,
      managerConfig:
        sessionMode === 'manager'
          ? {
              defaultWorkerAgentType: runtimeAdapter,
              defaultWorkerModelId: modelId,
            }
          : null,
    }),
    [
      description,
      displayName,
      machineId,
      modelId,
      permissionPolicy,
      runtimeAdapter,
      sessionMode,
      systemPrompt,
      workDir,
    ],
  )

  useEffect(() => {
    onDraftChange?.(draft, canSubmit)
  }, [canSubmit, draft, onDraftChange])

  useEffect(() => {
    if (initial || machineId || machines.length !== 1) return
    setMachineId(machines[0]!.id)
  }, [initial, machineId, machines])

  useEffect(() => {
    if (initial || !machineId) return
    const choices = runtimeChoices(machine)
    if (!runtimeAdapter && choices.length === 1) setRuntimeAdapter(choices[0]!)
  }, [initial, machine, machineId, runtimeAdapter])

  useEffect(() => {
    if (initial || !machineId) return
    if (workDir.trim()) return
    if (recentMachineProject) {
      setWorkDir(recentMachineProject.workDir)
    }
  }, [initial, machineId, recentMachineProject, workDir])

  const getVoiceTextDraft = useCallback(() => textDraftRef.current, [])

  const applyVoiceConfiguration = useCallback(
    (response: AgentVoiceConfigurationResponse, baseline: AgentVoiceTextDraft) => {
      const current = textDraftRef.current
      const result = applyAgentVoicePatch({ baseline, current, patch: response.patch })
      if (result.appliedFields.length) {
        setVoiceUndoDraft({ before: current, after: result.next })
        setDisplayName(result.next.displayName)
        setDescription(result.next.description)
        setSystemPrompt(result.next.systemPrompt)
      }
      const conflictSuffix = result.conflictedFields.length
        ? ` ${t('agents_voice_conflict_skipped')}`
        : ''
      return {
        summary: `${response.summary}${conflictSuffix}`.trim(),
        canUndo: result.appliedFields.length > 0,
      }
    },
    [t],
  )

  const undoVoiceConfiguration = useCallback(() => {
    if (!voiceUndoDraft) return ''
    const result = applyAgentVoicePatch({
      baseline: voiceUndoDraft.after,
      current: textDraftRef.current,
      patch: voiceUndoDraft.before,
    })
    setDisplayName(result.next.displayName)
    setDescription(result.next.description)
    setSystemPrompt(result.next.systemPrompt)
    setVoiceUndoDraft(null)
    return result.conflictedFields.length
      ? `${t('agents_voice_undone')} ${t('agents_voice_conflict_skipped')}`
      : t('agents_voice_undone')
  }, [t, voiceUndoDraft])

  const prepareSubmit = useCallback(async (): Promise<AgentWorkspaceDraft | null> => {
    if (!canSubmit || !runtimeAdapter) return null
    const executionMode = managedAgentExecutionMode(permissionPolicy)
    const nativeFull = executionMode === 'native-full'
    if (!runtimeInfo || !agentInfoSupportsExecutionMode(runtimeInfo, executionMode)) {
      Alert.alert(
        nativeFull ? t('agents_permission_update_required_title') : t('agents_run_access_restricted'),
        nativeFull
          ? t('agents_permission_update_required_message')
          : t('agents_run_access_restricted_unavailable_description'),
      )
      return null
    }
    const consented = await requestAiDataConsent({
      accountId,
      kind: 'personal',
      title: t('ai_consent_personal_title'),
      message: t('ai_consent_personal_body'),
      allowLabel: t('ai_consent_allow_connect'),
      declineLabel: t('ai_consent_not_now'),
      privacyLabel: t('ai_consent_privacy'),
    })
    if (!consented) return null
    const hostFullAccess = nativeFull || permissionPolicy.fileAccess === 'host-full'
    const limitedProtection = !nativeFull && runtimeProtection?.level === 'partial'
    // Saving the visible permission selection records consent without a second dialog.
    return {
      ...draft,
      ...((hostFullAccess || limitedProtection) && runtimeProtection?.executableFingerprint
        ? {
            permissionConfirmation: {
              runtimeAdapter,
              runtimeVersion: runtimeProtection.runtimeVersion,
              platform: runtimeProtection.platform,
              executableFingerprint: runtimeProtection.executableFingerprint,
              executionMode,
              hostFullAccess,
              limitedProtection: !nativeFull && runtimeProtection.level !== 'hard',
            },
          }
        : {}),
    }
  }, [
    accountId,
    canSubmit,
    draft,
    permissionPolicy.fileAccess,
    permissionPolicy.executionMode,
    runtimeAdapter,
    runtimeProtection,
    runtimeInfo,
    t,
  ])

  useImperativeHandle(
    ref,
    () => ({ getVoiceTextDraft, applyVoiceConfiguration, undoVoiceConfiguration, prepareSubmit }),
    [applyVoiceConfiguration, getVoiceTextDraft, prepareSubmit, undoVoiceConfiguration],
  )

  const chooseProject = (project: AgentWorkspaceProject) => {
    setMachineId(project.machineId)
    setWorkDir(project.workDir)
    const nextRuntimes = runtimeChoices(machines.find((item) => item.id === project.machineId))
    if (!runtimeAdapter || !nextRuntimes.includes(runtimeAdapter)) {
      const nextRuntime = nextRuntimes[0] ?? null
      setRuntimeAdapter(nextRuntime)
      setModelId(nextRuntime === project.agentType ? (project.modelId ?? null) : null)
    }
  }

  const selectMachine = (item: Machine) => {
    setMachineId(item.id)
    const nextRuntime = runtimeChoices(item)[0] ?? null
    const nextProject = projects.find((project) => project.machineId === item.id)
    setRuntimeAdapter(nextRuntime)
    setModelId(null)
    setWorkDir(nextProject?.workDir ?? '')
  }

  const nativeCreate = createLayout && Platform.OS !== 'web'

  return (
    <View style={styles.form}>
      {nativeCreate ? (
        <View style={styles.createSections}>
          {profileAccessory}
          <Text style={[styles.mobileSectionTitle, { color: colors.textSecondary }]}>{t('mobile_identity_information')}</Text>
          <View style={[styles.createCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.createInputRow}>
              <Text style={[styles.createLabel, { color: colors.text }]}>{t('agents_name')}</Text>
              <TextInput testID="agent-display-name-input" accessibilityLabel={t('agents_name')}
                value={displayName} onChangeText={setDisplayName}
                onFocus={(event) => onFieldFocus?.(event.target)}
                placeholder={t('agents_name')} placeholderTextColor={colors.textTertiary}
                style={[styles.createInput, { color: colors.text }]} />
            </View>
            <View style={[styles.createSeparator, { backgroundColor: colors.border }]} />
            <View style={styles.createDescriptionRow}>
              <Text style={[styles.createLabel, { color: colors.text }]}>{t('agents_public_description')}</Text>
              <TextInput testID="agent-description-input" accessibilityLabel={t('agents_public_description')}
                value={description} onChangeText={setDescription} multiline
                onFocus={(event) => onFieldFocus?.(event.target)}
                placeholder={t('agents_public_description')} placeholderTextColor={colors.textTertiary}
                style={[styles.createDescriptionInput, { color: colors.text }]} />
            </View>
          </View>
          <Text style={[styles.mobileSectionTitle, { color: colors.textSecondary }]}>{t('mobile_run_method')}</Text>
          <View style={[styles.createCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <CreateSelectRow label={t('mobile_create_machine')} value={machine?.name ?? ''}
              onPress={() => setCreatePicker('machine')} />
            <CreateSelectRow label={t('mobile_create_ai_tool')}
              value={runtimeAdapter ? getAgentDisplayName(runtimeAdapter) : ''}
              onPress={() => setCreatePicker('runtime')} />
            <CreateSelectRow label={t('agents_model')}
              value={models.find((model) => model.id === modelId)?.name ?? t('agents_default_model')}
              onPress={() => setCreatePicker('model')} />
            <CreateSelectRow label={t('agents_work_directory')} value={workDir}
              onPress={() => setCreatePicker('directory')} last />
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t('mobile_create_advanced')}
            onPress={() => setCreateAdvancedOpen((open) => !open)} style={styles.createAdvancedAction}>
            <Text style={[styles.mobileSectionTitle, { color: colors.textSecondary }]}>{t('mobile_create_advanced')}</Text>
            <Ionicons name={createAdvancedOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
          </Pressable>
          {createAdvancedOpen ? <Field testID="agent-system-prompt-input" label={t('agents_system_prompt')}
            value={systemPrompt} onChangeText={setSystemPrompt} onFocus={onFieldFocus} multiline /> : null}
        </View>
      ) : (
      <View style={styles.sectionsLayout}>
        <View
          testID="agent-public-profile-section"
          style={styles.section}
        >
          {Platform.OS !== 'web' ? <Text style={[styles.mobileSectionTitle, { color: colors.textSecondary }]}>{t('mobile_identity_information')}</Text> : null}
          {profileAccessory}
          <Field
            testID="agent-display-name-input"
            label={t('agents_name')}
            value={displayName}
            onChangeText={setDisplayName}
            onFocus={onFieldFocus}
          />
          <Field
            testID="agent-description-input"
            label={t('agents_public_description')}
            value={description}
            onChangeText={setDescription}
            onFocus={onFieldFocus}
            multiline
          />
        </View>

        <View
          testID="agent-internal-settings-section"
          style={styles.section}
        >
          {Platform.OS !== 'web' ? <Text style={[styles.mobileSectionTitle, { color: colors.textSecondary }]}>{t('mobile_run_method')}</Text> : null}
          <Text style={[styles.label, { color: colors.text }]}>{t('agents_machine')}</Text>
          <View style={styles.chips}>
            {machines.map((item) => (
              <Choice
                key={item.id}
                label={item.name}
                selected={item.id === machineId}
                onPress={() => {
                  setMachineId(item.id)
                  const nextRuntime = runtimeChoices(item)[0] ?? null
                  const nextProject = projects.find((project) => project.machineId === item.id)
                  setRuntimeAdapter(nextRuntime)
                  setModelId(null)
                  setWorkDir(nextProject?.workDir ?? '')
                }}
              />
            ))}
          </View>

          <View style={styles.directoryLabelRow}>
            <Text style={[styles.label, styles.labelWithoutMargin, { color: colors.text }]}>
              {t('agents_work_directory')}
            </Text>
            {machineProjects.length ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('agents_project_quick_select')}
                onPress={() => setProjectPickerOpen(true)}
              >
                <Text style={[styles.link, { color: colors.textSecondary }]}>
                  {t('agents_project_quick_select')}
                </Text>
              </Pressable>
            ) : null}
          </View>
          <View style={styles.directoryInputRow}>
            <TextInput
              ref={workDirInputRef}
              testID="agent-work-dir-input"
              value={workDir}
              onChangeText={setWorkDir}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={t('agents_start_directory_placeholder')}
              placeholderTextColor={colors.textTertiary}
              onFocus={(event) => {
                setWorkDirFocused(true)
                onFieldFocus?.(event.target)
              }}
              onBlur={() => setWorkDirFocused(false)}
              style={[
                styles.input,
                styles.directoryInput,
                { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg },
              ]}
            />
            {!workDirFocused && workDir ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('agents_work_directory')}
                style={[styles.directoryDisplay, { backgroundColor: colors.bg }]}
                onPress={() => workDirInputRef.current?.focus()}
              >
                <Text
                  numberOfLines={1}
                  ellipsizeMode="middle"
                  style={[{ color: colors.text, fontSize: 15 }, Platform.OS !== 'web' && mobileTypography.body]}
                >
                  {workDir}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              testID="agent-browse-work-dir"
              accessibilityRole="button"
              accessibilityLabel={t('agents_browse_work_directory')}
              disabled={!machineId}
              style={({ pressed }) => [
                styles.directoryBrowseButton,
                {
                  borderColor: colors.border,
                  backgroundColor: pressed ? colors.surfaceHover : colors.surface,
                },
                !machineId && styles.disabled,
              ]}
              onPress={() => setDirectoryBrowserOpen(true)}
            >
              <Ionicons name="folder-open-outline" size={21} color={colors.textSecondary} />
            </Pressable>
          </View>

          <Text style={[styles.label, { color: colors.text }]}>{t('agents_runtime')}</Text>
          <View style={styles.chips}>
            {runtimes.map((runtime) => (
              <Choice
                key={runtime}
                label={getAgentDisplayName(runtime)}
                selected={runtimeAdapter === runtime}
                onPress={() => {
                  setRuntimeAdapter(runtime)
                  setModelId(null)
                }}
              />
            ))}
          </View>
          <Text style={[styles.label, { color: colors.text }]}>{t('agents_model')}</Text>
          {runtimeAdapter ? (
            <LaunchModelSelector
              agentType={runtimeAdapter}
              models={models}
              selectedModel={modelId}
              disabled={busy}
              allowDefaultSelection
              defaultOptionLabel={t('agents_default_model')}
              onSelectModel={setModelId}
            />
          ) : null}

          {/* New-user primary path stays single-Agent/full-access; already-elevated agents keep their editor so saved configs remain manageable. */}
          {showSessionModeSection ? (
            <SessionModeSelector
              value={sessionMode}
              managerAvailable
              embedded
              disabled={busy}
              onChange={setSessionMode}
            />
          ) : null}

          {showPermissionSection ? (
            <ManagedAgentPermissionSettings
              value={permissionPolicy}
              runtimeProtection={runtimeProtection}
              restrictedModeAvailable={runtimeInfo ? agentInfoSupportsExecutionMode(runtimeInfo, 'restricted') : false}
              disabled={busy}
              onChange={setPermissionPolicy}
            />
          ) : null}

          <Field
            testID="agent-system-prompt-input"
            label={t('agents_system_prompt')}
            value={systemPrompt}
            onChangeText={setSystemPrompt}
            onFocus={onFieldFocus}
            multiline
          />
        </View>
      </View>
      )}
      {!projects.length ? (
        <Text style={{ color: colors.textSecondary }}>{t('agents_project_required')}</Text>
      ) : null}
      {showSubmitButton ? (
        <Pressable
          disabled={busy || !canSubmit}
          style={[
            styles.submit,
            { backgroundColor: colors.brand, opacity: busy || !canSubmit ? 0.5 : 1 },
          ]}
          onPress={() => {
            void prepareSubmit().then((prepared) => {
              if (prepared) onSubmit(prepared)
            })
          }}
        >
          <Text style={styles.submitText}>{submitLabel}</Text>
        </Pressable>
      ) : null}

      <Modal
        visible={projectPickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setProjectPickerOpen(false)}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setProjectPickerOpen(false)} />
          <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.text }]}>
                {t('agents_choose_work_directory')}
              </Text>
              <Pressable onPress={() => setProjectPickerOpen(false)}>
                <Text style={[styles.sheetDone, { color: colors.brand }]}>{t('done')}</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.sheetList}>
              {machineProjects.map((project) => {
                const selected = project.workDir === workDir
                return (
                  <Pressable
                    key={`${project.machineId}:${project.workDir}`}
                    testID="agent-project-option"
                    style={[
                      styles.option,
                      {
                        borderColor: selected ? colors.brand : colors.border,
                        backgroundColor: colors.bg,
                      },
                    ]}
                    onPress={() => {
                      chooseProject(project)
                      setProjectPickerOpen(false)
                    }}
                  >
                    <Text style={[{ color: colors.text, fontWeight: '600' }, Platform.OS !== 'web' && mobileTypography.listTitle]} numberOfLines={2}>
                      {project.workDir}
                    </Text>
                  </Pressable>
                )
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={createPicker !== null} transparent animationType="slide"
        onRequestClose={() => setCreatePicker(null)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setCreatePicker(null)} />
          <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.text }]}>
                {createPicker === 'machine' ? t('mobile_create_machine') : createPicker === 'runtime'
                  ? t('mobile_create_ai_tool') : createPicker === 'model' ? t('agents_model') : t('agents_work_directory')}
              </Text>
              <Pressable onPress={() => setCreatePicker(null)}>
                <Text style={[styles.sheetDone, { color: colors.brand }]}>{t('done')}</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.sheetList} keyboardShouldPersistTaps="always">
              {createPicker === 'machine' ? machines.map((item) => (
                <CreatePickerOption key={item.id} label={item.name} selected={item.id === machineId}
                  onPress={() => { selectMachine(item); setCreatePicker(null) }} />
              )) : null}
              {createPicker === 'runtime' ? runtimes.map((runtime) => (
                <CreatePickerOption key={runtime} label={getAgentDisplayName(runtime)}
                  selected={runtime === runtimeAdapter}
                  onPress={() => { setRuntimeAdapter(runtime); setModelId(null); setCreatePicker(null) }} />
              )) : null}
              {createPicker === 'model' ? (
                <>
                  <CreatePickerOption label={t('agents_default_model')} selected={!modelId}
                    onPress={() => { setModelId(null); setCreatePicker(null) }} />
                  {models.map((model) => <CreatePickerOption key={model.id} label={model.name}
                    selected={model.id === modelId}
                    onPress={() => { setModelId(model.id); setCreatePicker(null) }} />)}
                </>
              ) : null}
              {createPicker === 'directory' ? (
                <>
                  <TextInput testID="agent-work-dir-input" value={workDir} onChangeText={setWorkDir}
                    autoCapitalize="none" autoCorrect={false}
                    placeholder={t('agents_start_directory_placeholder')}
                    placeholderTextColor={colors.textTertiary}
                    style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]} />
                  {machineProjects.map((project) => <CreatePickerOption
                    key={`${project.machineId}:${project.workDir}`} label={project.workDir}
                    selected={project.workDir === workDir}
                    onPress={() => { chooseProject(project); setCreatePicker(null) }} />)}
                  <CreatePickerOption label={t('agents_browse_work_directory')} onPress={() => {
                    setCreatePicker(null)
                    setDirectoryBrowserOpen(true)
                  }} />
                </>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {directoryBrowserOpen && machineId ? (
        <DirBrowser
          machineId={machineId}
          initialPath={workDir || '~'}
          mode="workDirPicker"
          onSelect={setWorkDir}
          onClose={() => setDirectoryBrowserOpen(false)}
        />
      ) : null}
    </View>
  )
})

function Field(props: {
  testID?: string
  label: string
  value: string
  onChangeText: (value: string) => void
  onFocus?: (target: unknown) => void
  multiline?: boolean
}) {
  const { colors } = useTheme()
  return (
    <View>
      <Text style={[styles.label, { color: colors.text }]}>{props.label}</Text>
      <TextInput
        testID={props.testID}
        accessibilityLabel={props.label}
        value={props.value}
        onChangeText={props.onChangeText}
        onFocus={(event) => props.onFocus?.(event.target)}
        multiline={props.multiline}
        style={[
          styles.input,
          props.multiline && styles.multi,
          { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
        ]}
        placeholderTextColor={colors.textTertiary}
      />
    </View>
  )
}

function Choice({
  label,
  selected,
  onPress,
}: {
  label: string
  selected: boolean
  onPress: () => void
}) {
  return <ChoiceChip label={label} selected={selected} onPress={onPress} />
}

function CreateSelectRow({ label, value, onPress, last = false }: {
  label: string
  value: string
  onPress: () => void
  last?: boolean
}) {
  const { colors } = useTheme()
  return <Pressable accessibilityRole="button" accessibilityLabel={`${label}, ${value || '未选择'}`}
    onPress={onPress} style={[styles.createSelectRow, !last && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
    <Text style={[styles.createLabel, { color: colors.text }]}>{label}</Text>
    <Text numberOfLines={1} ellipsizeMode="middle" style={[styles.createValue, { color: colors.textSecondary }]}>{value || '未选择'}</Text>
    <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
  </Pressable>
}

function CreatePickerOption({ label, selected = false, onPress }: {
  label: string
  selected?: boolean
  onPress: () => void
}) {
  const { colors } = useTheme()
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
    style={[styles.createPickerOption, { borderBottomColor: colors.border }]}>
    <Text style={[styles.createPickerText, { color: colors.text }]} numberOfLines={2}>{label}</Text>
    {selected ? <Ionicons name="checkmark" size={20} color={colors.brand} /> : null}
  </Pressable>
}

function runtimeChoices(machine: Machine | undefined): AgentType[] {
  const richAgents = machine?.agents ?? []
  const richTypes = richAgents.filter(agentInfoSupportsAgent).map((agent) => agent.type)
  // A current daemon may report only unsupported runtimes. Falling back to
  // agentList in that case would make those fail-closed runtimes selectable.
  // The fallback is only for legacy daemons that do not publish rich entries.
  const values = richAgents.length ? richTypes : (machine?.agentList ?? [])
  return [...new Set(values)].filter(
    (value): value is AgentType =>
      typeof value === 'string' &&
      isAvailableAgentType(value) &&
      value !== 'manager' &&
      value !== 'pi' &&
      value !== 'openclaw',
  )
}

function supportedRuntime(value: AgentType | null | undefined): AgentType | null {
  return value && isAvailableAgentType(value) && !['manager', 'pi', 'openclaw'].includes(value)
    ? value
    : null
}

const styles = StyleSheet.create({
  form: { gap: 22 },
  createSections: { gap: 14 },
  createCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, overflow: 'hidden' },
  createInputRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 12 },
  createDescriptionRow: { minHeight: 92, paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  createLabel: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  createInput: { flex: 1, minWidth: 0, fontSize: 16, lineHeight: 22, textAlign: 'right', paddingVertical: 8 },
  createDescriptionInput: { minHeight: 42, fontSize: 15, lineHeight: 21, textAlignVertical: 'top', padding: 0 },
  createSeparator: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  createSelectRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 10 },
  createValue: { flex: 1, minWidth: 0, fontSize: 15, textAlign: 'right' },
  createPickerOption: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  createPickerText: { flex: 1, fontSize: 16, lineHeight: 22 },
  createAdvancedAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionsLayout: { gap: 22 },
  section: { gap: 14 },
  mobileSectionTitle: { fontSize: 14, paddingTop: 5 },
  label: { ...(Platform.OS === 'web' ? { fontSize: 13, fontWeight: '600' } as const : mobileTypography.sectionTitle), marginBottom: 6 },
  labelWithoutMargin: { marginBottom: 0 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    minHeight: 44,
    paddingHorizontal: 12,
    fontSize: 15,
    ...(Platform.OS !== 'web' && { ...mobileTypography.body, paddingVertical: 10 }),
  },
  multi: { minHeight: 88, paddingTop: 10, textAlignVertical: 'top' },
  option: { padding: 12, borderWidth: 1, borderRadius: 10, gap: 4 },
  directoryLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  directoryInputRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  directoryInput: { flex: 1, minWidth: 0 },
  directoryDisplay: {
    position: 'absolute',
    left: 1,
    right: 55,
    top: 1,
    bottom: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  directoryBrowseButton: {
    width: 46,
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.4 },
  link: { ...(Platform.OS === 'web' ? { fontSize: 13, fontWeight: '600' } as const : mobileTypography.secondary) },
  chips: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, rowGap: 0 },
  submit: {
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  submitText: { color: '#fff', ...(Platform.OS === 'web' ? { fontWeight: '700' } as const : mobileTypography.navigationTitle) },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: '#00000055' },
  sheet: { maxHeight: '65%', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 24 },
  sheetHeader: {
    height: 56,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: { ...(Platform.OS === 'web' ? { fontSize: 17, fontWeight: '700' } as const : mobileTypography.navigationTitle) },
  sheetDone: { fontSize: 15, fontWeight: '600' },
  sheetList: { padding: 16, paddingTop: 0, gap: 10 },
})
