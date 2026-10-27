// @covers src/features/agents/AgentWorkspaceForm.tsx
// @covers src/features/agents/screens/AgentNewScreen.tsx
// @covers app/(main)/agents/[agentId].tsx
// @covers src/features/agents/agentWorkspaceProjects.ts

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { NianProject, NianSession } from '@shennian/wire'
import { getAgentWorkspaceProjects } from '../features/agents/agentWorkspaceProjects'

const read = (relative: string) => readFileSync(resolve(__dirname, relative), 'utf8')

describe('Agent workspace form', () => {
  it('includes both existing projects even when only one has a cached active session', () => {
    const timestamp = '2026-09-14T10:00:00.000Z'
    const records: NianProject[] = ['shennian', 'atlas'].map((name) => ({
      id: name, machineId: 'mac', machineName: 'Mac', machineOnline: true,
      workDir: `/projects/${name}`, displayName: name,
      createdAt: timestamp, updatedAt: timestamp, lastActivityAt: timestamp,
      defaultAgentType: 'codex', defaultModelId: 'saved-model',
    }))
    const session: NianSession = {
      id: 'session', machineId: 'mac', userId: 'user', agentType: 'codex',
      agentSessionId: 'native', title: 'Task', status: 'active',
      workDir: '/projects/shennian', createdAt: timestamp, updatedAt: timestamp,
      lastActivityAt: timestamp, userState: null, activity: null,
    }
    const projects = getAgentWorkspaceProjects([session], records)
    expect(projects.map((project) => project.workDir).sort()).toEqual([
      '/projects/atlas', '/projects/shennian',
    ])
    expect(projects.find((project) => project.workDir === '/projects/atlas')).toMatchObject({
      agentType: 'codex', modelId: 'saved-model',
    })
    expect(getAgentWorkspaceProjects([], records)).toHaveLength(2)
    expect(getAgentWorkspaceProjects([session, { ...session, id: 'second' }], records)).toHaveLength(2)
    expect(getAgentWorkspaceProjects([{ ...session, agentIdentityId: 'managed', workDir: '/private-agent' }], records)).toHaveLength(2)
    expect(getAgentWorkspaceProjects([], [...records, { ...records[0]!, id: 'other', machineId: 'other' }])
      .filter((project) => project.machineId === 'mac')).toHaveLength(2)
  })

  it('collects each stable Agent setting independently and deduplicates projects', () => {
    const form = read('../features/agents/AgentWorkspaceForm.tsx')
    expect(form).toContain("t('agents_name')")
    expect(form).toContain('testID="agent-display-name-input"')
    expect(form).toContain('testID="agent-description-input"')
    expect(form).toContain('testID="agent-system-prompt-input"')
    expect(form).toContain("t('agents_public_description')")
    expect(form).not.toContain('desktopControlSurface')
    expect(form).toContain('{profileAccessory}')
    expect(form).not.toContain("t('agents_public_section_hint')")
    expect(form).not.toContain("t('agents_internal_section_hint')")
    expect(form).not.toContain('styles.card')
    expect(form).toContain("t('agents_system_prompt')")
    expect(form).toContain('testID="agent-work-dir-input"')
    expect(form).toContain('testID="agent-browse-work-dir"')
    expect(form).toContain('<DirBrowser')
    expect(form).toContain('mode="workDirPicker"')
    expect(form).toContain("t('agents_project_quick_select')")
    expect(form).toContain("t('agents_work_directory')")
    expect(form).toContain("t('agents_machine')")
    expect(form).toContain("t('agents_runtime')")
    expect(form).toContain("t('agents_model')")
    expect(form).toContain('<LaunchModelSelector')
    expect(form).toContain('allowDefaultSelection')
    expect(form).toContain("defaultOptionLabel={t('agents_default_model')}")
    expect(form).toContain('label={getAgentDisplayName(runtime)}')
    expect(form).not.toContain('agent.supportsManagedAgent !== false')
    expect(form).toContain('richAgents.length ? richTypes')
    expect(form).toContain("value !== 'manager'")
    expect(form).toContain("value !== 'pi'")
    expect(form).toContain("value !== 'openclaw'")
    expect(form).not.toContain('<AdvancedSessionSettings')
    expect(form).toContain('<SessionModeSelector')
    expect(form).not.toContain('ManagerWorkerSelector')
    expect(form).toContain('<ManagedAgentPermissionSettings')
    expect(form).toContain("agentInfoSupportsExecutionMode(runtimeInfo, 'restricted')")
    expect(form).toContain('DEFAULT_NATIVE_FULL_MANAGED_AGENT_PERMISSION_POLICY')
    expect(form).toContain('permissionPolicy,')
    expect(form).toContain('prepareSubmit: () => Promise<AgentWorkspaceDraft | null>')
    expect(form).toContain('runtimeProtection?.executableFingerprint')
    expect(form).not.toContain('confirmAlert')
    const permissions = read('../features/agents/ManagedAgentPermissionSettings.tsx')
    expect(permissions).not.toContain('testID="agent-full-access-notice"')
    expect(permissions).not.toContain("t('agents_run_access_full_description')")
    expect(form).not.toContain('destructive: true')
    expect(form).toContain("runtimeProtection?.level === 'partial'")
    expect(form).toContain('permissionConfirmation: {')
    expect(form).toContain("sessionMode === 'manager'")
    expect(form).toContain('defaultWorkerAgentType: runtimeAdapter')
    expect(form).toContain('defaultWorkerModelId: modelId')
    expect(form).toContain('ellipsizeMode="middle"')
    expect(form).not.toContain('AGENT_WORKSPACE_RUNTIMES')
    expect(form).not.toContain('agent-manager-description')
    expect(form).not.toContain('<AgentBadge')
    expect(form).not.toContain("t('ai_setup_entry')")
    expect(form).not.toContain('agent-preparation-help')
    expect(form).toContain('accessibilityLabel={props.label}')
    expect(form).toContain('visible={projectPickerOpen}')
    expect(form).toContain('showSubmitButton = true')
    expect(form).toContain('onDraftChange?.(draft, canSubmit)')
    expect(form).toContain('onFieldFocus?.(event.target)')
    expect(form).toContain('onFocus={(event) => props.onFocus?.(event.target)}')
    expect(form).toContain('onFocus={onFieldFocus}')
    expect(form).toContain('description.trim()')
    expect(form).toContain('if (initial || machineId || machines.length !== 1) return')
    expect(form).toContain('if (recentMachineProject)')
    expect(form).toContain('setWorkDir(recentMachineProject.workDir)')
    expect(form).not.toContain('accountRuntime.requestMachine(')
    expect(form).not.toContain("{ path: '~', rootPath: '~' }")
    expect(form).not.toContain('<AgentVoiceConfigureControl')
    expect(form).toContain('useImperativeHandle')
    expect(form).toContain('applyAgentVoicePatch')
    expect(form).toContain('{showSubmitButton ? (')
    expect(form).toContain('color: colors.textSecondary')
    expect(form.indexOf('<CreateSelectRow label={t(\'mobile_create_machine\')}')).toBeLessThan(
      form.indexOf('<CreateSelectRow label={t(\'mobile_create_ai_tool\')}'),
    )
    expect(form.indexOf('<CreateSelectRow label={t(\'mobile_create_ai_tool\')}')).toBeLessThan(
      form.indexOf('<CreateSelectRow label={t(\'agents_model\')}'),
    )
    expect(form.indexOf('<CreateSelectRow label={t(\'agents_model\')}')).toBeLessThan(
      form.indexOf('<CreateSelectRow label={t(\'agents_work_directory\')}'),
    )
    expect(form).not.toContain('agents_description_hint')
    expect(form).not.toContain('agents_system_prompt_hint')
  })

  it('uses an accessible two-mode permission editor and only expands restricted details', () => {
    const permissions = read('../features/agents/ManagedAgentPermissionSettings.tsx')

    expect(permissions).not.toContain('agent-file-access-summary')
    expect(permissions).toContain('accessibilityRole="radiogroup"')
    expect(permissions).toContain('accessibilityRole="radio"')
    expect(permissions).toContain("'agents_run_access_help_hide' : 'agents_run_access_help_show'")
    expect(permissions).toContain('testID={`agent-execution-mode-${executionMode}`}')
    expect(permissions).toContain("'native-full', 'restricted'")
    expect(permissions).toContain('setRestrictedUnavailableVisible(true)')
    expect(permissions).toContain('testID="agent-restricted-mode-unavailable"')
    expect(permissions).toContain("'agents_run_access_restricted_unavailable_description'")
    expect(permissions).toContain("mode === 'restricted'")
    expect(permissions).toContain('DEFAULT_NATIVE_FULL_MANAGED_AGENT_PERMISSION_POLICY')
    expect(permissions).not.toContain('fileAccessUnavailable')
    expect(permissions).toContain('testID={`agent-file-access-${fileAccess}`}')
    // Full access saves without a second dialog; only switching to restricted asks first, for every AI.
    expect(permissions).toContain("confirmRestricted(() => applyMode('restricted'))")
    expect(permissions).toContain("'agents_run_access_restricted_confirm_message'")
    expect(permissions).toContain('testID="agent-restricted-mode-warning"')
    expect(permissions).toContain('accessibilityRole="checkbox"')
    expect(permissions).not.toContain('capabilityUnavailable')
    expect(permissions).toContain('disabled={capabilityDisabled}')
    expect(permissions).not.toContain('name="checkmark"')
    expect(permissions).not.toContain('radio-button-on')
    expect(permissions).not.toContain('styles.radio')
    expect(permissions).toContain('minHeight: 44')
    expect(permissions).toContain("t('agents_file_access_help')")
    expect(permissions).toContain("t('agents_external_capabilities_help')")
    expect(permissions).toContain("'commandNetwork'")
    expect(permissions).toContain("'webSearch'")
    expect(permissions).toContain("'browser'")
    expect(permissions).toContain("'computerUse'")
    expect(permissions).toContain("'mcp'")
  })

  it('hides the run-access editor by default and only reveals it for an already-restricted agent', () => {
    const form = read('../features/agents/AgentWorkspaceForm.tsx')
    const desktop = read('../features/desktop-agents/DesktopAgentWorkspaceForm.tsx')

    expect(form).toContain(
      "const showPermissionSection = initial\n    ? managedAgentExecutionMode(resolveManagedAgentPermissionPolicy(initial.permissionPolicy, 'legacy')) === 'restricted'\n    : false",
    )
    expect(form).toContain('{showPermissionSection ? (')
    expect(form.indexOf('{showPermissionSection ? (')).toBeLessThan(
      form.indexOf('<ManagedAgentPermissionSettings'),
    )
    expect(desktop).toContain(
      "const showPermissionSection = initial\n    ? managedAgentExecutionMode(resolveManagedAgentPermissionPolicy(initial.permissionPolicy, 'legacy')) === 'restricted'\n    : false",
    )
    expect(desktop).toContain('{showPermissionSection ? (')
    expect(desktop.indexOf('{showPermissionSection ? (')).toBeLessThan(
      desktop.indexOf('<ManagedAgentPermissionSettings'),
    )
  })

  it('keeps the dormant voice configuration client compatible without exposing it in forms', () => {
    const control = read('../features/agents/AgentVoiceConfigureControl.tsx')
    const hook = read('../features/agents/useAgentVoiceConfiguration.ts')
    expect(control).toContain('delayLongPress={220}')
    expect(control).toContain('onLongPress')
    expect(control).toContain('onPressOut')
    expect(control).toContain("t('agents_voice_hold')")
    expect(control).toContain('testID="agent-voice-undo"')
    const voiceBar = read('../features/agents/AgentWorkspaceVoiceBar.tsx')
    expect(voiceBar).toContain('<AgentVoiceConfigureControl')
    expect(voiceBar).toContain('paddingBottom: Math.max(insets.bottom, 10)')
    expect(hook).toContain(
      'agentAccountClient.configureAgentDraft<AgentVoiceConfigurationResponse>',
    )
    expect(hook).toContain('createPcmRecorder(DEFAULT_PCM_OPTIONS)')
    expect(hook).toContain('createAsrClient(')
    expect(hook).not.toContain("method: 'PATCH'")
    expect(hook).not.toContain("method: 'POST',\n          body: JSON.stringify(draft)")

    const create = read('../features/agents/screens/AgentNewScreen.tsx')
    const settings = read('../features/agents/screens/AgentEditScreen.tsx')
    expect(create).not.toContain('<AgentWorkspaceVoiceBar')
    expect(settings).not.toContain('<AgentWorkspaceVoiceBar')
  })

  it('uses the complete draft for create requests', () => {
    const create = read('../features/agents/screens/AgentNewScreen.tsx')
    const keyboardScroll = read('../features/agents/useAgentWorkspaceKeyboardScroll.ts')
    expect(create).toContain('createAgentWithAvatar({')
    expect(create).toContain('accountId, draft, isCurrent,')
    expect(create).not.toContain('authApi')
    expect(create).toContain("'agent.workspace.validate'")
    expect(create).toContain('accountRuntime.requestMachine(')
    expect(create).toContain('<AgentWorkspaceValidationModal')
    expect(create).toContain('action="create"')
    expect(create).toContain("phase: 'validating'")
    expect(create).toContain("phase: 'saving'")
    expect(create).toContain('agentValidationMessageKey')
    expect(create).toContain('testID="agent-create-header"')
    expect(create).not.toContain('<AgentWorkspaceVoiceBar')
    expect(create).toContain('testID="agent-create-scroll"')
    expect(create).toContain("automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}")
    expect(create).toContain('keyboardDismissMode="none"')
    expect(create).toContain('keyboardShouldPersistTaps="always"')
    expect(create).toContain('useAgentWorkspaceKeyboardScroll(insets.top)')
    expect(create).toContain('onFieldFocus={revealFocusedField}')
    expect(create).toContain('testID="agent-create-keyboard-spacer"')
    expect(create).toContain('style={{ height: keyboardHeight }}')
    expect(keyboardScroll).toContain("Keyboard.addListener('keyboardDidShow'")
    expect(keyboardScroll).toContain(
      "Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'",
    )
    expect(keyboardScroll).toContain('setKeyboardHeight(event.endCoordinates.height)')
    expect(keyboardScroll).toContain(
      "Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'",
    )
    expect(keyboardScroll).toContain('requestAnimationFrame(scrollFocusedFieldIntoView)')
    expect(keyboardScroll).toContain('Keyboard.isVisible()')
    expect(keyboardScroll).toContain('scrollResponderScrollNativeHandleToKeyboard(')
    expect(keyboardScroll).toContain('safeAreaTop + HEADER_HEIGHT + KEYBOARD_GAP')
    expect(create).toContain('<AgentAvatarDraftEditor')
    expect(create).toContain('showSubmitButton={false}')
    expect(create).toContain('formRef.current?.prepareSubmit()')
    expect(create).not.toContain('error instanceof Error ? error.message : String(error)')
    expect(create).toContain("returnTo === 'room-agent-add' && roomId")
    expect(create).toContain('router.dismissTo({')
    expect(create).toContain("pathname: '/(main)/spaces/agent-add'")
    expect(create).toContain('params: { roomId, createdAgentId }')

    const settings = read('../features/agents/screens/AgentEditScreen.tsx')
    expect(settings).toContain("t('agents_save_failed')")
    expect(settings).toContain('agentWorkspaceRequiresConversationRestart')
    expect(settings).toContain(
      "t(requiresRestart ? 'agents_saved_restarting_conversations' : 'agents_saved')",
    )
    expect(settings).toContain('<Toast')
    expect(settings).toContain('agentWorkspaceRequiresValidation')
    expect(settings).toContain("'agent.workspace.validate'")
    expect(settings).toContain('<AgentWorkspaceValidationModal')
    expect(settings).toContain('action="save"')
    expect(settings.indexOf("'agent.workspace.validate'")).toBeLessThan(
      settings.indexOf('await editor.save(nextDraft)'),
    )
    expect(settings).toContain('showSubmitButton={false}')
    expect(settings).toContain('testID="agent-save-header"')
    expect(settings).toContain('formRef.current?.prepareSubmit()')
    expect(settings).not.toContain('<AgentWorkspaceVoiceBar')
    expect(settings).toContain('testID="agent-edit-scroll"')
    expect(settings).toContain("automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}")
    expect(settings).toContain('keyboardDismissMode="none"')
    expect(settings).toMatch(/useAgentWorkspaceKeyboardScroll\(\s*insets\.top,\s*\)/)
    expect(settings).toContain('onFieldFocus={revealFocusedField}')
    expect(settings).toContain('testID="agent-edit-keyboard-spacer"')
    expect(settings).toContain('keyboardShouldPersistTaps="always"')
    expect(settings).toContain('agentWorkspaceDraftSignature(draft)')
    expect(settings).not.toContain("navigation.addListener('beforeRemove'")
    expect(settings).not.toContain("t('agents_save_changes')")
    expect(settings).not.toContain("t('agents_discard_changes')")
    expect(settings).not.toContain("t('agents_continue_editing')")
    expect(settings).not.toContain('router.back()\n    } catch')
    expect(settings).not.toContain('error instanceof Error ? error.message : String(error)')
  })
})
