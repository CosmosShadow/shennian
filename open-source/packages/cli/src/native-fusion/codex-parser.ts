// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/native-fusion-parsers.test.ts
// @test src/__tests__/native-fusion-codex-current-input.test.ts
// @test src/__tests__/native-fusion-codex-subagent.test.ts

import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { buildApprovalPendingPayload, buildUserMessagePayload, isSystemControlPayload, isToolPayload, type ChatAttachmentMeta } from '@shennian/wire'
import {
  buildImagePayload,
  buildToolPayload,
  findJsonlLookbackOffset,
  makeCursor,
  normalizeText,
  parseStructuredString,
  readJsonlLines,
  readJsonlLinesCooperatively,
  readTimestamp,
  safeParse,
  shouldIgnoreNativeScanPath,
} from './parser-common.js'
import type { ParsedNativeEvent } from './types.js'
import { lookupCodexThreadName } from './codex-files.js'
import { buildCodexUserQuestion } from '../agents/codex-user-question.js'
import {
  parseCodexDelegationInput,
  parseCodexResponseUserInput,
} from './codex-user-input.js'
export { listCodexRolloutFiles, lookupCodexThreadName } from './codex-files.js'
import {
  isCodexInjectedContextText,
  parseCodexLocalImageAttachment,
  parseCodexUserMessage,
} from './codex-message-parser.js'
function codexTerminalState(eventType: string): ParsedNativeEvent['terminalState'] | null {
  if (eventType === 'turn_aborted') return 'aborted'
  if (eventType === 'turn_completed' || eventType === 'turn_complete' || eventType === 'task_complete') {
    return 'completed'
  }
  return null
}

function isCodexApprovalEventType(eventType: string): boolean {
  return /approval|permission|confirm|user[_-]?input|input[_-]?required/i.test(eventType)
}

function buildCodexApprovalPayload(payload: Record<string, unknown>): string {
  const command = typeof payload.command === 'string'
    ? payload.command
    : Array.isArray(payload.command)
      ? payload.command.join(' ')
      : ''
  const content =
    typeof payload.prompt === 'string' ? payload.prompt
      : typeof payload.reason === 'string' ? payload.reason
        : typeof payload.message === 'string' ? payload.message
          : command ? `Codex 请求执行命令：${command}`
            : 'Codex 正在等待用户确认后继续。'
  return buildApprovalPendingPayload({
    title: '需要用户确认',
    content,
    source: 'codex',
    actionHint: '当前神念暂不支持远程确认，请回到运行 Codex 的电脑/终端完成确认。',
  })
}

function codexMessageContentText(
  content: unknown,
  textType: 'input_text' | 'output_text',
): string {
  if (!Array.isArray(content)) return ''
  return normalizeText(
    content
      .map((part) => {
        if (typeof part === 'string') return part
        if (typeof part !== 'object' || part === null) return ''
        const record = part as Record<string, unknown>
        if (record.type !== textType) return ''
        return typeof record.text === 'string' ? record.text : ''
      })
      .filter(Boolean)
      .join('\n\n'),
  )
}

function codexMessageInputImageAttachments(content: unknown): ChatAttachmentMeta[] {
  if (!Array.isArray(content)) return []
  const attachments: ChatAttachmentMeta[] = []
  for (const part of content) {
    if (typeof part !== 'object' || part === null) continue
    const record = part as Record<string, unknown>
    if (record.type !== 'input_image') continue
    const attachment = parseCodexLocalImageAttachment(record)
    if (attachment) attachments.push(attachment)
  }
  return attachments
}

function parseCodexResponseMessage(payload: Record<string, unknown>): {
  role: 'user' | 'agent'
  payload: string
  titleText: string
  repairHint?: ParsedNativeEvent['repairHint']
} | null {
  if (payload.type !== 'message') return null
  const role = payload.role === 'assistant' ? 'agent' : payload.role === 'user' ? 'user' : null
  if (!role) return null

  if (role === 'agent') {
    const text = codexMessageContentText(payload.content, 'output_text')
    if (isSystemControlPayload(text)) return null
    return text ? { role, payload: text, titleText: text } : null
  }

  const parsedInput = parseCodexResponseUserInput(payload.content)
  const text = parsedInput.text
  const attachments = [...codexMessageInputImageAttachments(payload.content)]
  for (const imagePath of parsedInput.imagePaths) {
    const attachment = parseCodexLocalImageAttachment(imagePath)
    if (!attachment) continue
    if (!attachments.some((existing) => existing.path === attachment.path)) attachments.push(attachment)
  }
  if (!text && attachments.length === 0) return null
  if (isSystemControlPayload(text) && attachments.length === 0) return null
  if (isCodexInjectedContextText(text) && attachments.length === 0) return null
  return {
    role,
    payload: attachments.length > 0 ? buildUserMessagePayload(text, attachments) : text,
    titleText: text,
    repairHint: parsedInput.strippedWrapper ? 'codex_app_context_wrapper' : undefined,
  }
}

function codexDedupeText(payload: string): string {
  if (!payload) return ''
  try {
    const parsed = JSON.parse(payload) as unknown
    if (typeof parsed === 'object' && parsed !== null) {
      const record = parsed as Record<string, unknown>
      if (record.type === 'user' && typeof record.content === 'string') return normalizeText(record.content)
    }
  } catch {
    /* plain text payload */
  }
  return normalizeText(payload)
}

function isDuplicateCodexChatEvent(
  event: ParsedNativeEvent,
  role: 'user' | 'agent',
  payload: string,
  ts: number,
): boolean {
  if (event.agentType !== 'codex') return false
  if (event.role !== role) return false
  if (isToolPayload(event.payload)) return false
  if (Math.abs(event.ts - ts) > 5 * 60 * 1000) return false
  return codexDedupeText(event.payload) === codexDedupeText(payload)
}

function findDuplicateCodexChatEventIndex(
  events: ParsedNativeEvent[],
  role: 'user' | 'agent',
  payload: string,
  ts: number,
): number {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (!event) continue
    if (isDuplicateCodexChatEvent(event, role, payload, ts)) return i
    if (event.agentType === 'codex' && Math.abs(event.ts - ts) > 5 * 60 * 1000) break
  }
  return -1
}

function pushCodexEvent(
  events: ParsedNativeEvent[],
  filePath: string,
  lineOffset: number,
  kind: string,
  sourceSessionKey: string,
  ts: number,
  payload: string,
  title: string,
  modelId: string | null,
  workDir: string,
  role: 'user' | 'agent' = 'agent',
  terminal = false,
  repairHint?: ParsedNativeEvent['repairHint'],
): void {
  if (!payload) return
  events.push({
    agentType: 'codex',
    sourceMode: 'codex_rollout_import',
    sourceSessionKey,
    sourceEventKey: makeCodexEventKey(sourceSessionKey, lineOffset, kind),
    cursor: makeCursor(filePath, lineOffset),
    role,
    ts,
    payload,
    title,
    modelId,
    workDir,
    terminal,
    ...(terminal
      ? {
          terminalState:
            kind === 'turn_aborted' ? 'aborted' as const
              : kind === 'error' ? 'failed' as const
                : 'completed' as const,
        }
      : {}),
    repairHint,
  })
}

function pushCodexToolEvent(
  events: ParsedNativeEvent[],
  filePath: string,
  lineOffset: number,
  kind: string,
  sourceSessionKey: string,
  ts: number,
  toolName: string,
  title: string,
  modelId: string | null,
  workDir: string,
  args?: unknown,
  result?: unknown,
  logical?: { callId?: unknown; completed?: boolean },
): void {
  const sourceEventKey = makeCodexEventKey(sourceSessionKey, lineOffset, kind)
  const callId = typeof logical?.callId === 'string' && logical.callId.trim()
    ? logical.callId.trim()
    : null
  const logicalDigest = callId
    ? createHash('sha256').update(`${sourceSessionKey}\0${callId}`).digest('hex').slice(0, 32)
    : null
  const canonicalMessageKey = logicalDigest ? `tool:${logicalDigest}` : undefined
  const toolCallId = logicalDigest ? `native:tool:${logicalDigest}` : `native:${sourceEventKey}`
  const detailRevision = logical?.completed && logicalDigest ? 2 : 1
  const status = result !== undefined ? 'completed' : 'running'
  events.push({
    agentType: 'codex',
    sourceMode: 'codex_rollout_import',
    sourceSessionKey,
    sourceEventKey,
    cursor: makeCursor(filePath, lineOffset),
    role: 'agent',
    ts,
    payload: buildToolPayload({ name: toolName, toolCallId, detailRevision, status }),
    title,
    modelId,
    workDir,
    ...(canonicalMessageKey ? {
      canonicalMessageKey,
      canonicalMutation: logical?.completed ? 'upsert' : 'append',
    } : {}),
    localToolDetail: {
      toolCallId,
      detailRevision,
      name: toolName,
      ...(args !== undefined ? { args } : {}),
      ...(result !== undefined ? { result } : {}),
      status,
    },
  })
}

function makeCodexEventKey(sourceSessionKey: string, offset: number, kind: string): string {
  // Active/archive are discovery locations, never provider identity. Codex
  // preserves the rollout bytes when moving a thread, so stable thread ID +
  // byte offset + event kind survives rename, move, touch and unarchive.
  return `codex:${sourceSessionKey}:${offset}:${kind}`
}
function parseCodexResponseItem(
  events: ParsedNativeEvent[],
  filePath: string,
  lineOffset: number,
  payload: Record<string, unknown>,
  sourceSessionKey: string,
  ts: number,
  title: string,
  modelId: string | null,
  workDir: string,
): void {
  const itemType = typeof payload.type === 'string' ? payload.type : ''
  if (!itemType) return

  if (itemType === 'message') {
    const parsedMessage = parseCodexResponseMessage(payload)
    if (!parsedMessage) return
    const duplicateIndex = findDuplicateCodexChatEventIndex(events, parsedMessage.role, parsedMessage.payload, ts)
    if (duplicateIndex >= 0) return
    pushCodexEvent(
      events,
      filePath,
      lineOffset,
      `${itemType}:${parsedMessage.role}`,
      sourceSessionKey,
      ts,
      parsedMessage.payload,
      title,
      modelId,
      workDir,
      parsedMessage.role,
      false,
      parsedMessage.repairHint,
    )
    return
  }

  if (itemType === 'function_call') {
    const name = typeof payload.name === 'string' ? payload.name : 'function_call'
    const question = buildCodexUserQuestion(name, payload.arguments)
    if (question) {
      pushCodexEvent(events, filePath, lineOffset, 'user_question', sourceSessionKey, ts,
        buildApprovalPendingPayload(question), title, modelId, workDir)
    }
    pushCodexToolEvent(
      events,
      filePath,
      lineOffset,
      itemType,
      sourceSessionKey,
      ts,
      name,
      title,
      modelId,
      workDir,
      parseStructuredString(payload.arguments),
      undefined,
      { callId: payload.call_id },
    )
    return
  }

  if (itemType === 'function_call_output') {
    const delegationInput = parseCodexDelegationInput(payload)
    if (delegationInput) {
      pushCodexEvent(
        events,
        filePath,
        lineOffset,
        'delegation:user',
        sourceSessionKey,
        ts,
        delegationInput,
        title || delegationInput.slice(0, 80),
        modelId,
        workDir,
        'user',
      )
      return
    }
    pushCodexToolEvent(
      events,
      filePath,
      lineOffset,
      itemType,
      sourceSessionKey,
      ts,
      'function_call_output',
      title,
      modelId,
      workDir,
      undefined,
      payload.output,
      { callId: payload.call_id, completed: true },
    )
    return
  }

  if (itemType === 'custom_tool_call') {
    const name = typeof payload.name === 'string' ? payload.name : 'custom_tool_call'
    const args = payload.input !== undefined ? { input: payload.input } : undefined
    pushCodexToolEvent(
      events,
      filePath,
      lineOffset,
      itemType,
      sourceSessionKey,
      ts,
      name,
      title,
      modelId,
      workDir,
      args,
      undefined,
      { callId: payload.call_id },
    )
    return
  }

  if (itemType === 'custom_tool_call_output') {
    const name = typeof payload.name === 'string' ? payload.name : 'custom_tool_call_output'
    const result = payload.output ?? payload.result ?? payload.content
    pushCodexToolEvent(
      events,
      filePath,
      lineOffset,
      itemType,
      sourceSessionKey,
      ts,
      name,
      title,
      modelId,
      workDir,
      undefined,
      result,
      { callId: payload.call_id, completed: true },
    )
    return
  }

  if (itemType === 'web_search_call') {
    const action = typeof payload.action === 'object' && payload.action !== null
      ? payload.action as Record<string, unknown>
      : null
    pushCodexToolEvent(
      events,
      filePath,
      lineOffset,
      itemType,
      sourceSessionKey,
      ts,
      'web_search',
      title,
      modelId,
      workDir,
      action ?? payload.query,
    )
    return
  }
}

function parseCodexEventMessage(
  events: ParsedNativeEvent[],
  filePath: string,
  lineOffset: number,
  payload: Record<string, unknown>,
  sourceSessionKey: string,
  ts: number,
  title: string,
  modelId: string | null,
  workDir: string,
): void {
  const eventType = typeof payload.type === 'string' ? payload.type : ''
  if (!eventType) return

  if (eventType === 'user_message') {
    const parsedUser = parseCodexUserMessage(payload)
    if (!parsedUser) return
    pushCodexEvent(
      events,
      filePath,
      lineOffset,
      eventType,
      sourceSessionKey,
      ts,
      parsedUser.payload,
      title,
      modelId,
      workDir,
      'user',
      false,
      parsedUser.repairHint,
    )
    return
  }

  if (eventType === 'agent_message') {
    const text = typeof payload.message === 'string' ? normalizeText(payload.message) : ''
    if (!text || isSystemControlPayload(text)) return
    pushCodexEvent(
      events,
      filePath,
      lineOffset,
      eventType,
      sourceSessionKey,
      ts,
      text,
      title,
      modelId,
      workDir,
    )
    return
  }

  if (eventType === 'turn_aborted' || eventType === 'error') {
    const text =
      typeof payload.message === 'string'
        ? normalizeText(payload.message)
        : typeof payload.error === 'string'
          ? normalizeText(payload.error)
          : ''
    if (!text) return
    pushCodexEvent(
      events,
      filePath,
      lineOffset,
      eventType,
      sourceSessionKey,
      ts,
      text,
      title,
      modelId,
      workDir,
      'agent',
      true,
    )
    return
  }

  if (isCodexApprovalEventType(eventType)) {
    pushCodexEvent(
      events,
      filePath,
      lineOffset,
      eventType,
      sourceSessionKey,
      ts,
      buildCodexApprovalPayload(payload),
      title,
      modelId,
      workDir,
      'agent',
    )
    return
  }

  if (eventType === 'exec_command_end') {
    const command = Array.isArray(payload.command) ? payload.command : payload.parsed_cmd ?? payload.command
    const exitCode = payload.exit_code ?? payload.exitCode
    const output = [
      typeof payload.aggregated_output === 'string' ? payload.aggregated_output : '',
      exitCode != null ? `\n(exit ${String(exitCode)})` : '',
    ].join('')
    pushCodexToolEvent(
      events,
      filePath,
      lineOffset,
      eventType,
      sourceSessionKey,
      ts,
      'command_execution',
      title,
      modelId,
      workDir,
      { command },
      output,
    )
    return
  }

  if (eventType === 'patch_apply_end') {
    pushCodexToolEvent(
      events,
      filePath,
      lineOffset,
      eventType,
      sourceSessionKey,
      ts,
      'apply_patch',
      title,
      modelId,
      workDir,
      payload.changes,
      {
        success: payload.success,
        stdout: payload.stdout,
        stderr: payload.stderr,
      },
    )
    return
  }

  if (eventType === 'mcp_tool_call_end') {
    const invocation = typeof payload.invocation === 'object' && payload.invocation !== null
      ? payload.invocation as Record<string, unknown>
      : null
    const tool = typeof invocation?.tool === 'string' ? invocation.tool : 'mcp_tool_call'
    const args = {
      server: invocation?.server,
      ...(typeof invocation?.arguments === 'object' && invocation.arguments !== null
        ? invocation.arguments as Record<string, unknown>
        : {}),
    }
    pushCodexToolEvent(
      events,
      filePath,
      lineOffset,
      eventType,
      sourceSessionKey,
      ts,
      tool,
      title,
      modelId,
      workDir,
      args,
      payload.result,
    )
    return
  }

  if (eventType === 'dynamic_tool_call_request') {
    const tool = typeof payload.tool === 'string' ? payload.tool : 'dynamic_tool_call'
    pushCodexToolEvent(
      events,
      filePath,
      lineOffset,
      eventType,
      sourceSessionKey,
      ts,
      tool,
      title,
      modelId,
      workDir,
      payload.arguments,
      undefined,
      { callId: payload.callId ?? payload.call_id },
    )
    return
  }

  if (eventType === 'dynamic_tool_call_response') {
    const tool = typeof payload.tool === 'string' ? payload.tool : 'dynamic_tool_call'
    pushCodexToolEvent(
      events,
      filePath,
      lineOffset,
      eventType,
      sourceSessionKey,
      ts,
      tool,
      title,
      modelId,
      workDir,
      undefined,
      payload.result ?? payload.output,
      { callId: payload.callId ?? payload.call_id, completed: true },
    )
    return
  }

  if (eventType === 'web_search_end') {
    const action = typeof payload.action === 'object' && payload.action !== null
      ? payload.action as Record<string, unknown>
      : null
    pushCodexToolEvent(
      events,
      filePath,
      lineOffset,
      eventType,
      sourceSessionKey,
      ts,
      'web_search',
      title,
      modelId,
      workDir,
      action ?? payload.query,
      payload.query,
    )
    return
  }

  if (eventType === 'image_generation_end') {
    const savedPath = typeof payload.saved_path === 'string' ? payload.saved_path.trim() : ''
    if (!savedPath) return
    pushCodexEvent(
      events,
      filePath,
      lineOffset,
      eventType,
      sourceSessionKey,
      ts,
      buildImagePayload(savedPath),
      title,
      modelId,
      workDir,
    )
    return
  }

  if (eventType === 'view_image_tool_call') {
    pushCodexToolEvent(
      events,
      filePath,
      lineOffset,
      eventType,
      sourceSessionKey,
      ts,
      'view_image',
      title,
      modelId,
      workDir,
      payload.path ?? payload.image_path ?? payload,
    )
  }
}

function emptyCodexSessionMeta(skipImport = false): {
  sourceSessionKey: string
  workDir: string
  modelId: string | null
  title: string
  skipImport: boolean
} {
  return {
    sourceSessionKey: '',
    workDir: '',
    modelId: null,
    title: '',
    skipImport,
  }
}

function isCodexSubagentSessionMeta(payload: Record<string, unknown>): boolean {
  const threadSource = typeof payload.thread_source === 'string'
    ? payload.thread_source.trim().toLowerCase()
    : ''
  if (threadSource === 'subagent') return true

  const source = typeof payload.source === 'object' && payload.source !== null
    ? payload.source as Record<string, unknown>
    : null
  if (source && typeof source.subagent === 'object' && source.subagent !== null) return true

  const hasParentThread = typeof payload.parent_thread_id === 'string'
    && payload.parent_thread_id.trim().length > 0
  const hasSubagentIdentity =
    typeof payload.agent_nickname === 'string'
    || typeof payload.agent_role === 'string'
    || typeof payload.multi_agent_version === 'string'
  return hasParentThread && hasSubagentIdentity
}

function readCodexSessionMeta(filePath: string): {
  sourceSessionKey: string
  workDir: string
  modelId: string | null
  title: string
  skipImport: boolean
} {
  const fd = fs.openSync(filePath, 'r')
  try {
    const chunks: Buffer[] = []
    let position = 0
    let firstLine = ''

    while (position < 1024 * 1024) {
      const buffer = Buffer.alloc(16 * 1024)
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, position)
      if (bytesRead <= 0) break
      const chunk = buffer.subarray(0, bytesRead)
      chunks.push(chunk)
      position += bytesRead

      const combined = Buffer.concat(chunks)
      const newlineIndex = combined.indexOf(0x0a)
      if (newlineIndex >= 0) {
        firstLine = combined.subarray(0, newlineIndex).toString('utf8')
        break
      }
    }

    if (!firstLine && chunks.length > 0) {
      firstLine = Buffer.concat(chunks).toString('utf8')
    }

    const parsed = safeParse(firstLine)
    if (!parsed || parsed.type !== 'session_meta') {
      return emptyCodexSessionMeta()
    }

    const payload = typeof parsed.payload === 'object' && parsed.payload !== null
      ? (parsed.payload as Record<string, unknown>)
      : null
    if (!payload) {
      return emptyCodexSessionMeta()
    }

    if (isCodexSubagentSessionMeta(payload)) {
      return emptyCodexSessionMeta(true)
    }

    const sourceSessionKey = typeof payload.id === 'string' ? payload.id : ''

    return {
      sourceSessionKey,
      workDir: typeof payload.cwd === 'string' ? payload.cwd : '',
      modelId: readCodexModelId(payload),
      title: lookupCodexThreadName(sourceSessionKey) ?? '',
      skipImport: false,
    }
  } finally {
    fs.closeSync(fd)
  }

  return emptyCodexSessionMeta()
}

function readCodexModelId(payload: Record<string, unknown>): string | null {
  const model = typeof payload.model === 'string' ? payload.model.trim() : ''
  return model || null
}

type CodexRolloutChunk = {
  nextOffset: number
  events: ParsedNativeEvent[]
}

type CodexRolloutCollector = {
  readOffset: number
  onLine: (line: string, lineOffset: number) => void
  finish: (nextOffset: number) => CodexRolloutChunk
}

function createCodexRolloutCollector(
  filePath: string,
  startOffset: number,
): CodexRolloutCollector | CodexRolloutChunk {
  const events: ParsedNativeEvent[] = []
  const metadata = readCodexSessionMeta(filePath)
  let { sourceSessionKey, workDir, modelId, title, skipImport } = metadata
  let nativeTitle = metadata.title
  if (skipImport || shouldIgnoreNativeScanPath(workDir)) {
    return { nextOffset: fs.statSync(filePath).size, events: [] }
  }
  let pendingTerminalState: ParsedNativeEvent['terminalState'] | null = null
  const terminalReplayKeys = new Set<string>()

  const onLine = (line: string, lineOffset: number) => {
    const parsed = safeParse(line)
    if (!parsed) return

    const type = typeof parsed.type === 'string' ? parsed.type : ''
    const payload = typeof parsed.payload === 'object' && parsed.payload !== null
      ? (parsed.payload as Record<string, unknown>)
      : null
    const ts = readTimestamp(parsed.timestamp)
    if (!payload || !ts) return

    if (type === 'session_meta') {
      if (isCodexSubagentSessionMeta(payload)) {
        events.length = 0
        skipImport = true
        return
      }
      sourceSessionKey = typeof payload.id === 'string' ? payload.id : sourceSessionKey
      workDir = typeof payload.cwd === 'string' ? payload.cwd : workDir
      if (shouldIgnoreNativeScanPath(workDir)) {
        events.length = 0
        skipImport = true
        return
      }
      modelId = readCodexModelId(payload) ?? modelId
      const observedNativeTitle = lookupCodexThreadName(sourceSessionKey)
      if (observedNativeTitle) {
        nativeTitle = observedNativeTitle
        title = observedNativeTitle
      }
      return
    }
    if (skipImport) return
    if (!sourceSessionKey) return

    if (type === 'response_item') {
      const parsedMessage = parseCodexResponseMessage(payload)
      if (parsedMessage?.role === 'user' && parsedMessage.titleText && !title) {
        title = parsedMessage.titleText.slice(0, 80)
      }
      parseCodexResponseItem(events, filePath, lineOffset, payload, sourceSessionKey, ts, title, modelId, workDir)
      return
    }

    if (type === 'event_msg') {
      const eventType = typeof payload.type === 'string' ? payload.type : ''
      const terminalState = codexTerminalState(eventType)
      if (terminalState) {
        let markedTerminal = false
        for (let i = events.length - 1; i >= 0; i -= 1) {
          const event = events[i]
          if (event?.agentType !== 'codex') continue
          if (event.role !== 'agent') continue
          if (isToolPayload(event.payload)) continue
          event.terminal = true
          event.terminalState = terminalState
          if (lineOffset >= startOffset && Number(event.cursor?.slice(filePath.length + 1)) < startOffset) {
            terminalReplayKeys.add(event.sourceEventKey)
          }
          markedTerminal = true
          pendingTerminalState = null
          break
        }
        if (!markedTerminal) {
          for (let i = events.length - 1; i >= 0; i -= 1) {
            const event = events[i]
            if (event?.agentType !== 'codex' || event.role !== 'agent') continue
            event.terminal = true
            event.terminalState = terminalState
            if (lineOffset >= startOffset && Number(event.cursor?.slice(filePath.length + 1)) < startOffset) terminalReplayKeys.add(event.sourceEventKey)
            markedTerminal = true
            pendingTerminalState = null
            break
          }
        }
        if (!markedTerminal) pendingTerminalState = terminalState
        return
      }
      if (eventType === 'user_message') {
        const parsedUser = parseCodexUserMessage(payload)
        if (parsedUser?.titleText && !title) title = parsedUser.titleText.slice(0, 80)
        if (parsedUser) {
          const duplicateIndex = findDuplicateCodexChatEventIndex(events, 'user', parsedUser.payload, ts)
          if (duplicateIndex >= 0) events.splice(duplicateIndex, 1)
        }
      } else if (eventType === 'agent_message') {
        const text = typeof payload.message === 'string' ? normalizeText(payload.message) : ''
        if (text && !isSystemControlPayload(text)) {
          const duplicateIndex = findDuplicateCodexChatEventIndex(events, 'agent', text, ts)
          if (duplicateIndex >= 0) events.splice(duplicateIndex, 1)
        }
      }
      const beforeCount = events.length
      parseCodexEventMessage(events, filePath, lineOffset, payload, sourceSessionKey, ts, title, modelId, workDir)
      if (pendingTerminalState && events.length > beforeCount) {
        events[events.length - 1]!.terminal = true
        events[events.length - 1]!.terminalState = pendingTerminalState
        pendingTerminalState = null
      }
    }
  }

  return {
    readOffset: findJsonlLookbackOffset(filePath, startOffset),
    onLine,
    finish: (nextOffset) => {
      for (const event of events) {
        event.titleSource = nativeTitle && event.title === nativeTitle
          ? 'agent_native'
          : 'first_user_fallback'
      }
      return {
        nextOffset,
        events: events.filter((event) => terminalReplayKeys.has(event.sourceEventKey)
          || Number(event.cursor?.slice(filePath.length + 1)) >= startOffset),
      }
    },
  }
}

function isCodexRolloutChunk(
  value: CodexRolloutCollector | CodexRolloutChunk,
): value is CodexRolloutChunk {
  return 'nextOffset' in value
}

export function parseCodexRolloutChunk(
  filePath: string,
  startOffset: number,
): CodexRolloutChunk {
  const collector = createCodexRolloutCollector(filePath, startOffset)
  if (isCodexRolloutChunk(collector)) return collector
  return collector.finish(readJsonlLines(filePath, collector.readOffset, collector.onLine))
}

export async function parseCodexRolloutChunkCooperatively(
  filePath: string,
  startOffset: number,
): Promise<CodexRolloutChunk> {
  const collector = createCodexRolloutCollector(filePath, startOffset)
  if (isCodexRolloutChunk(collector)) return collector
  return collector.finish(
    await readJsonlLinesCooperatively(filePath, collector.readOffset, collector.onLine),
  )
}
