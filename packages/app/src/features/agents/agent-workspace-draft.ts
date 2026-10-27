// @arch docs/features/agent-workspaces.md
// @test src/__tests__/agent-workspace-draft.test.ts

import { resolveManagedAgentPermissionPolicy, type AgentWorkspace } from '@shennian/wire'
import type { AgentWorkspaceDraft } from './AgentWorkspaceForm'

export function toAgentWorkspaceDraft(agent: AgentWorkspace): AgentWorkspaceDraft {
  return {
    displayName: agent.displayName.trim(),
    description: agent.description.trim(),
    systemPrompt: agent.systemPrompt.trim(),
    machineId: agent.machineId,
    runtimeAdapter: agent.runtimeAdapter,
    workDir: agent.workDir.trim(),
    modelId: agent.modelId,
    sessionMode: agent.sessionMode,
    managerConfig: agent.managerConfig,
    permissionPolicy: resolveManagedAgentPermissionPolicy(agent.permissionPolicy),
  }
}

export function agentWorkspaceDraftSignature(draft: AgentWorkspaceDraft): string {
  return JSON.stringify({
    displayName: draft.displayName,
    description: draft.description,
    systemPrompt: draft.systemPrompt,
    machineId: draft.machineId,
    runtimeAdapter: draft.runtimeAdapter,
    workDir: draft.workDir,
    modelId: draft.modelId,
    sessionMode: draft.sessionMode,
    managerConfig: draft.managerConfig,
    permissionPolicy: resolveManagedAgentPermissionPolicy(draft.permissionPolicy),
  })
}

export function agentWorkspaceRequiresConversationRestart(
  current: AgentWorkspaceDraft,
  next: AgentWorkspaceDraft,
): boolean {
  return (
    current.machineId !== next.machineId ||
    current.runtimeAdapter !== next.runtimeAdapter ||
    current.workDir.trim() !== next.workDir.trim()
  )
}

/** Public profile edits do not need a new temporary Agent conversation. */
export function agentWorkspaceRequiresValidation(
  current: AgentWorkspaceDraft,
  next: AgentWorkspaceDraft,
): boolean {
  return (
    agentWorkspaceDraftSignature({ ...current, displayName: '', description: '' }) !==
    agentWorkspaceDraftSignature({ ...next, displayName: '', description: '' })
  )
}
