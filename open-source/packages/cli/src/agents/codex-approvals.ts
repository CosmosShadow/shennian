// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/codex-conversation-settings.test.ts
import { randomUUID } from 'node:crypto'
import type { AgentEvent } from './adapter.js'

type PendingApproval = { rpcId: string | number; turnId: string; canAccept: boolean; timer: ReturnType<typeof setTimeout> }

/** Only one-shot command/file approvals. Never silently approve or persist grants. */
export class CodexApprovals {
  private readonly pending = new Map<string, PendingApproval>()
  constructor(private readonly reply: (id: string | number, result: unknown) => void,
    private readonly emit: (event: Omit<AgentEvent, 'runId' | 'seq'>) => void) {}

  request(method: string, rpcId: string | number, params: Record<string, unknown>, threadId: string | null,
    turnId: string | null, managed: boolean): boolean {
    if (method === 'item/permissions/requestApproval') {
      this.reply(rpcId, { permissions: {}, scope: 'turn' })
      return true
    }
    if (method !== 'item/commandExecution/requestApproval' && method !== 'item/fileChange/requestApproval') return false
    // Stale/foreign prompts and managed requests must not grant access.
    if (managed || !threadId || params.threadId !== threadId || !turnId || params.turnId !== turnId) {
      this.reply(rpcId, { decision: 'decline' })
      return true
    }
    const id = randomUUID()
    const decisions = Array.isArray(params.availableDecisions) ? params.availableDecisions : null
    const canAccept = !decisions || decisions.includes('accept')
    const timer = setTimeout(() => { this.pending.delete(id); this.reply(rpcId, { decision: 'decline' }) }, 300_000)
    timer.unref?.()
    this.pending.set(id, { rpcId, turnId, canAccept, timer })
    const parts = [params.command, params.cwd, params.reason, params.grantRoot]
      .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    if (params.networkApprovalContext && typeof params.networkApprovalContext === 'object') {
      const network = params.networkApprovalContext as Record<string, unknown>
      if (typeof network.host === 'string') parts.push(`Network: ${network.host}`)
    }
    if (params.additionalPermissions) parts.push(JSON.stringify(params.additionalPermissions))
    this.emit({ state: 'approval-pending', runPhase: 'waiting_approval', approval: {
      title: method === 'item/fileChange/requestApproval' ? 'Codex · 文件修改' : 'Codex · 执行审批',
      content: parts.join('\n') || 'Codex 请求一次性操作授权。', source: 'codex',
    }, permission: { id, agentSessionId: threadId, toolCallId: String(params.itemId ?? id),
      options: [...(canAccept ? [{ id: 'accept', name: '允许一次', kind: 'allow_once' as const }] : []),
        { id: 'decline', name: '拒绝', kind: 'reject_once' }],
    } })
    return true
  }

  respond(id: string, decision: string, turnId: string | null): void {
    const request = this.pending.get(id)
    if (!request || request.turnId !== turnId) throw new Error('codex_approval_expired')
    if (!['accept', 'decline'].includes(decision) || (decision === 'accept' && !request.canAccept)) throw new Error('codex_approval_invalid')
    this.pending.delete(id)
    clearTimeout(request.timer)
    this.reply(request.rpcId, { decision })
  }
  resolved(rpcId: unknown): void {
    for (const [id, request] of this.pending) if (request.rpcId === rpcId) {
      clearTimeout(request.timer); this.pending.delete(id)
    }
  }
  clear(): void {
    for (const request of this.pending.values()) { clearTimeout(request.timer); this.reply(request.rpcId, { decision: 'decline' }) }
    this.pending.clear()
  }
}
