// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/queue-durability-disk.test.ts
import fs from 'node:fs'
import { classifyQueueError } from './queue-helpers.js'
import { readQueue, writeQueue } from './queue-storage.js'
import { upsertMessage } from './store.js'
import { describeRoomReplyFailure } from './room-reply-notice.js'
import { TerminalQueuedChatDispatchError, type LocalQueuedChatMessage } from './queue-message.js'

type GuidanceContext = { workDir?: string }
const RECOVERY_GUIDANCE: Record<string, string | ((context: GuidanceContext) => string)> = {
  agent_workdir_not_found: ({ workDir }) => `这条消息绑定的工作目录不存在${workDir ? `：${workDir}` : ''}。请在这台电脑恢复该目录（被移动、删除，或所在磁盘未挂载），或回到神念为这个对话改选一个存在的目录。`,
  agent_workdir_not_directory: ({ workDir }) => `这条消息绑定的工作目录不是文件夹${workDir ? `：${workDir}` : ''}。请回到神念为这个对话改选一个文件夹。`,
  agent_workdir_unavailable: ({ workDir }) => `无权访问这条消息绑定的工作目录${workDir ? `：${workDir}` : ''}。请在这台电脑检查该目录的访问权限，或回到神念改选目录。`,
  codex_windows_runtime_unavailable: '未找到可运行的 Windows Codex CLI。请在这台电脑确认 Windows Codex 已安装并可登录，将其目录加入用户 PATH，或将 SHENNIAN_CODEX_PATH 设为该 CLI 的完整路径后重启神念 Client；再刷新 AI 列表。不会改用 WSL。',
  codex_session_capability_unavailable: '当前 Codex 未提供此会话所需的 Desktop 接口。请核对 Windows Codex CLI 选择和实际接口支持，必要时由你手动更新 Codex，再刷新 AI 列表；不会另建不兼容的对话。',
  codex_command_unavailable: '无法启动已选择的 Codex CLI。请确认该程序仍存在且可运行，再刷新 AI 列表。',
  managed_agent_runtime_changed: '当前 Codex 的 Windows / WSL 环境与原授权不同。请恢复原运行环境并刷新 AI 列表；不要通过换绑或新建对话处理这些待发送消息。',
  codex_managed_permission_profile_unavailable: '当前 Codex 未提供所需的限制权限能力。请检查所选 Codex 和智能体权限设置；不会自动放宽权限。修复后刷新 AI 列表。',
  codex_managed_config_read_invalid: '当前 Codex 未返回可验证的权限配置。请检查所选 Codex 是否可正常启动，修复后刷新 AI 列表。',
  managed_agent_host_full_confirmation_required: '当前智能体权限尚未获有效授权。请在智能体设置中核对并保存所需权限；不会自动改为全部权限。',
}

export function queueRecoveryGuidance(code: string, context: GuidanceContext = {}): string | undefined {
  const entry = RECOVERY_GUIDANCE[code]
  return typeof entry === 'function' ? entry(context) : entry
}

/**
 * Node reports a missing spawn cwd as ENOENT, which adapters cannot tell apart from a missing
 * executable. Checking the bound directory when a dispatch fails names the real cause instead.
 */
export function diagnoseWorkDir(workDir: string | undefined): string | null {
  if (!workDir) return null
  try {
    return fs.statSync(workDir).isDirectory() ? null : 'agent_workdir_not_directory'
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return 'agent_workdir_not_found'
    if (code === 'EACCES' || code === 'EPERM') return 'agent_workdir_unavailable'
    return null
  }
}

// Failures nobody classified are retried silently by design; tell the Owner once it is clearly
// not a momentary glitch (the 4th failure, about 7 s of backoff) instead of leaving the message unexplained.
const UNCLASSIFIED_NOTICE_AFTER_ATTEMPTS = 4

function reasonOf(error: unknown, fallback: string): string {
  const raw = (error instanceof Error ? error.message : String(error)).replace(/^Agent send failed:\s*/i, '')
  const line = raw.split(/\r?\n/).map((part) => part.trim()).find(Boolean) ?? ''
  return (line || fallback).slice(0, 160)
}

const TERMINAL_NOTICE_SKIPPED = new Set(['queued_dispatch_cancelled', 'queue_stopped'])

export function queueBlockedUntil(messages: LocalQueuedChatMessage[]): number | undefined {
  const times = messages.map((message) => message.dispatchBlock?.retryAt ?? 0)
  const next = Math.max(0, ...times)
  return next > Date.now() ? next : undefined
}

export function handleQueueDispatchFailure(input: {
  error: unknown
  sessionId: string
  batch: LocalQueuedChatMessage[]
  isManagedWorker: boolean
  publish: () => void
  removeBatch: () => number
  log: (event: string, fields: Record<string, unknown>) => void
  diagnoseWorkDir?: (workDir: string | undefined) => string | null
}): { drainAgain: boolean; transientFailure: boolean } {
  const { error, sessionId, batch } = input
  const terminal = error instanceof TerminalQueuedChatDispatchError
  const first = batch[0]
  const classified = classifyQueueError(error instanceof Error ? error.message : String(error),
    terminal ? 'terminal_dispatch_failed' : 'transient_dispatch_failed')
  // A missing directory explains the failure better than whatever the adapter guessed.
  const failureClass = (!terminal && (input.diagnoseWorkDir ?? diagnoseWorkDir)(first?.workDir)) || classified
  const guidance = queueRecoveryGuidance(failureClass, { workDir: first?.workDir })
  // Only preparation failures are safe to revalidate. Never replay a Provider
  // failure already marked terminal/accepted, even if its text has this code.
  if (!terminal && guidance && first) {
    const queue = readQueue()
    const ids = new Set(batch.map((message) => message.id))
    const pending = (queue.sessions[sessionId] ?? []).filter((message) => ids.has(message.id))
    if (!pending.length) return { drainAgain: false, transientFailure: false }
    const changed = pending.some((message) => message.dispatchBlock?.code !== failureClass)
    const retryAt = Date.now() + 60_000
    for (const message of pending) {
      // Only `first` gets the notice below, so only it may announce recovery.
      const notice = message.id === first.id || message.dispatchBlock?.notice
      message.dispatchBlock = { code: failureClass, retryAt, ...(notice ? { notice: true as const } : {}) }
    }
    writeQueue(queue)
    // Stable notice ID prevents duplicate transcript rows, including restart.
    upsertMessage(sessionId, {
      id: `queue-recovery-${first.id}`, sessionId, role: 'agent', ts: Date.parse(first.createdAt),
      payload: `消息尚未交给 AI，已保留，等待恢复：${guidance} 配置恢复后会自动重试，请勿重复发送。`,
    })
    input.publish()
    if (changed) input.log('dispatch.blocked', { failureClass })
    return { drainAgain: false, transientFailure: false }
  }
  const staleWorker = Boolean(first && !first.trigger && !first.clientMessageId &&
    Date.now() - Date.parse(first.createdAt) >= 10 * 60_000 && input.isManagedWorker)
  const restrictedRoomUnsupported = failureClass === 'managed_agent_restricted_room_unsupported'
  if (restrictedRoomUnsupported && first) {
    upsertMessage(sessionId, {
      id: `room-reply-notice-${first.id}`, sessionId, role: 'agent', ts: Date.now(),
      payload: `本轮未能在群里回复：${describeRoomReplyFailure(failureClass)}。`,
    })
  }
  if (terminal || failureClass === 'managed_claim_source_binding_conflict' || restrictedRoomUnsupported || staleWorker) {
    if (first && !restrictedRoomUnsupported && !TERMINAL_NOTICE_SKIPPED.has(reasonOf(error, failureClass))) {
      // The message is being dropped: never let that happen without telling the Owner why.
      upsertMessage(sessionId, {
        id: `queue-failed-${first.id}`, sessionId, role: 'agent', ts: Date.now(),
        payload: `消息未能送达，且不会自动重试：${reasonOf(error, failureClass)}。请检查后重新发送。`,
      })
      input.publish()
    }
    const pendingCount = input.removeBatch()
    input.log('dispatch.terminal-failure', {
      batchCount: batch.length, queueMessageId: first?.id, pendingCount,
      failureClass: staleWorker ? 'stale_legacy_managed_worker_dispatch_failure' : failureClass,
    })
    return { drainAgain: pendingCount > 0, transientFailure: false }
  }
  input.log('dispatch.transient-failure', { failureClass })
  if (first) noteUnclassifiedFailure(input, failureClass, reasonOf(error, failureClass))
  return { drainAgain: false, transientFailure: true }
}

function noteUnclassifiedFailure(
  input: { sessionId: string; batch: LocalQueuedChatMessage[]; publish: () => void },
  failureClass: string,
  reason: string,
): void {
  const { sessionId, batch } = input
  const first = batch[0]!
  const queue = readQueue()
  const ids = new Set(batch.map((message) => message.id))
  const pending = (queue.sessions[sessionId] ?? []).filter((message) => ids.has(message.id))
  if (!pending.length) return
  // retryAt 0 marks this as a plain failure counter, not a configuration block that waits.
  const attempts = (pending.find((message) => message.id === first.id)?.dispatchBlock?.attempts ?? 0) + 1
  const announce = attempts === UNCLASSIFIED_NOTICE_AFTER_ATTEMPTS
  for (const message of pending) {
    const notice = message.dispatchBlock?.notice || (announce && message.id === first.id)
    message.dispatchBlock = { code: failureClass, retryAt: 0, attempts, ...(notice ? { notice: true as const } : {}) }
  }
  writeQueue(queue)
  if (!announce) return
  upsertMessage(sessionId, {
    id: `queue-recovery-${first.id}`, sessionId, role: 'agent', ts: Date.parse(first.createdAt),
    payload: `消息尚未送达，已保留并在自动重试（已尝试 ${attempts} 次）。原因：${reason}。如长时间没有变化，请检查这台电脑上的神念和 AI 是否正常运行。`,
  })
  input.publish()
}

export function resolveQueueRecoveryNotice(batch: LocalQueuedChatMessage[]): void {
  for (const message of batch) {
    if (!message.dispatchBlock?.notice) continue
    upsertMessage(message.sessionId, {
      id: `queue-recovery-${message.id}`, sessionId: message.sessionId,
      role: 'agent', ts: Date.parse(message.createdAt),
      payload: '已恢复：原待发送消息已成功交给 AI，无需重复发送。',
    })
  }
}
