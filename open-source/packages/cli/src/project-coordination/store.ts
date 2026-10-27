// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/project-coordination-store.test.ts
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { getShennianDir } from '../config/index.js'
import type { PersonalAttachmentReference } from '@shennian/wire'

export type CoordinationStatus = 'queued' | 'running' | 'waiting' | 'review' | 'completed' | 'failed' | 'paused' | 'memo'
export type CoordinationTask = {
  id: string; title: string; agentType: string; status: CoordinationStatus; priority: number
  createdAt: number; updatedAt: number; result?: string; waitingReason?: string
  requestIds: string[]; admittedRequestId?: string; manualReady?: boolean
  access?: 'read' | 'write'
  queuedAt?: number
}
export type CoordinationMessage = { id: string; role: 'user' | 'agent'; text: string; at: number; attachments?: PersonalAttachmentReference[] }
export type CoordinationQuestion = { id: string; question: string; taskId?: string; options: string[]; at: number; answer?: string; answeredAt?: number }
export type CoordinationState = {
  version: 1; revision: number; workDir: string; enabled: boolean; paused: boolean
  mode: 'serial' | 'research_parallel' | 'parallel'; automatic: boolean
  instructions: string; instructionRevision: number; tasks: CoordinationTask[]
  messages: CoordinationMessage[]; managerBusy: boolean; managerError?: string
  adoptionVersion?: 1
  questions?: CoordinationQuestion[]
}
export const DEFAULT_COORDINATION_INSTRUCTIONS = '优先处理用户明确指定的任务，同优先级按入队时间执行。不要把执行结束当作目标完成。只汇报结果、阻塞与需要用户决定的事项。用户明确要求长期调整时保存规范，并在回复中说明。任务链接使用 shennian://session/<任务ID>。'
const validId = (id: string) => /^[\w.:-]{1,191}$/.test(id)
const occupied = (t: CoordinationTask) => t.status === 'running' || (t.status === 'waiting' && t.waitingReason !== 'user_confirmation')
type EventSummary = { sequence: number; at: number; kind: string }

/** Client owns writes. Every committed event contains a recoverable state; the snapshot is only a cache. */
export class ProjectCoordinationStore {
  private cache = new Map<string, { size: number; mtime: number; state: CoordinationState; recent: EventSummary[] }>()
  constructor(private readonly root = () => path.join(getShennianDir(), 'projects')) {}
  directory(workDir: string) {
    const canonical = fs.realpathSync(workDir)
    if (!fs.statSync(canonical).isDirectory()) throw new Error('coordination_directory_invalid')
    return { canonical, dir: path.join(this.root(), createHash('sha256').update(process.platform === 'win32' ? canonical.toLowerCase() : canonical).digest('hex'), 'coordination') }
  }
  private initial(workDir: string): CoordinationState {
    return { version: 1, revision: 0, workDir, enabled: false, paused: false, mode: 'serial', automatic: true,
      instructions: DEFAULT_COORDINATION_INSTRUCTIONS, instructionRevision: 0, tasks: [], messages: [], managerBusy: false }
  }
  read(workDir: string): CoordinationState {
    const { canonical, dir } = this.directory(workDir)
    const file = path.join(dir, 'events.jsonl')
    if (!fs.existsSync(file)) return this.initial(canonical)
    const stat = fs.statSync(file), cached = this.cache.get(file)
    if (cached?.size === stat.size && cached.mtime === stat.mtimeMs) return structuredClone(cached.state)
    const lines = fs.readFileSync(file, 'utf8').split('\n')
    // An incomplete final record was never committed and cannot be replayed.
    if (lines.at(-1) !== '') throw new Error('coordination_event_tail_incomplete')
    let state = this.initial(canonical)
    const recent: EventSummary[] = []
    for (const line of lines.slice(0, -1)) {
      const event = JSON.parse(line) as EventSummary & { state: CoordinationState }
      if (event.sequence !== state.revision + 1 || event.state.version !== 1 || event.state.workDir !== canonical || event.state.revision !== event.sequence) throw new Error('coordination_state_invalid')
      state = event.state
      recent.push({ sequence: event.sequence, at: event.at, kind: event.kind }); if (recent.length > 30) recent.shift()
    }
    this.cache.set(file, { size: stat.size, mtime: stat.mtimeMs, state: structuredClone(state), recent })
    return state
  }
  enabled(workDir: string) {
    if (!fs.existsSync(this.root())) return false
    try { return this.read(workDir).enabled }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
  }
  private update<T>(workDir: string, kind: string, operation: (state: CoordinationState) => T): T {
    const { dir } = this.directory(workDir)
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    // Never break an unknown/stale lock automatically: multiple processes must not both resume work.
    const lock = path.join(dir, 'write.lock')
    const fd = fs.openSync(lock, 'wx', 0o600)
    try {
      const state = this.read(workDir)
      const before = JSON.stringify(state)
      const result = operation(state)
      if (JSON.stringify(state) === before) return result
      state.revision++
      const event = { sequence: state.revision, at: Date.now(), kind }
      const eventFd = fs.openSync(path.join(dir, 'events.jsonl'), 'a', 0o600)
      try {
        fs.writeFileSync(eventFd, JSON.stringify({ ...event, state }) + '\n')
        fs.fsyncSync(eventFd)
      } finally { fs.closeSync(eventFd) }
      const eventPath = path.join(dir, 'events.jsonl'), eventStat = fs.statSync(eventPath)
      const recent = [...(this.cache.get(eventPath)?.recent ?? []), event].slice(-30)
      this.cache.set(eventPath, { size: eventStat.size, mtime: eventStat.mtimeMs, state: structuredClone(state), recent })
      this.atomic(path.join(dir, 'state.json'), JSON.stringify(state))
      this.atomic(path.join(dir, 'instructions.md'), state.instructions)
      return result
    } finally { fs.closeSync(fd); fs.unlinkSync(lock) }
  }
  private atomic(file: string, content: string) {
    const tmp = `${file}.${randomUUID()}.tmp`
    const fd = fs.openSync(tmp, 'wx', 0o600)
    try { fs.writeFileSync(fd, content); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    try { fs.renameSync(tmp, file) } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) }
  }
  configure(workDir: string, patch: Partial<Pick<CoordinationState, 'enabled' | 'paused' | 'mode' | 'automatic'>>, existingTasks?: CoordinationTask[]) {
    this.update(workDir, 'configure', s => {
      if (patch.mode !== undefined && !['serial', 'research_parallel', 'parallel'].includes(patch.mode)) throw new Error('coordination_mode_invalid')
      for (const key of ['enabled', 'paused', 'automatic'] as const) if (patch[key] !== undefined && typeof patch[key] !== 'boolean') throw new Error('coordination_config_invalid')
      if (patch.enabled === false && s.tasks.some(occupied)) throw new Error('coordination_running_tasks_remain')
      if (patch.enabled === false) for (const t of s.tasks) if (t.status === 'queued') t.status = 'paused'
      if (patch.enabled === true && existingTasks && (!s.enabled || s.adoptionVersion !== 1)) {
        for (const incoming of existingTasks) {
          const existing = s.tasks.find(t => t.id === incoming.id)
          if (!existing) s.tasks.push(incoming)
          // Actual live runs take precedence over a previous snapshot, without losing queued request IDs.
          else if (occupied(incoming)) {
            Object.assign(existing, incoming, { priority: existing.priority, requestIds: [...new Set([...existing.requestIds, ...incoming.requestIds])] })
            delete existing.result
            if (!incoming.waitingReason) delete existing.waitingReason
          }
          else if (incoming.status === 'queued') {
            existing.requestIds = [...new Set([...existing.requestIds, ...incoming.requestIds])]
            if (!occupied(existing) && existing.status !== 'paused') {
              existing.status = 'queued'; existing.queuedAt = incoming.queuedAt; delete existing.waitingReason
            }
          }
        }
      }
      if (patch.enabled === true && existingTasks) s.adoptionVersion = 1
      Object.assign(s, patch)
    })
    return this.read(workDir)
  }
  saveInstructions(workDir: string, text: string, expectedRevision: number) {
    if (!text.trim() || text.length > 30000) throw new Error('coordination_instructions_invalid')
    this.update(workDir, 'instructions', s => {
      if (s.instructionRevision !== expectedRevision) throw new Error('coordination_revision_conflict')
      s.instructions = text; s.instructionRevision++
    })
    return this.read(workDir)
  }
  enqueue(workDir: string, taskId: string, text: string, agentType: string, requestId: string, access: 'read' | 'write' = 'write') {
    if (!this.enabled(workDir)) return
    if (!validId(taskId) || !validId(requestId)) throw new Error('coordination_task_invalid')
    this.update(workDir, 'enqueue', s => {
      let task = s.tasks.find(t => t.id === taskId)
      if (task && !occupied(task)) task.access = access
      if (task?.requestIds.includes(requestId)) return
      if (!task) {
        task = { id: taskId, title: text.trim().split('\n')[0]!.slice(0, 100), agentType, access, status: 'queued', priority: 0, createdAt: Date.now(), updatedAt: Date.now(), requestIds: [] }
        s.tasks.push(task)
      }
      task.requestIds.push(requestId)
      task.updatedAt = Date.now()
      if (!occupied(task) && task.status !== 'paused') { task.status = 'queued'; task.queuedAt = Date.now(); delete task.waitingReason }
    })
  }
  admit(workDir: string, taskId: string, requestId: string, pendingTaskIds?: string[]): boolean {
    const current = this.read(workDir)
    if (!current.enabled) return true
    return this.update(workDir, 'admission', s => {
      const task = s.tasks.find(t => t.id === taskId)
      if (!task || s.paused || task.status === 'paused' || task.status === 'memo') return false
      // Only a receipt for this exact turn can be replayed; another queued turn waits for terminal.
      if (occupied(task)) return false
      // This method is called only for a message still in the durable chat queue.
      if (['review', 'completed', 'failed'].includes(task.status)) { task.status = 'queued'; task.queuedAt = Date.now() }
      if (pendingTaskIds) for (const stale of s.tasks) if (stale.status === 'queued' && !pendingTaskIds.includes(stale.id)) stale.status = 'paused'
      const contenders = s.tasks.filter(t => t.status === 'queued' && (s.automatic || t.manualReady))
        .sort((a, b) => b.priority - a.priority || (a.queuedAt ?? a.createdAt) - (b.queuedAt ?? b.createdAt))
      if (!s.automatic && !task.manualReady) return false
      const active = s.tasks.filter(occupied)
      if (s.mode === 'serial' && (active.length || contenders[0]?.id !== taskId)) return false
      if (s.mode === 'research_parallel') {
        const read = task.access === 'read'
        const sameAccess = (t: CoordinationTask) => (t.access === 'read') === read
        if (active.filter(sameAccess).length >= (read ? 2 : 1) || contenders.filter(sameAccess)[0]?.id !== taskId) return false
      }
      if (s.mode === 'parallel' && active.length >= 8) return false
      task.status = 'running'; task.admittedRequestId = requestId; task.manualReady = false; task.updatedAt = Date.now()
      return true
    })
  }
  progress(workDir: string, taskId: string, phase: string, result?: string) {
    if (!this.enabled(workDir)) return
    this.update(workDir, 'progress', s => {
      const task = s.tasks.find(t => t.id === taskId)
      if (!task || !occupied(task)) return
      if (phase === 'waiting_approval' || phase === 'waiting_user_input') { task.status = 'waiting'; task.waitingReason = phase }
      else if (['running', 'thinking', 'streaming_text', 'tool_running'].includes(phase)) { task.status = 'running'; delete task.waitingReason }
      else if (['final', 'error', 'aborted'].includes(phase)) {
        task.status = phase === 'final' ? 'review' : 'failed'
        task.result = result?.slice(0, 4000); delete task.admittedRequestId; delete task.waitingReason
      }
      task.updatedAt = Date.now()
    })
  }
  dispatchFailed(workDir: string, taskId: string, requestId: string) {
    if (!this.enabled(workDir)) return
    this.update(workDir, 'dispatch.failed', s => {
      const task = s.tasks.find(t => t.id === taskId)
      if (task?.admittedRequestId !== requestId || task.status !== 'running') return
      task.status = 'queued'; delete task.admittedRequestId
    })
  }
  taskAction(workDir: string, id: string, action: 'priority' | 'pause' | 'run' | 'complete' | 'confirm', priority = 0, actor: 'user' | 'coordinator' = 'user') {
    this.update(workDir, `task.${action}`, s => {
      const task = s.tasks.find(t => t.id === id)
      if (!task) throw new Error('coordination_task_missing')
      if (action === 'priority') { if (!Number.isFinite(priority) || Math.abs(priority) > 1000) throw new Error('coordination_priority_invalid'); task.priority = priority; return }
      if (occupied(task)) throw new Error('coordination_task_still_running')
      if (action === 'complete' && (task.status !== 'review' && task.waitingReason !== 'user_confirmation')) throw new Error('coordination_result_review_required')
      if (action === 'complete' && actor === 'coordinator' && task.waitingReason === 'user_confirmation') throw new Error('coordination_user_confirmation_required')
      if (action === 'complete' && actor === 'coordinator' && s.questions?.some(q => q.taskId === id && !q.answeredAt)) throw new Error('coordination_user_answer_required')
      if (action === 'confirm' && task.status !== 'review') throw new Error('coordination_result_review_required')
      if (action === 'pause') task.status = 'paused'
      else if (action === 'complete') task.status = 'completed'
      else if (action === 'confirm') { task.status = 'waiting'; task.waitingReason = 'user_confirmation' }
      else { task.status = 'queued'; task.manualReady = true; delete task.waitingReason }
      task.updatedAt = Date.now()
    })
    return this.read(workDir)
  }
  askUser(workDir: string, question: CoordinationQuestion) {
    this.update(workDir, 'question', s => {
      if (!validId(question.id) || question.id.length > 150 || !question.question.trim() || question.question.length > 4000 || question.options.length > 5 || question.options.some(o => !o.trim() || o.length > 200)) throw new Error('coordination_question_invalid')
      if (question.taskId && !s.tasks.some(t => t.id === question.taskId)) throw new Error('coordination_task_missing')
      s.questions ??= []
      if (!s.questions.some(q => q.id === question.id || (!q.answeredAt && q.taskId === question.taskId && q.question === question.question))) s.questions.push(question)
    })
    return this.read(workDir)
  }
  answerUser(workDir: string, questionId: string, answer: string) {
    return this.update(workDir, 'question.answer', s => {
      const question = s.questions?.find(q => q.id === questionId)
      if (!question || !answer.trim() || answer.length > 20000) throw new Error('coordination_question_invalid')
      const fresh = !question.answeredAt
      if (question.answeredAt) {
        if (question.answer !== answer) throw new Error('coordination_question_answered')
      }
      if (fresh) { question.answer = answer; question.answeredAt = Date.now() }
      const requestId = `question-answer-${questionId}`
      // Commit the accepted answer and its manager inbox message in the same durable event.
      if (!s.messages.some(m => m.id === requestId)) s.messages.push({ id: requestId, role: 'user', at: question.answeredAt!, text: `回答项目经理的问题：${question.question}\n\n我的回答：${answer}` })
      return { question, fresh }
    })
  }
  message(workDir: string, role: 'user' | 'agent', text: string, requestId: string = randomUUID(), attachments?: PersonalAttachmentReference[]) {
    if (!text.trim() || text.length > 30000 || !validId(requestId)) throw new Error('coordination_message_invalid')
    let added = false
    this.update(workDir, 'message', s => {
      if (s.messages.some(m => m.id === requestId)) return
      s.messages.push({ id: requestId, role, text, at: Date.now(), ...(attachments?.length ? { attachments } : {}) }); added = true
    })
    return added
  }
  managerState(workDir: string, busy: boolean, error?: string) {
    this.update(workDir, 'manager', s => { s.managerBusy = busy; s.managerError = error })
  }
  recent(workDir: string) {
    const file = path.join(this.directory(workDir).dir, 'events.jsonl')
    this.read(workDir)
    return structuredClone(this.cache.get(file)?.recent ?? [])
  }
}
export const projectCoordinationStore = new ProjectCoordinationStore()
