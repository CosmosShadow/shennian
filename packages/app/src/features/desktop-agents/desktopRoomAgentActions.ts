// @arch docs/features/network-rooms/ui.md#九受管智能体与-room-workspace
// @test ../../__tests__/desktop-room-agent-actions.test.ts
import type { NianSession } from '@shennian/wire'
import { requireDesktopAccountSyncBridge } from '../desktop-control/desktopAccountRuntime'

export type DesktopRoomAgentAction = 'restart' | 'remove'
export type DesktopRoomAgentActionTarget = { roomId: string; agentIdentityId: string; memberId: string; bindingId: string; sessionId: string }
export type DesktopRoomAgentActionInput = DesktopRoomAgentActionTarget & { operationId: string }
export type DesktopRoomAgentRestartResult = { previousSessionId: string; session: NianSession }
export type DesktopRoomAgentActionResult = DesktopRoomAgentRestartResult | { removed: true }
export type DesktopRoomAgentActionState = { busy: DesktopRoomAgentAction | null; error: string | null; blocked: boolean }

export async function executeDesktopRoomAgentAction(action: DesktopRoomAgentAction, input: DesktopRoomAgentActionInput): Promise<DesktopRoomAgentActionResult> {
  const result = await requireDesktopAccountSyncBridge().command({ requestId: crypto.randomUUID(), operation: `room.agent.${action}`, args: [input] })
  if (!result.ok) throw new Error(result.error.message)
  const value = result.value as Partial<DesktopRoomAgentRestartResult & { removed: true }> | null
  if (action === 'remove') {
    if (value?.removed !== true) throw new Error('room_agent_result_unknown')
    return { removed: true }
  }
  if (!value || value.previousSessionId !== input.sessionId || !value.session?.id || value.session.id === input.sessionId ||
    value.session.agentIdentityId !== input.agentIdentityId) throw new Error('room_agent_result_unknown')
  return { previousSessionId: value.previousSessionId, session: value.session }
}

const safeFailures = new Set(['room_agent_busy', 'room_agent_session_running', 'room_agent_machine_offline', 'room_agent_binding_unavailable', 'account_changed'])
/** Only confirmation creates an intent. Reconciliation always uses that same intent. */
export function createDesktopRoomAgentActions(deps: {
  isCurrent(): boolean
  operationId(): string
  execute(action: DesktopRoomAgentAction, input: DesktopRoomAgentActionInput): Promise<DesktopRoomAgentActionResult>
  publish(state: DesktopRoomAgentActionState): void
  committed(action: DesktopRoomAgentAction, result: DesktopRoomAgentActionResult): Promise<void>
  refresh(): Promise<void>
}) {
  let active = false, epoch = 0
  let pending: symbol | null = null
  let attempt: { action: DesktopRoomAgentAction; input: DesktopRoomAgentActionInput; result?: DesktopRoomAgentActionResult } | null = null
  let state: DesktopRoomAgentActionState = { busy: null, error: null, blocked: false }
  const publish = (next: DesktopRoomAgentActionState) => { state = next; deps.publish(next) }
  async function run() {
    if (!active || !deps.isCurrent() || !attempt || pending) return
    const currentAttempt = attempt, generation = epoch, request = Symbol()
    const current = () => active && epoch === generation && deps.isCurrent()
    pending = request
    publish({ ...state, busy: currentAttempt.action, error: null })
    try {
      // Retain a known main receipt even if a local callback later fails or the view stops.
      currentAttempt.result ??= await deps.execute(currentAttempt.action, currentAttempt.input)
      if (!current()) return
      await deps.committed(currentAttempt.action, currentAttempt.result)
      if (current()) { attempt = null; publish({ busy: null, error: null, blocked: false }) }
    } catch (cause) {
      if (!current()) return
      const error = currentAttempt.result ? 'room_agent_projection_pending' : cause instanceof Error ? cause.message : 'room_agent_result_unknown'
      publish({ busy: currentAttempt.action, error, blocked: !safeFailures.has(error) })
      // Refresh is observational: its failure must not replace the transaction
      // error or escape a fire-and-forget confirmation callback.
      try { await deps.refresh() } catch { /* Preserve the failed intent for explicit reconciliation. */ }
    } finally {
      if (pending === request) {
        pending = null
        if (current()) publish({ ...state, busy: null })
      }
    }
  }
  return {
    start() { active = true; epoch += 1; deps.publish(state) },
    stop() {
      active = false; epoch += 1
      if (pending) {
        pending = null
        publish({ busy: null, error: 'room_agent_result_unknown', blocked: true })
      }
    },
    async submit(action: DesktopRoomAgentAction, target: DesktopRoomAgentActionTarget) {
      if (!active || !deps.isCurrent() || pending || state.blocked) return
      attempt = { action, input: { ...target, operationId: deps.operationId() } }
      await run()
    },
    reconcile: run,
  }
}
