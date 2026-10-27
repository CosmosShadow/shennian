// @arch docs/features/desktop-local-first-client-todo.md
// @test ../../__tests__/desktop-agent-save.test.ts
import { requireDesktopAccountSyncBridge } from '../desktop-control/desktopAccountRuntime'
import type { DesktopAgentWorkspaceDraft } from './desktopAgentWorkspaceDraft'

export type DesktopAgentSaveInput = { operationId: string; agentId?: string; draft: DesktopAgentWorkspaceDraft }
export type DesktopAgentSaveResult = { agentId: string; requiresRestart: boolean }
export async function saveDesktopAgent(input: DesktopAgentSaveInput): Promise<DesktopAgentSaveResult> {
  const result = await requireDesktopAccountSyncBridge().command({ requestId: crypto.randomUUID(), operation: 'agent.editor.save', args: [input] })
  if (!result.ok) throw new Error(result.error.message)
  const value = result.value as Partial<DesktopAgentSaveResult> | null
  if (!value || typeof value.agentId !== 'string' || !value.agentId || typeof value.requiresRestart !== 'boolean' || (input.agentId && value.agentId !== input.agentId)) throw new Error('agent_save_uncertain')
  return value as DesktopAgentSaveResult
}

export function createDesktopAgentSaveController(deps: {
  isCurrent(): boolean
  operationId(): string
  save(input: DesktopAgentSaveInput): Promise<DesktopAgentSaveResult>
}) {
  let generation = 0
  let active = false
  let pending: symbol | null = null
  let attempt: { input: DesktopAgentSaveInput; signature: string; state: 'retry' | 'projection' | 'uncertain' | 'done' } | null = null
  return {
    start() { active = true; generation += 1 },
    stop() { active = false; generation += 1 },
    async submit(draft: DesktopAgentWorkspaceDraft, agentId?: string): Promise<DesktopAgentSaveResult | null> {
      if (!active || !deps.isCurrent() || pending) return null
      if (attempt?.state === 'uncertain') throw new Error('agent_save_uncertain')
      if (attempt?.state === 'done' && !agentId) return null
      const signature = JSON.stringify({ agentId, draft })
      if (attempt?.state === 'projection' && signature !== attempt.signature) throw new Error('agent_projection_pending')
      if (!attempt || attempt.signature !== signature || attempt.state === 'done') attempt = {
        input: { operationId: deps.operationId(), ...(agentId ? { agentId } : {}), draft }, signature, state: 'retry',
      }
      const currentAttempt = attempt
      const epoch = generation
      const request = Symbol()
      pending = request
      try {
        const result = await deps.save(currentAttempt.input)
        currentAttempt.state = 'done'
        return active && generation === epoch && deps.isCurrent() ? result : null
      } catch (error) {
        const message = error instanceof Error ? error.message : ''
        currentAttempt.state = message === 'agent_projection_pending' ? 'projection'
          : message.startsWith('agent_validation_failed:') || ['agent_save_failed', 'agent_editor_busy', 'agent_operation_mismatch', 'agent_editor_limit', 'agent_account_changed'].includes(message) ? 'retry' : 'uncertain'
        if (active && generation === epoch && deps.isCurrent()) throw error
        return null
      } finally { if (pending === request) pending = null }
    },
  }
}
