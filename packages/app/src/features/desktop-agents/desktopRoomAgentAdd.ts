// @arch docs/features/agent-workspaces.md
// @test ../../__tests__/desktop-room-agent-add-ui.test.ts
import type { RoomActivationMode } from '@shennian/wire'
import { requireDesktopAccountSyncBridge } from '../desktop-control/desktopAccountRuntime'
export type DesktopAgentSelection = { agentIdentityId: string; activationMode: RoomActivationMode }
export type DesktopAddInput = { operationId: string; roomId: string; agents: DesktopAgentSelection[] }
export type DesktopAddResult = { completed: { agentIdentityId: string; sessionId: string; memberId: string; bindingId: string }[]; pendingAgentIds: string[]; failure?: { agentIdentityId: string; code: string; recovery: 'retry' | 'reconcile' | 'blocked' } }
export async function addDesktopRoomAgents(input: DesktopAddInput): Promise<DesktopAddResult> {
  const response = await requireDesktopAccountSyncBridge().command({ requestId: crypto.randomUUID(), operation: 'room.agent.add', args: [input] })
  if (!response.ok) throw new Error(response.error.message)
  const value = response.value as DesktopAddResult | null
  if (!value || !Array.isArray(value.completed) || !Array.isArray(value.pendingAgentIds)) throw new Error('room_agent_result_unknown')
  if (value.completed.some(item => !item || [item.agentIdentityId, item.sessionId, item.memberId, item.bindingId].some(id => typeof id !== 'string' || !id))) throw new Error('room_agent_result_unknown')
  const ids = [...value.completed.map(item => item.agentIdentityId), ...value.pendingAgentIds]
  if (ids.length !== input.agents.length || new Set(ids).size !== ids.length || ids.some(id => !input.agents.some(agent => agent.agentIdentityId === id)) ||
    value.completed.some(item => !item.sessionId || !item.memberId || !item.bindingId) ||
    (value.failure ? !value.pendingAgentIds.includes(value.failure.agentIdentityId) || !['retry', 'reconcile', 'blocked'].includes(value.failure.recovery) : value.pendingAgentIds.length > 0)) throw new Error('room_agent_result_unknown')
  return value
}
export type DesktopAddState = { busy: boolean; result: DesktopAddResult | null; error: string | null; locked: boolean }
/** Account lifetime owns the operation; mounting a view only attaches a listener. */
export function createDesktopRoomAgentAddRegistry(deps: { execute(input: DesktopAddInput): Promise<DesktopAddResult>; operationId(): string }) {
  let account: string | null = null
  const entries = new Map<string, ReturnType<typeof makeEntry>>()
  function makeEntry(accountId: string, roomId: string) {
    let state: DesktopAddState = { busy: false, result: null, error: null, locked: false }
    let selection: DesktopAgentSelection[] = []
    const listeners = new Set<() => void>()
    let valid = true
    const actor = createDesktopRoomAgentAdd({ ...deps, isCurrent: () => valid && account === accountId,
      publish(next) { state = next; for (const listener of listeners) listener() }, done() {},
    })
    actor.start()
    const entry = {
      snapshot: () => state,
      selection: () => selection,
      subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
      submit(_roomId: string, agents: DesktopAgentSelection[]) {
        if (!valid || state.locked) return Promise.resolve()
        selection = agents.map(agent => ({ ...agent }))
        return actor.submit(roomId, selection)
      },
      retry: actor.retry,
      releaseCompleted() { if (state.result?.pendingAgentIds.length === 0 && entries.get(roomId) === entry) { entries.delete(roomId); entry.dispose() } },
      dispose() { valid = false; actor.stop(); listeners.clear() },
    }
    return entry
  }
  // A completed entry is removed only after its view has consumed the receipt.
  function get(accountId: string, roomId: string) {
    setAccount(accountId)
    let entry = entries.get(roomId)
    if (!entry) { entry = makeEntry(accountId, roomId); entries.set(roomId, entry) }
    return entry
  }
  function setAccount(next: string | null) {
    if (next === account) return
    for (const entry of entries.values()) entry.dispose()
    entries.clear(); account = next
  }
  return { get, setAccount }
}
export function createDesktopRoomAgentAdd(deps: { isCurrent(): boolean; execute(input: DesktopAddInput): Promise<DesktopAddResult>; publish(state: DesktopAddState): void; operationId(): string; done(): void }) {
  let active = false, epoch = 0, pending = false
  let attempt: DesktopAddInput | null = null
  let state: DesktopAddState = { busy: false, result: null, error: null, locked: false }
  const publish = (next: DesktopAddState) => { state = next; deps.publish(next) }
  async function run() {
    if (!active || !deps.isCurrent() || pending || !attempt || state.result?.pendingAgentIds.length === 0 || state.result?.failure?.recovery === 'blocked') return
    pending = true; const generation = epoch
    publish({ ...state, busy: true, error: null, locked: true })
    try {
      const result = await deps.execute(attempt)
      if (!active || epoch !== generation || !deps.isCurrent()) return
      publish({ busy: false, result, error: result.failure?.code ?? null, locked: true })
      if (!result.pendingAgentIds.length) deps.done()
    } catch (error) {
      if (active && epoch === generation && deps.isCurrent()) publish({ ...state, busy: false, locked: true, error: error instanceof Error ? error.message : 'room_agent_result_unknown' })
    } finally {
      pending = false
      if (active && epoch !== generation && deps.isCurrent()) publish({ ...state, busy: false, error: 'room_agent_result_unknown' })
    }
  }
  return {
    start() { active = true; epoch++; deps.publish(state) }, stop() { active = false; epoch++; state = { ...state, busy: false, error: attempt ? 'room_agent_result_unknown' : null } },
    async submit(roomId: string, agents: DesktopAgentSelection[]) {
      if (!active || !deps.isCurrent() || pending || attempt || !agents.length) return
      attempt = { operationId: deps.operationId(), roomId, agents: agents.map(agent => ({ ...agent })) }
      await run()
    },
    retry: run,
  }
}
