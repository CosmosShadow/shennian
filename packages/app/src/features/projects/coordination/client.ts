// @arch docs/features/project-coordination.md
// @test src/__tests__/project-coordination.test.ts
import { authApi } from '../../../config/api'
export type CoordinationTask = { id: string; title: string; status: string; priority: number; waitingReason?: string; result?: string; agentType: string }
export type CoordinationQuestion = { id: string; question: string; taskId?: string; options: string[]; at: number; answer?: string; answeredAt?: number }
export type CoordinationSnapshot = {
  enabled: boolean; paused: boolean; mode: 'serial' | 'research_parallel' | 'parallel'; automatic: boolean
  instructionRevision: number; instructions: string; revision: number
  tasks: CoordinationTask[]; messages: { id: string; role: 'user' | 'agent'; text: string; at: number }[]
  managerBusy: boolean; managerError?: string; questions?: CoordinationQuestion[]
  recent?: Array<{ sequence: number; at: number; kind: string }>
}
export type CoordinationFilter = 'all' | 'running' | 'queued' | 'attention'
export function taskMatchesFilter(task: { status: string; waitingReason?: string } | undefined, filter: CoordinationFilter, phase?: string | null) {
  if (filter === 'all') return true
  if (filter === 'attention') return (task?.status === 'waiting' && ['waiting_approval', 'waiting_user_input', 'user_confirmation'].includes(task.waitingReason ?? '')) || ['waiting_approval', 'waiting_user_input'].includes(phase ?? '')
  if (filter === 'running') return task?.status === 'running' || (!task && Boolean(phase) && !['idle', 'waiting_approval', 'waiting_user_input'].includes(phase!))
  return task?.status === 'queued'
}
export function projectCoordinationRequest(machineId: string, workDir: string, input: Record<string, unknown> = {}) {
  return authApi<CoordinationSnapshot>('/project-cli/coordination', {
    method: 'POST', body: JSON.stringify({ ...input, machineId, workDir }),
  }, { timeoutMs: 25000 })
}

/** Only recognized error codes become UI copy; never display an arbitrary response body. */
export function coordinationErrorMessageKey(error: unknown): string {
  let code = error instanceof Error ? error.message : ''
  try {
    const body: unknown = JSON.parse(code)
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') code = body.error
  } catch { /* Local errors already contain their code. */ }
  const messages: Record<string, string> = {
    coordination_wait_for_active_tasks: 'coordination_enable_busy',
    coordination_running_tasks_remain: 'coordination_disable_busy',
    coordination_machine_offline: 'coordination_offline',
  }
  return messages[code] ?? 'coordination_error'
}

export function pendingCoordinationQuestions(state: CoordinationSnapshot | null) {
  return state?.questions?.filter(question => !question.answeredAt) ?? []
}
export function coordinationRows(state: CoordinationSnapshot, sessions: Array<{ id: string; activity?: { runPhase?: string | null } | null }>) {
  const rows = new Map<string, { id: string; task?: CoordinationTask; phase?: string | null }>(state.tasks.map(task => [task.id, { id: task.id, task }]))
  for (const session of sessions) rows.set(session.id, { id: session.id, task: rows.get(session.id)?.task, phase: session.activity?.runPhase })
  return [...rows.values()]
}
export function coordinationCounts(state: CoordinationSnapshot, sessions: Array<{ id: string; activity?: { runPhase?: string | null } | null }> = []) {
  const rows = coordinationRows(state, sessions)
  return { running: rows.filter(row => taskMatchesFilter(row.task, 'running', row.phase)).length,
    queued: rows.filter(row => taskMatchesFilter(row.task, 'queued', row.phase)).length,
    attention: rows.filter(row => taskMatchesFilter(row.task, 'attention', row.phase)).length + pendingCoordinationQuestions(state).length }
}
