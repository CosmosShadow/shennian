// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/native-fusion-parsers.test.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveBuiltinCommand, spawnResolvedCommandSync } from '../agents/command-spec.js'
import { normalizeNativeTimestamp } from './session-header.js'
import type { ParsedNativeEvent } from './types.js'

export type OpenCodeSnapshot = {
  sessions: Array<{
    id: string
    title: string
    directory: string
    time_created?: number
    time_updated?: number
  }>
  messages: Array<{
    id: string
    session_id: string
    time_created: number
    data: string
  }>
  parts: Array<{
    id: string
    message_id: string
    session_id: string
    time_created: number
    data: string
  }>
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function textFromOpenCodeParts(parts: Array<Record<string, unknown>>): string {
  return parts
    .filter((part) => part.type === 'text' || part.type === 'reasoning')
    .map((part) => typeof part.text === 'string' ? part.text : '')
    .filter(Boolean)
    .join('\n\n')
    .trim()
}

function pushOpenCodeEvent(
  events: ParsedNativeEvent[],
  snapshotPath: string,
  session: OpenCodeSnapshot['sessions'][number],
  message: OpenCodeSnapshot['messages'][number],
  role: 'user' | 'agent',
  payload: string,
  modelId: string | null,
  terminal: boolean,
): void {
  if (!payload) return
  const eventTimestamp = normalizeNativeTimestamp(message.time_created)
  const sourceSessionCreatedAtMs = normalizeNativeTimestamp(session.time_created)
  if (!eventTimestamp || !sourceSessionCreatedAtMs) return
  events.push({
    agentType: 'opencode',
    sourceMode: 'opencode_session_import',
    sourceSessionKey: session.id,
    sourceEventKey: `opencode:${session.id}:${message.id}:${role}`,
    cursor: `${snapshotPath}:${message.time_created}:${message.id}`,
    role,
    ts: eventTimestamp,
    payload,
    title: session.title,
    titleSource: 'agent_native',
    modelId,
    workDir: session.directory,
    terminal,
    sourceSessionCreatedAtMs,
  })
}

export function parseOpenCodeSessionSnapshot(snapshotPath: string, snapshot: OpenCodeSnapshot): ParsedNativeEvent[] {
  const events: ParsedNativeEvent[] = []
  const sessionsById = new Map(snapshot.sessions.map((session) => [session.id, session]))
  const partsByMessage = new Map<string, Array<Record<string, unknown>>>()
  for (const partRow of snapshot.parts) {
    const data = parseJsonObject(partRow.data)
    if (!data) continue
    const list = partsByMessage.get(partRow.message_id) ?? []
    list.push(data)
    partsByMessage.set(partRow.message_id, list)
  }

  for (const message of [...snapshot.messages].sort((left, right) => left.time_created - right.time_created)) {
    const session = sessionsById.get(message.session_id)
    if (!session) continue
    const data = parseJsonObject(message.data)
    if (!data) continue
    const role = data.role === 'user' ? 'user' : data.role === 'assistant' ? 'agent' : null
    if (!role) continue
    const parts = partsByMessage.get(message.id) ?? []
    const payload = textFromOpenCodeParts(parts)
    const modelId = typeof data.modelID === 'string'
      ? `${typeof data.providerID === 'string' ? `${data.providerID}/` : ''}${data.modelID}`
      : null
    pushOpenCodeEvent(events, snapshotPath, session, message, role, payload, modelId, role === 'agent')
  }
  return events
}

export function listOpenCodeSessionFiles(): string[] {
  const dataDir = path.join(os.homedir(), '.local', 'share', 'opencode')
  const snapshot = path.join(dataDir, 'shennian-opencode-session-snapshot.opencode-session.json')
  refreshOpenCodeSessionSnapshot(snapshot)
  return fs.existsSync(snapshot) ? [snapshot] : []
}

function queryOpenCodeDb(query: string): unknown[] {
  const spec = resolveBuiltinCommand('opencode')
  if (!spec) return []
  const result = spawnResolvedCommandSync(spec, ['db', query, '--format', 'json'], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 10_000,
  })
  if (result.status !== 0) return []
  try {
    const parsed = JSON.parse(String(result.stdout ?? '')) as unknown
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function refreshOpenCodeSessionSnapshot(snapshotPath: string): void {
  try {
    const sessions = queryOpenCodeDb(
      'select id, title, directory, time_created, time_updated from session where time_archived is null order by time_updated asc',
    )
    if (sessions.length === 0) return
    const messages = queryOpenCodeDb(
      'select id, session_id, time_created, data from message order by time_created asc, id asc',
    )
    const parts = queryOpenCodeDb(
      'select id, message_id, session_id, time_created, data from part order by message_id asc, id asc',
    )
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true })
    fs.writeFileSync(snapshotPath, JSON.stringify({ sessions, messages, parts }))
  } catch {
    /* best-effort native import */
  }
}

export function parseOpenCodeSessionFile(filePath: string, startOffset: number): {
  nextOffset: number
  events: ParsedNativeEvent[]
} {
  const stat = fs.statSync(filePath)
  if (startOffset >= stat.size) return { nextOffset: stat.size, events: [] }
  if (startOffset > 0) return { nextOffset: stat.size, events: [] }
  const snapshot = JSON.parse(fs.readFileSync(filePath, 'utf8')) as OpenCodeSnapshot
  return {
    nextOffset: stat.size,
    events: parseOpenCodeSessionSnapshot(filePath, snapshot),
  }
}
