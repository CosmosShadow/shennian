// @covers open-source/packages/cli/src/native-fusion/claude-entry-parser.ts
// @covers open-source/packages/cli/src/native-fusion/parsers.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseUserMessagePayload } from '@shennian/wire'
import { NativeFusionLocalRepository } from '../native-fusion/local-repository.js'
import { parseClaudeTranscriptChunk } from '../native-fusion/parsers.js'
import { CanonicalSessionStore } from '../session/canonical-store.js'
import { cleanupNativeParserTest, writeTempFile } from './native-fusion-parser-harness.js'

const SESSION = '49366b09-086d-40d6-9717-0c7d4afb85b1'
// 1x1 transparent PNG
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

let tick = 0
function line(entry: Record<string, unknown>): string {
  tick += 1
  return JSON.stringify({
    timestamp: `2026-09-19T16:16:${String(tick).padStart(2, '0')}.000Z`,
    cwd: '/work/demo',
    sessionId: SESSION,
    ...entry,
  })
}

function parse(entries: Array<Record<string, unknown>>) {
  tick = 0
  const filePath = writeTempFile(`${SESSION}.jsonl`, `${entries.map(line).join('\n')}\n`)
  return parseClaudeTranscriptChunk(filePath, 0).events
}

function toolPayload(payload: string): Record<string, unknown> {
  return JSON.parse(payload) as Record<string, unknown>
}

describe('claude transcript parser', () => {
  afterEach(cleanupNativeParserTest)

  it('keeps a user message whose content is a block array with images', () => {
    const events = parse([
      {
        type: 'user',
        origin: { kind: 'human' },
        message: {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_BASE64 } },
            { type: 'text', text: '你看一下这张图' },
          ],
        },
      },
    ])

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ role: 'user', title: '你看一下这张图' })
    const payload = parseUserMessagePayload(events[0]!.payload)
    expect(payload?.content).toBe('你看一下这张图')
    expect(payload?.attachments).toHaveLength(1)
    const attachment = payload!.attachments![0]!
    expect(attachment).toMatchObject({ kind: 'image', mimeType: 'image/png', name: expect.stringMatching(/\.png$/) })
    expect(fs.statSync(attachment.path).size).toBe(attachment.byteSize)
  })

  it('keeps an image-only user message and text blocks without an image', () => {
    const events = parse([
      {
        type: 'user',
        message: {
          content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_BASE64 } }],
        },
      },
      { type: 'user', message: { content: [{ type: 'text', text: 'plain block text' }] } },
    ])

    expect(events.map((event) => event.role)).toEqual(['user', 'user'])
    expect(parseUserMessagePayload(events[0]!.payload)?.content).toBe('')
    expect(events[1]!.payload).toBe('plain block text')
  })

  it('imports a human message typed while the agent was running, but not machine notifications', () => {
    const events = parse([
      { type: 'user', message: { content: 'first' } },
      {
        type: 'attachment',
        attachment: { type: 'queued_command', prompt: '中途插话', commandMode: 'prompt', origin: { kind: 'human' } },
      },
      {
        type: 'attachment',
        attachment: {
          type: 'queued_command',
          prompt: '<task-notification>done</task-notification>',
          commandMode: 'task-notification',
          origin: { kind: 'task-notification' },
        },
      },
      {
        type: 'attachment',
        attachment: { type: 'queued_command', prompt: 'legacy queued', commandMode: 'prompt' },
      },
    ])

    expect(events.map((event) => [event.role, event.payload])).toEqual([
      ['user', 'first'],
      ['user', '中途插话'],
      ['user', 'legacy queued'],
    ])
  })

  it('drops machine-generated user turns and reads slash commands as the command text', () => {
    const events = parse([
      { type: 'user', isMeta: true, message: { content: '<local-command-caveat>ignore</local-command-caveat>' } },
      { type: 'user', message: { content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } },
      { type: 'user', isCompactSummary: true, message: { content: 'This session is being continued…' } },
      { type: 'user', isSidechain: true, message: { content: 'subagent prompt' } },
      { type: 'user', message: { content: '<local-command-stdout>ok</local-command-stdout>' } },
      {
        type: 'user',
        message: {
          content:
            '<command-message>shennian</command-message>\n<command-name>/shennian:shennian</command-name>\n<command-args>join room</command-args>',
        },
      },
    ])

    expect(events.map((event) => event.payload)).toEqual(['/shennian:shennian join room'])
  })

  it('emits assistant text in order around tool calls and ignores thinking', () => {
    const events = parse([
      { type: 'user', message: { content: 'go' } },
      {
        type: 'assistant',
        message: {
          model: 'claude-sonnet-5',
          content: [
            { type: 'thinking', thinking: 'hidden reasoning' },
            { type: 'text', text: 'before tool' },
            { type: 'tool_use', id: 'toolu_a', name: 'Bash', input: { command: 'ls' } },
            { type: 'text', text: 'after tool' },
          ],
        },
      },
    ])

    expect(events.map((event) => event.role)).toEqual(['user', 'agent', 'agent', 'agent'])
    expect(events[1]!.payload).toBe('before tool')
    expect(toolPayload(events[2]!.payload)).toMatchObject({ type: 'tool', name: 'Bash', status: 'running' })
    expect(events[3]!.payload).toBe('after tool')
    expect(new Set(events.map((event) => event.sourceEventKey)).size).toBe(4)
    expect(JSON.stringify(events)).not.toContain('hidden reasoning')
  })

  it('folds a tool_result into the same canonical tool card, across separate lines', () => {
    const events = parse([
      { type: 'user', message: { content: 'go' } },
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 'toolu_a', name: 'Bash', input: { command: 'ls' } }] },
      },
      {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'toolu_a', content: [{ type: 'text', text: 'a.txt' }] }],
        },
      },
      {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'toolu_b', is_error: true, content: 'boom' }],
        },
      },
    ])

    const [, call, done, failed] = events
    expect(events.map((event) => event.role)).toEqual(['user', 'agent', 'agent', 'agent'])
    expect(done!.canonicalMessageKey).toBe(call!.canonicalMessageKey)
    expect(done!.canonicalMutation).toBe('upsert')
    expect(call!.canonicalMutation).toBe('append')
    expect(toolPayload(done!.payload)).toMatchObject({ toolCallId: toolPayload(call!.payload).toolCallId, status: 'completed' })
    expect(call!.localToolDetail).toMatchObject({ name: 'Bash', args: { command: 'ls' }, status: 'running' })
    expect(done!.localToolDetail).toMatchObject({ result: 'a.txt', status: 'completed', detailRevision: 2 })
    expect(failed!.localToolDetail).toMatchObject({ result: 'boom', status: 'failed' })
    // a tool_result never becomes a user message, so it cannot close a managed-echo window
    expect(events.filter((event) => event.role === 'user')).toHaveLength(1)
  })

  it('keeps the legacy event key for the first assistant text so earlier ledger entries still dedupe', () => {
    const events = parse([
      { type: 'user', message: { content: 'go' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'answer' }] } },
    ])

    expect(events[1]!.sourceEventKey).toMatch(/^[0-9a-f]{16}:\d+:assistant$/)
    expect(events[0]!.sourceEventKey).toMatch(/^[0-9a-f]{16}:0:user$/)
  })

  it('ignores queue bookkeeping and other non-conversation entries', () => {
    const events = parse([
      { type: 'queue-operation', operation: 'enqueue', content: 'x' },
      { type: 'last-prompt' },
      { type: 'system', subtype: 'stop_hook_summary' },
      { type: 'attachment', attachment: { type: 'date', date: '2026-09-20' } },
    ])

    expect(events).toEqual([])
  })

  it('commits a real transcript into canonical: user turns, text and one tool card per call', () => {
    tick = 0
    const first = [
      { type: 'user', message: { content: [{ type: 'text', text: '第一问' }] } },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: '我先看看' },
            { type: 'tool_use', id: 'toolu_a', name: 'Bash', input: { command: 'ls' } },
          ],
        },
      },
    ].map(line).join('\n') + '\n'
    const filePath = writeTempFile(`${SESSION}.jsonl`, first)
    const firstChunk = parseClaudeTranscriptChunk(filePath, 0)

    // The tool result and the next human turn only arrive in a later scan.
    fs.appendFileSync(filePath, [
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_a', content: 'a.txt' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: '看完了' }] } },
      { type: 'attachment', attachment: { type: 'queued_command', prompt: '第二问', origin: { kind: 'human' } } },
    ].map(line).join('\n') + '\n')
    const secondChunk = parseClaudeTranscriptChunk(filePath, firstChunk.nextOffset)

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-canonical-'))
    try {
      const canonical = new CanonicalSessionStore(path.join(root, 'canonical'), 'daemon-installation-test')
      const details = new Map<string, unknown>()
      const repository = new NativeFusionLocalRepository({
        rootDir: path.join(root, 'native-fusion'),
        daemonInstallationId: 'daemon-installation-test',
        canonicalStore: canonical,
        recordLocalSession: vi.fn(),
        writeLocalToolDetail: (detail) => { details.set(detail.toolCallId, detail) },
        readLocalToolDetail: (_sessionId, toolCallId) => (details.get(toolCallId) ?? null) as never,
      })
      let sessionId = ''
      for (const event of [...firstChunk.events, ...secondChunk.events]) {
        sessionId = repository.commitEvent(event).sessionId
      }

      const messages = canonical.readRecent(sessionId, 20).messages
      expect(messages.map((message) => message.role)).toEqual(['user', 'agent', 'agent', 'agent', 'user'])
      expect(messages[0]!.payload).toBe('第一问')
      expect(messages[1]!.payload).toBe('我先看看')
      expect(JSON.parse(messages[2]!.payload)).toMatchObject({
        type: 'tool', name: 'Bash', status: 'completed', detailRevision: 2,
      })
      expect(messages[3]!.payload).toBe('看完了')
      expect(messages[4]!.payload).toBe('第二问')
      expect([...details.values()]).toEqual([
        expect.objectContaining({ name: 'Bash', args: { command: 'ls' }, result: 'a.txt', status: 'completed' }),
      ])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
