// @arch docs/features/agent-provider-config.md
// @test src/__tests__/acp-agent-presentation.test.ts
import type { AgentInfo, Machine } from '@shennian/wire'

type PreparationRequest = (machineId: string, method: 'agent.workspace.validate', params: Record<string, unknown>, options: {
  connectTimeoutMs: number; responseTimeoutMs: number
}) => Promise<{ ok: boolean; error?: string; payload?: unknown }>

/** Explicit model request; never called by discovery/refresh. */
export async function testAgentPreparationReply(machine: Machine, agentType: string, workDir: string,
  modelId: string | null, request: PreparationRequest): Promise<void> {
  if (!machine.online) throw new Error('not connected')
  if (machine.role === 'granted') throw new Error('agent_preparation_owner_required')
  if (!machine.agentList.includes(agentType as never)) throw new Error('agent_validation_runtime_unavailable')
  if (!workDir.trim()) throw new Error('agent_validation_workdir_invalid')
  const response = await request(machine.id, 'agent.workspace.validate', {
    runtimeAdapter: agentType, workDir: workDir.trim(), modelId, sessionMode: 'standard',
  }, { connectTimeoutMs: 10_000, responseTimeoutMs: 70_000 })
  if (!response.ok) throw new Error(response.error || 'agent_validation_response_failed')
  if (!response.payload || typeof response.payload !== 'object' || !('ready' in response.payload)
    || response.payload.ready !== true) throw new Error('agent_validation_response_failed')
}
export type AgentPreparationState =
  | 'offline'
  | 'owner'
  | 'missing'
  | 'version'
  | 'configuration'
  | 'login'
  | 'unknown'
  | 'authenticated'
export function getAgentPreparationState(
  machine: Machine,
  agentType: string,
  info?: AgentInfo,
): AgentPreparationState {
  if (!machine.online) return 'offline'
  if (machine.role === 'granted') return 'owner'
  if (!machine.agentList.includes(agentType as never)) return 'missing'
  if (info?.runtime?.compatibility === 'version_mismatch') return 'version'
  if (info?.authState === 'error' || info?.config?.status === 'error') return 'configuration'
  if (info?.authState === 'required') return 'login'
  if (info?.authState === 'ready') return 'authenticated'
  return 'unknown'
}
/**
 * A Windows Client no longer falls back to a Codex installed inside WSL, so a missing
 * Windows Codex needs its own explanation rather than the generic install steps.
 */
export function needsWindowsCodexHint(os: string, agentType: string, state: AgentPreparationState): boolean {
  return state === 'missing' && /win/i.test(os) && agentType.replace(/^(builtin:|catalog:)/, '') === 'codex'
}
export function getAgentPreparationLinks(
  type: string,
): { install: string; login: string; command?: string } | null {
  const id = type.replace(/^(builtin:|catalog:|acp:)/, '')
  if (id === 'codex' || id === 'codex-acp')
    return {
      install: 'https://learn.chatgpt.com/docs/codex/cli',
      login: 'https://learn.chatgpt.com/docs/auth',
      command: 'codex login',
    }
  if (id === 'claude' || id === 'claude-acp')
    return {
      install: 'https://code.claude.com/docs/en/setup',
      login: 'https://code.claude.com/docs/en/authentication',
      command: 'claude auth login',
    }
  if (id === 'cursor')
    return {
      install: 'https://cursor.com/docs/cli/installation',
      login: 'https://cursor.com/docs/cli/reference/authentication',
      command: 'agent login',
    }
  if (id === 'opencode')
    return {
      install: 'https://opencode.ai/docs/',
      login: 'https://opencode.ai/docs/providers/',
      command: 'opencode auth login',
    }
  return null
}
