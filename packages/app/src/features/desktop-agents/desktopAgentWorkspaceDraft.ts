// @arch docs/features/agent-workspaces.md
// @arch docs/features/managed-agent-restricted-runtime.md
// @test ../../__tests__/desktop-agent-workspace-draft.test.ts
import {
  DEFAULT_NATIVE_FULL_MANAGED_AGENT_PERMISSION_POLICY,
  agentInfoSupportsAgent,
  agentInfoSupportsExecutionMode,
  managedAgentExecutionMode,
  parseManagedAgentPermissionPolicy,
  resolveManagedAgentPermissionPolicy,
  type AgentWorkspace, type AgentInfo, type Machine, type NianSession,
  type ManagedAgentPermissionPolicy, type ManagedAgentPermissionConfirmationRequest,
} from '@shennian/wire'

export type DesktopAgentWorkspaceDraft = Pick<AgentWorkspace,
  'displayName' | 'description' | 'systemPrompt' | 'machineId' | 'workDir' |
  'runtimeAdapter' | 'modelId' | 'sessionMode' | 'managerConfig'> & {
    permissionPolicy: ManagedAgentPermissionPolicy
    permissionConfirmation?: ManagedAgentPermissionConfirmationRequest
  }

export function desktopAgentWorkspaceToDraft(initial: AgentWorkspace): DesktopAgentWorkspaceDraft | null {
  const permissionPolicy = parseManagedAgentPermissionPolicy(initial.permissionPolicy)
  if (!permissionPolicy) return null
  return normalizeDesktopAgentDraft({
    displayName: initial.displayName,
    description: initial.description,
    systemPrompt: initial.systemPrompt,
    machineId: initial.machineId,
    workDir: initial.workDir,
    runtimeAdapter: initial.runtimeAdapter,
    modelId: initial.modelId,
    sessionMode: initial.sessionMode,
    managerConfig: initial.managerConfig,
    permissionPolicy,
  })
}

export function desktopAgentDraftSignature(draft: DesktopAgentWorkspaceDraft): string {
  const value = normalizeDesktopAgentDraft(draft)
  return JSON.stringify({
    displayName: value.displayName,
    description: value.description,
    systemPrompt: value.systemPrompt,
    machineId: value.machineId,
    runtimeAdapter: value.runtimeAdapter,
    workDir: value.workDir,
    modelId: value.modelId,
    sessionMode: value.sessionMode,
    managerConfig: value.managerConfig,
    permissionPolicy: value.permissionPolicy,
  })
}

/** Rich daemon capabilities are authoritative; no provider or legacy-list fallback. */
export function desktopManagedRuntimes(machine?: Machine): AgentInfo[] {
  return (machine?.agents ?? []).filter(agentInfoSupportsAgent)
}

export function desktopAgentProjects(sessions: NianSession[]): NianSession[] {
  const seen = new Set<string>()
  return sessions.filter(session => {
    const key = `${session.machineId}\0${session.workDir}`
    if (session.status !== 'active' || session.canManage === false || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function desktopAgentDefaultModel(runtime?: AgentInfo): string | null {
  const models = runtime?.models ?? []
  const selected = models.find(model => model.isDefault || model.id === 'default') ?? (models.length === 1 ? models[0] : undefined)
  return selected && !selected.isDefault && selected.id !== 'default' ? selected.id : null
}

export function createDesktopAgentDraft(initial: AgentWorkspace | undefined, machines: Machine[], projects: NianSession[]): DesktopAgentWorkspaceDraft {
  const initialDraft = initial ? desktopAgentWorkspaceToDraft(initial) : null
  if (initial && !initialDraft) throw new Error('agent_permission_policy_missing')
  const project = projects[0]
  const machineId = initial?.machineId ?? project?.machineId ?? (machines.length === 1 ? machines[0]!.id : '')
  const runtimes = desktopManagedRuntimes(machines.find(machine => machine.id === machineId))
  const runtime = runtimes.find(item => item.type === project?.agentType) ?? (runtimes.length === 1 ? runtimes[0] : undefined)
  return {
    displayName: initial?.displayName ?? '', description: initial?.description ?? '', systemPrompt: initial?.systemPrompt ?? '',
    machineId, workDir: initial?.workDir ?? project?.workDir ?? '',
    runtimeAdapter: initial?.runtimeAdapter ?? runtime?.type ?? null,
    modelId: initial ? initial.modelId : runtime?.type === project?.agentType ? project?.modelId ?? desktopAgentDefaultModel(runtime) : desktopAgentDefaultModel(runtime),
    sessionMode: initial?.sessionMode ?? 'standard', managerConfig: initial?.managerConfig ?? null,
    permissionPolicy: initialDraft?.permissionPolicy ?? {
      ...DEFAULT_NATIVE_FULL_MANAGED_AGENT_PERMISSION_POLICY,
      externalCapabilities: { ...DEFAULT_NATIVE_FULL_MANAGED_AGENT_PERMISSION_POLICY.externalCapabilities },
    },
  }
}

export function normalizeDesktopAgentDraft(draft: DesktopAgentWorkspaceDraft): DesktopAgentWorkspaceDraft {
  return { ...draft, displayName: draft.displayName.trim(), description: draft.description.trim(), systemPrompt: draft.systemPrompt.trim(), workDir: draft.workDir.trim(),
    managerConfig: draft.sessionMode === 'manager' ? { ...draft.managerConfig, defaultWorkerAgentType: draft.runtimeAdapter, defaultWorkerModelId: draft.modelId } : null }
}

export function desktopAgentDraftComplete(draft: DesktopAgentWorkspaceDraft): boolean {
  return !!(draft.displayName.trim() && draft.description.trim() && draft.machineId && draft.workDir.trim() && draft.runtimeAdapter)
}

function runtimeSignature(draft: DesktopAgentWorkspaceDraft): string {
  const value = normalizeDesktopAgentDraft(draft)
  return JSON.stringify([value.systemPrompt, value.machineId, value.workDir, value.runtimeAdapter,
    value.modelId, value.sessionMode, value.managerConfig, resolveManagedAgentPermissionPolicy(value.permissionPolicy)])
}

/** Called at explicit Save/Create time against the latest main projection. */
export function prepareDesktopAgentDraft(draft: DesktopAgentWorkspaceDraft, machines: Machine[], initial?: AgentWorkspace): DesktopAgentWorkspaceDraft | null {
  if (!desktopAgentDraftComplete(draft)) return null
  // Public identity edits neither start a runtime nor replace its existing authorization.
  const initialDraft = initial ? desktopAgentWorkspaceToDraft(initial) : null
  if (initial && !initialDraft) return null
  if (initialDraft && runtimeSignature(draft) === runtimeSignature(initialDraft)) {
    const prepared = normalizeDesktopAgentDraft(draft)
    delete prepared.permissionConfirmation
    return prepared
  }
  const runtime = desktopManagedRuntimes(machines.find(machine => machine.id === draft.machineId)).find(item => item.type === draft.runtimeAdapter)
  if (!runtime || (draft.sessionMode === 'manager' && runtime.supportsManagerMode !== true)) return null
  const executionMode = managedAgentExecutionMode(draft.permissionPolicy)
  const nativeFull = executionMode === 'native-full'
  if (!agentInfoSupportsExecutionMode(runtime, executionMode)) return null
  const protection = runtime.managedAgentProtection
  const hostFullAccess = nativeFull || draft.permissionPolicy.fileAccess === 'host-full'
  const limitedProtection = !nativeFull && protection?.level === 'partial'
  const prepared = normalizeDesktopAgentDraft(draft)
  delete prepared.permissionConfirmation
  if (hostFullAccess || limitedProtection) {
    if (!protection?.executableFingerprint) return null
    prepared.permissionConfirmation = { runtimeAdapter: runtime.type, runtimeVersion: protection.runtimeVersion,
      platform: protection.platform, executableFingerprint: protection.executableFingerprint,
      executionMode, hostFullAccess, limitedProtection }
  }
  return prepared
}
