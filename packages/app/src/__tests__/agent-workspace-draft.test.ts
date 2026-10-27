import { agentValidationMessageKey } from '../features/agents/agentWorkspaceValidation'
// @covers src/features/agents/agent-workspace-draft.ts
// @covers src/features/agents/screens/AgentEditScreen.tsx

import { describe, expect, it } from 'vitest'
import type { AgentWorkspace } from '@shennian/wire'
import type { AgentWorkspaceDraft } from '../features/agents/AgentWorkspaceForm'
import {
  agentWorkspaceDraftSignature,
  agentWorkspaceRequiresConversationRestart,
  agentWorkspaceRequiresValidation,
  toAgentWorkspaceDraft,
} from '../features/agents/agent-workspace-draft'

const values = {
  displayName: '客服',
  description: '回答问题',
  systemPrompt: '保持简洁',
  machineId: 'machine-1',
  runtimeAdapter: 'codex' as const,
  workDir: '/workspace',
  modelId: 'gpt-5.6-sol',
  sessionMode: 'standard' as const,
  managerConfig: null,
  permissionPolicy: {
    version: 1,
    fileAccess: 'workspace-write' as const,
    externalCapabilities: {
      commandNetwork: false,
      webSearch: false,
      browser: false,
      computerUse: false,
      mcp: false,
    },
  },
}

describe('Agent workspace draft signature', () => {
  it('treats identical drafts as unchanged regardless of property insertion order', () => {
    const saved = {
      ...values,
      managerConfig: null,
      permissionPolicy: values.permissionPolicy,
    } satisfies AgentWorkspaceDraft
    const form = {
      displayName: values.displayName,
      description: values.description,
      systemPrompt: values.systemPrompt,
      machineId: values.machineId,
      runtimeAdapter: values.runtimeAdapter,
      workDir: values.workDir,
      modelId: values.modelId,
      sessionMode: values.sessionMode,
      permissionPolicy: values.permissionPolicy,
      managerConfig: null,
    } satisfies AgentWorkspaceDraft

    expect(JSON.stringify(saved)).not.toBe(JSON.stringify(form))
    expect(agentWorkspaceDraftSignature(saved)).toBe(agentWorkspaceDraftSignature(form))
  })

  it('ignores transient permission confirmation but detects persisted changes', () => {
    const confirmed = {
      ...values,
      permissionConfirmation: {
        runtimeAdapter: 'codex' as const,
        runtimeVersion: '1.0.0',
        platform: 'darwin',
        executableFingerprint: 'sha256:test',
        hostFullAccess: false,
        limitedProtection: false,
      },
    } satisfies AgentWorkspaceDraft
    const changed = {
      ...values,
      permissionPolicy: {
        ...values.permissionPolicy,
        externalCapabilities: {
          ...values.permissionPolicy.externalCapabilities,
          webSearch: true,
        },
      },
    } satisfies AgentWorkspaceDraft

    expect(agentWorkspaceDraftSignature(confirmed)).toBe(agentWorkspaceDraftSignature(values))
    expect(agentWorkspaceDraftSignature(changed)).not.toBe(agentWorkspaceDraftSignature(values))
  })

  it.each([
    ['machine', { machineId: 'machine-2' }],
    ['working directory', { workDir: '/other' }],
    ['runtime Agent', { runtimeAdapter: 'claude' as const }],
  ])('requires conversation restart when the %s changes', (_label, patch) => {
    expect(agentWorkspaceRequiresConversationRestart(values, { ...values, ...patch })).toBe(true)
  })

  it.each([
    ['display name', { displayName: '新客服' }],
    ['description', { description: '新的介绍' }],
    ['system prompt', { systemPrompt: '新的提示词' }],
    ['model', { modelId: 'gpt-5.6-terra' }],
    ['work mode', { sessionMode: 'manager' as const }],
    [
      'permissions',
      {
        permissionPolicy: {
          ...values.permissionPolicy,
          fileAccess: 'workspace-read' as const,
        },
      },
    ],
  ])('preserves conversations when only the %s changes', (_label, patch) => {
    expect(agentWorkspaceRequiresConversationRestart(values, { ...values, ...patch })).toBe(false)
  })
})

describe('existing agents keep their saved settings', () => {
  it('does not upgrade a saved restricted policy or drop delegated work when reopening', () => {
    const saved = {
      ...values,
      sessionMode: 'manager',
      managerConfig: { defaultWorkerAgentType: 'codex', defaultWorkerModelId: 'gpt-5.6-sol' },
    } as unknown as AgentWorkspace
    const draft = toAgentWorkspaceDraft(saved)

    expect(draft.sessionMode).toBe('manager')
    expect(draft.managerConfig).toEqual(saved.managerConfig)
    // Legacy policies carry no executionMode and must keep resolving to restricted, never native-full.
    expect(draft.permissionPolicy.executionMode).toBe('restricted')
  })
})

describe('editing validation scope', () => {
  it('skips unchanged drafts and public profile changes', () => {
    expect(agentWorkspaceRequiresValidation(values, { ...values })).toBe(false)
    expect(
      agentWorkspaceRequiresValidation(values, {
        ...values,
        displayName: 'New name',
        description: 'New description',
      }),
    ).toBe(false)
  })

  it.each([
    { machineId: 'machine-2' },
    { runtimeAdapter: 'claude' as const },
    { workDir: '/other' },
    { modelId: 'another-model' },
    { sessionMode: 'manager' as const },
    { systemPrompt: 'New prompt' },
    { managerConfig: { defaultWorkerAgentType: 'claude' as const, defaultWorkerModelId: null } },
    { permissionPolicy: { ...values.permissionPolicy, fileAccess: 'host-full' as const } },
    { permissionPolicy: { ...values.permissionPolicy, executionMode: 'native-full' as const } },
    {
      permissionPolicy: {
        ...values.permissionPolicy,
        externalCapabilities: {
          ...values.permissionPolicy.externalCapabilities,
          browser: true,
        },
      },
    },
  ])('tests non-profile changes: %j', (patch) => {
    expect(agentWorkspaceRequiresValidation(values, { ...values, ...patch })).toBe(true)
  })
})

describe('shared validation errors', () => {
  it.each([
    ['agent_validation_workdir_not_found', 'agents_validation_workdir_not_found'],
    ['agent_validation_response_timeout', 'agents_validation_response_timeout'],
    ['agent_validation_runtime_auth_required', 'agents_validation_runtime_auth_required'],
    ['unknown method: agent.workspace.validate', 'agents_validation_upgrade_required'],
    ['not connected', 'agents_validation_machine_unreachable'],
  ])('classifies %s for either entry point', (error, expected) => {
    expect(agentValidationMessageKey(new Error(error), 'agents_save_failed')).toBe(expected)
  })
  it('keeps creation and editing fallback errors distinct', () => {
    expect(agentValidationMessageKey('unexpected')).toBe('agents_create_failed')
    expect(agentValidationMessageKey('unexpected', 'agents_save_failed')).toBe('agents_save_failed')
  })
})
