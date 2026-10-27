// @arch open-source/docs/server-runtime.md
// @test src/__tests__/voice-chief-ws.test.ts

import type { FastifyRequest } from 'fastify'
import type { RawData, WebSocket } from 'ws'
import type { VoiceChiefClientFrame, VoiceChiefServerFrame } from '@shennian/wire'

const CALL_CONTEXT_ENTRY_MAX_CHARS = 1_500
const DEFAULT_CALL_TIME_ZONE = 'Asia/Shanghai'

export type VoiceChiefSocket = Pick<WebSocket, 'readyState' | 'send' | 'close' | 'on'>

export function extractVoiceChiefToken(request: FastifyRequest): string | null {
  const url = new URL(request.url, 'http://localhost')
  return url.searchParams.get('token')?.trim() || null
}

export function sendVoiceChiefJson(socket: VoiceChiefSocket, frame: VoiceChiefServerFrame) {
  if (socket.readyState !== 1) return
  socket.send(JSON.stringify(frame))
}

export function sendVoiceChiefAudio(socket: VoiceChiefSocket, chunk: Uint8Array) {
  if (socket.readyState !== 1 || chunk.byteLength === 0) return
  socket.send(chunk)
}

export function parseVoiceChiefClientFrame(text: string): VoiceChiefClientFrame | null {
  try {
    const frame = JSON.parse(text) as VoiceChiefClientFrame
    return frame && typeof frame.type === 'string' ? frame : null
  } catch {
    return null
  }
}

export function voiceChiefRawDataToBuffer(raw: RawData): Buffer {
  if (Buffer.isBuffer(raw)) return raw
  if (raw instanceof ArrayBuffer) return Buffer.from(raw)
  if (Array.isArray(raw)) return Buffer.concat(raw)
  return Buffer.from(raw)
}

export function clipVoiceChiefContextValue(
  value: string,
  maxLength = CALL_CONTEXT_ENTRY_MAX_CHARS,
): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}…`
}

export function parseVoiceChiefPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function parseVoiceChiefOptionalPositiveIntEnv(name: string): number | null {
  const raw = process.env[name]?.trim()
  if (!raw) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function trimIncomingCallText(value: string | undefined, maxLength: number): string {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed
}

function trimContextTail(value: string | undefined, maxLength: number): string {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > maxLength ? `…\n${trimmed.slice(-(maxLength - 2))}` : trimmed
}

export function appendIncomingCallInstructions(
  instructions: string,
  frame: Extract<VoiceChiefClientFrame, { type: 'start' }>,
): string {
  const incomingCallId = trimIncomingCallText(frame.incomingCallId, 120)
  const initialPrompt = trimIncomingCallText(frame.initialPrompt, 500)
  const reason = trimIncomingCallText(frame.reason, 120)
  if (!incomingCallId && !initialPrompt && !reason) return instructions
  return `${instructions}\n\n<incoming_call>\n这是一通由神念主动发起的电话。开场依据 incoming_call_context 直接说明来电事项和当前结果。\n</incoming_call>`
}

function reconnectOpeningText(frame: Extract<VoiceChiefClientFrame, { type: 'start' }>) {
  return (frame.reconnectAttempt ?? 0) > 0
    ? '用户刚才网络断线后已重新接通。自然延续上一轮通话；如果缺少刚才正在说的内容，用一句“刚才网络波动，我继续听您说”承接，随后等待用户继续。'
    : null
}

function validTimeZone(value: string | undefined): string {
  const candidate = value?.trim() || DEFAULT_CALL_TIME_ZONE
  try {
    new Intl.DateTimeFormat('zh-CN', { timeZone: candidate }).format()
    return candidate
  } catch {
    return DEFAULT_CALL_TIME_ZONE
  }
}

export function buildVoiceChiefCurrentDatetimeContext(
  timeZone: string | undefined,
  now = new Date(),
): string {
  const resolvedTimeZone = validTimeZone(timeZone)
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: resolvedTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `<current_datetime>\n当前时间：${value('year')}-${value('month')}-${value('day')} ${value('hour')}:${value('minute')}:${value('second')}\n时区：${resolvedTimeZone}\n</current_datetime>`
}

export function buildVoiceChiefCallOpeningUserText(
  frame: Extract<VoiceChiefClientFrame, { type: 'start' }>,
  options?: {
    previousCallContext?: string
    attentionSnapshot?: string
    currentDatetimeContext?: string
  },
): string {
  const reconnect = reconnectOpeningText(frame)
  const currentDatetimeContext =
    options?.currentDatetimeContext ?? buildVoiceChiefCurrentDatetimeContext(frame.timeZone)
  if (reconnect) return `${reconnect}\n\n${currentDatetimeContext}`

  const previousCallContext = trimContextTail(options?.previousCallContext, 2_400)
  const attentionSnapshot = options?.attentionSnapshot?.trim() ?? ''
  const projectHint = trimIncomingCallText(frame.projectHint, 120)
  const sharedContext = [
    previousCallContext
      ? `<previous_call_context>\n${previousCallContext}\n</previous_call_context>`
      : '',
    attentionSnapshot,
    projectHint ? `<current_focus>\n项目线索：${projectHint}\n</current_focus>` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  if (frame.incomingCallId || frame.initialPrompt || frame.reason) {
    const initialPrompt = trimIncomingCallText(frame.initialPrompt, 500)
    const reason = trimIncomingCallText(frame.reason, 120)
    return [
      '用户已经接听了这通神念主动来电。请根据以下带来源的事实直接说明来电事项和当前结果，先说结论，通常一到两句。',
      sharedContext,
      '<incoming_call_context>',
      reason ? `来电事项：${reason}` : '',
      initialPrompt ? `处理目标：${initialPrompt}` : '',
      '</incoming_call_context>',
      '需要用户决定时给出建议并问一个具体问题；其余情况说完后自然停下来。角色和工具规则始终以 System Prompt 为准。',
      currentDatetimeContext,
    ]
      .filter(Boolean)
      .join('\n')
  }

  if (attentionSnapshot || previousCallContext || projectHint) {
    return [
      '用户刚刚接通神念语音电话。请根据以下带来源的事实主动做工作简报，先说结论，最多三项。',
      sharedContext,
      '依次关注等待决定、刚完成、失败或阻塞、运行中、上次未结束和最近相关的事项。需要用户决定时给出建议并问一个具体问题；其余情况说完后自然停下来。快照已经提供的事实可以直接表达，深入查询或实际执行时使用 delegate。角色和工具规则始终以 System Prompt 为准。',
      currentDatetimeContext,
    ]
      .filter(Boolean)
      .join('\n')
  }

  return `用户已经接通神念语音电话。请用一句自然、简短的问候开始，说完后自然停下来。\n\n${currentDatetimeContext}`
}
