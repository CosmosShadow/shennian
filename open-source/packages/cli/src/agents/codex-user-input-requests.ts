// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/codex-user-input-requests.test.ts
import { randomUUID } from 'node:crypto'
import type { AgentUserInputQuestion } from '@shennian/wire'
import type { AgentEvent } from './adapter.js'
type Pending = { rpcId: string | number; turnId: string; questions: AgentUserInputQuestion[]; timer: ReturnType<typeof setTimeout> }
/** Retains the real app-server RPC request until its bound user answers. Never injects a chat turn. */
export class CodexUserInputRequests {
  private pending = new Map<string, Pending>()
  constructor(private reply: (id: string | number, result: unknown) => void, private emit: (event: Omit<AgentEvent, 'runId' | 'seq'>) => void, private source: 'codex' | 'claude' = 'codex') {}
  request(rpcId: string | number, p: Record<string, unknown>, threadId: string | null, turnId: string | null, managed: boolean) {
    if (managed || !threadId || !turnId || p.threadId !== threadId || p.turnId !== turnId || !Array.isArray(p.questions) || !p.questions.length || p.questions.length > 8) {
      this.reply(rpcId, { answers: {} }); return
    }
    const questions: AgentUserInputQuestion[] = []
    for (const raw of p.questions) {
      const q = raw as Record<string, unknown>
      if (!q || typeof q.id !== 'string' || !/^[\w-]{1,191}$/.test(q.id) || typeof q.question !== 'string' || q.question.length > 8000 || questions.some(v => v.id === q.id)) {
        this.reply(rpcId, { answers: {} }); return
      }
      const options = Array.isArray(q.options) ? q.options.slice(0, 20).flatMap(o => o && typeof o.label === 'string' && o.label.length <= 1000 ? [{ label: o.label, description: typeof o.description === 'string' ? o.description.slice(0, 2000) : undefined }] : []) : undefined
      questions.push({ id: q.id, question: q.question, header: typeof q.header === 'string' ? q.header.slice(0, 100) : undefined, isOther: q.isOther === true, isSecret: q.isSecret === true, options })
    }
    const id = `input-${randomUUID()}`
    const timer = setTimeout(() => { this.pending.delete(id); this.reply(rpcId, { answers: {} }) }, 300000)
    timer.unref?.()
    this.pending.set(id, { rpcId, turnId, questions, timer })
    this.emit({ state: 'approval-pending', runPhase: 'waiting_user_input', approval: {
      title: `${this.source === 'codex' ? 'Codex' : 'Claude Code'} 等待你回答`, content: questions.map(q => q.question).join('\n\n'), source: this.source, actionHint: '请在下方回答后提交。',
    }, permission: { id, agentSessionId: threadId, toolCallId: String(p.itemId ?? id), options: [], questions } })
  }
  respond(id: string, value: string, turnId: string | null) {
    const pending = this.pending.get(id)
    if (!pending || pending.turnId !== turnId) throw new Error('codex_input_expired')
    if (!value.startsWith('input:') || value.length > 30000) throw new Error('codex_input_invalid')
    const raw = JSON.parse(value.slice(6)) as Record<string, unknown>
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(k => !pending.questions.some(q => q.id === k))) throw new Error('codex_input_invalid')
    const answers: Record<string, { answers: string[] }> = Object.create(null)
    for (const q of pending.questions) {
      const answer = raw[q.id]
      if (typeof answer !== 'string' || !answer.trim() || answer.length > 8000) throw new Error('codex_input_invalid')
      if (q.options?.length && !q.isOther && !q.options.some(o => o.label === answer)) throw new Error('codex_input_invalid')
      answers[q.id] = { answers: [answer] }
    }
    this.reply(pending.rpcId, { answers })
    clearTimeout(pending.timer); this.pending.delete(id)
    this.emit({ state: 'notify', runPhase: 'thinking' })
  }
  resolved(rpcId: unknown) {
    for (const [id, p] of this.pending) if (p.rpcId === rpcId) { clearTimeout(p.timer); this.pending.delete(id) }
  }
  clear() { for (const p of this.pending.values()) { clearTimeout(p.timer); this.reply(p.rpcId, { answers: {} }) }; this.pending.clear() }
}
