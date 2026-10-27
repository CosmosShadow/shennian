import type { Envelope } from '@shennian/wire'

export type AgentRunTextSegment = {
  type: 'text'
  content: string
  thinking?: string
}

export type AgentRunToolSegment = {
  type: 'tool'
  name: string
  args?: unknown
  result?: string
}

export type AgentRunSegment = AgentRunTextSegment | AgentRunToolSegment

export type AgentRun = {
  runId: string
  ts: number
  segments: AgentRunSegment[]
}

export function getAgentRunPrefix(runId: string): string {
  return `agent-${runId}-`
}

export function getAgentRunSeq(id: string, runId: string): number | null {
  const prefix = getAgentRunPrefix(runId)
  if (!id.startsWith(prefix)) return null
  const seq = Number(id.slice(prefix.length))
  return Number.isInteger(seq) && seq >= 0 ? seq : null
}

export function buildAgentRunEnvelopes(sessionId: string, run: AgentRun): Envelope[] {
  const messages: Envelope[] = []
  let seq = 0
  for (const seg of run.segments) {
    const id = `${getAgentRunPrefix(run.runId)}${seq}`
    seq++
    const payload = seg.type === 'tool'
      ? JSON.stringify({ v: 1, type: 'tool', name: seg.name, args: seg.args, result: seg.result })
      : (seg.thinking
          ? JSON.stringify({ v: 1, content: seg.content, thinking: seg.thinking })
          : seg.content)
    if (!payload) continue
    messages.push({
      id,
      sessionId,
      role: 'agent',
      ts: run.ts + seq,
      payload,
    })
  }
  return messages
}

export function hydrateAgentRunFromEnvelopes(runId: string, envelopes: Envelope[]): AgentRun | null {
  const segments: Array<{ seq: number; segment: AgentRunSegment; ts: number }> = []

  for (const env of envelopes) {
    const seq = getAgentRunSeq(env.id, runId)
    if (seq === null) continue
    const segment = payloadToSegment(env.payload)
    if (!segment) continue
    segments.push({ seq, segment, ts: env.ts })
  }

  if (segments.length === 0) return null

  segments.sort((a, b) => a.seq - b.seq)
  return {
    runId,
    ts: Math.max(0, segments[0].ts - 1),
    segments: segments.map((s) => s.segment),
  }
}

function payloadToSegment(payload: string): AgentRunSegment | null {
  if (payload.startsWith('{"v":1,')) {
    try {
      const parsed = JSON.parse(payload) as {
        type?: string
        content?: string
        thinking?: string
        name?: string
        args?: unknown
        result?: string
      }
      if (parsed.type === 'tool' && parsed.name) {
        return {
          type: 'tool',
          name: parsed.name,
          args: parsed.args,
          result: parsed.result,
        }
      }
      return {
        type: 'text',
        content: parsed.content ?? '',
        thinking: parsed.thinking || undefined,
      }
    } catch {
      return { type: 'text', content: payload }
    }
  }
  return { type: 'text', content: payload }
}
