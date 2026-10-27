// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/acp-adapter.test.ts

import type { ContentBlock, SessionUpdate, ToolCallContent } from '@agentclientprotocol/sdk'
import type { AgentEvent } from '../adapter.js'

export type AcpEventFactory = (
  partial: Omit<AgentEvent, 'runId' | 'seq'>,
) => AgentEvent

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function contentText(content: ContentBlock): string {
  if (content.type === 'text') return content.text
  if (content.type === 'resource_link') return content.name || content.uri
  if (content.type === 'resource') {
    return 'text' in content.resource ? content.resource.text : `[${content.resource.mimeType ?? 'resource'}]`
  }
  return `[${content.type}: ${content.mimeType}]`
}

function toolContentText(items: ToolCallContent[] | null | undefined): string {
  if (!items?.length) return ''
  return items.map((item) => {
    if (item.type === 'content') return contentText(item.content)
    if (item.type === 'diff') return `${item.path}\n${item.newText}`
    return `[terminal: ${item.terminalId}]`
  }).join('\n')
}

export function mapAcpSessionUpdate(
  update: SessionUpdate,
  makeEvent: AcpEventFactory,
): AgentEvent[] {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      return [makeEvent({ state: 'delta', text: contentText(update.content) })]
    case 'agent_thought_chunk':
      return [makeEvent({ state: 'delta', text: contentText(update.content), thinking: true })]
    case 'tool_call':
      return [makeEvent({
        state: 'tool-call',
        toolCallId: update.toolCallId,
        toolStatus: 'running',
        name: update.title,
        args: typeof update.rawInput === 'object' && update.rawInput !== null
          ? update.rawInput as Record<string, unknown>
          : update.rawInput === undefined ? undefined : { input: update.rawInput },
      })]
    case 'tool_call_update': {
      if (update.status !== 'completed' && update.status !== 'failed') return []
      const result = toolContentText(update.content)
        || (update.rawOutput === undefined ? update.status : stringifyUnknown(update.rawOutput))
      return [makeEvent({ state: 'tool-result', toolCallId: update.toolCallId, toolStatus: update.status, name: update.title ?? update.toolCallId, result })]
    }
    case 'usage_update':
      // ACP v1 reports context occupancy rather than per-turn input/output. Keep it
      // as a notification instead of inventing incompatible token accounting.
      return [makeEvent({ state: 'notify', title: 'Context usage', text: `${update.used}/${update.size}` })]
    case 'plan':
    case 'plan_update':
      return [makeEvent({ state: 'notify', title: 'Plan updated', text: stringifyUnknown(update) })]
    case 'session_info_update':
      return update.title ? [makeEvent({ state: 'notify', title: 'Session', text: update.title })] : []
    default:
      return []
  }
}
