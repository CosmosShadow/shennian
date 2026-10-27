// @covers open-source/packages/cli/src/native-fusion/parsers.ts
// @covers open-source/packages/cli/src/native-fusion/codex-files.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  listCodexRolloutFiles,
  inspectNativeSessionFile,
  parseClaudeTranscriptChunk,
  parseCodexRolloutChunk,
  parseCodexRolloutChunkCooperatively,
} from '../native-fusion/parsers.js'
import {
  readJsonlLines,
  readJsonlLinesCooperatively,
  shouldIgnoreNativeScanPath,
} from '../native-fusion/parser-common.js'
import { isCodexRolloutTailInterrupted } from '../native-fusion/codex-files.js'

import {
  cleanupNativeParserTest,
  registerNativeParserTempDir,
  writeTempFile,
} from './native-fusion-parser-harness.js'

describe('native-fusion parsers', () => {
  afterEach(cleanupNativeParserTest)

  it('ignores the reserved real Agent E2E work directory only', () => {
    expect(shouldIgnoreNativeScanPath(path.join(os.tmpdir(), 'shennian-agent-e2e'))).toBe(true)
    expect(shouldIgnoreNativeScanPath(path.join(os.tmpdir(), 'ordinary-user-project'))).toBe(false)
  })

  it('drains an arbitrarily large complete JSONL snapshot without a total byte limit', async () => {
    const line = `${'x'.repeat(1022)}\n`
    const filePath = writeTempFile(
      'large-transcript.jsonl',
      line.repeat(Math.ceil((5 * 1024 * 1024) / line.length)),
    )
    const fileSize = fs.statSync(filePath).size
    let syncLines = 0
    let cooperativeLines = 0
    let yielded = false
    setImmediate(() => {
      yielded = true
    })

    const syncCursor = readJsonlLines(filePath, 0, () => {
      syncLines += 1
    })
    const cooperativeCursor = await readJsonlLinesCooperatively(filePath, 0, () => {
      cooperativeLines += 1
    })

    expect(syncCursor).toBe(fileSize)
    expect(cooperativeCursor).toBe(fileSize)
    expect(syncLines).toBe(fileSize / Buffer.byteLength(line))
    expect(cooperativeLines).toBe(syncLines)
    expect(yielded).toBe(true)
  })

  it('advances a codex cursor when its 64-line lookback exceeds the former 2 MiB boundary', async () => {
    const sessionMeta = JSON.stringify({
      timestamp: '2026-09-07T03:55:00.000Z',
      type: 'session_meta',
      payload: { id: 'thread-large-lookback', cwd: '/tmp/demo', model: 'gpt-5.6-sol' },
    })
    const contextLines = Array.from({ length: 47 }, (_, ordinal) =>
      JSON.stringify({
        timestamp: '2026-09-07T03:55:01.000Z',
        ordinal,
        type: 'response_item',
        payload: {
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: 'x'.repeat(45_000) }],
        },
      }),
    )
    const prefix = `${[sessionMeta, ...contextLines].join('\n')}\n`
    const cursor = Buffer.byteLength(prefix)
    const appended = [
      JSON.stringify({
        timestamp: '2026-09-07T03:56:00.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          phase: 'final_answer',
          content: [{ type: 'output_text', text: 'large lookback recovered' }],
        },
      }),
      JSON.stringify({
        timestamp: '2026-09-07T03:56:01.000Z',
        type: 'event_msg',
        payload: { type: 'turn_completed' },
      }),
      '',
    ].join('\n')
    const filePath = writeTempFile('codex-large-lookback.jsonl', prefix + appended)

    const parsed = await parseCodexRolloutChunkCooperatively(filePath, cursor)

    expect(cursor).toBeGreaterThan(2 * 1024 * 1024)
    expect(parsed.nextOffset).toBe(fs.statSync(filePath).size)
    expect(parsed.nextOffset).toBeGreaterThan(cursor)
    expect(parsed.events).toEqual([
      expect.objectContaining({
        role: 'agent',
        payload: 'large lookback recovered',
        terminal: true,
      }),
    ])
  })

  it('lists codex rollouts from active and archived session directories', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'native-fusion-home-'))
    registerNativeParserTempDir(home)
    vi.spyOn(os, 'homedir').mockReturnValue(home)
    const activeDir = path.join(home, '.codex', 'sessions', '2026', '05', '06')
    const archivedDir = path.join(home, '.codex', 'archived_sessions')
    fs.mkdirSync(activeDir, { recursive: true })
    fs.mkdirSync(archivedDir, { recursive: true })
    const activeFile = path.join(activeDir, 'rollout-active.jsonl')
    const archivedFile = path.join(archivedDir, 'rollout-archived.jsonl')
    fs.writeFileSync(activeFile, '')
    fs.writeFileSync(archivedFile, '')
    fs.writeFileSync(path.join(archivedDir, 'notes.txt'), '')

    expect(listCodexRolloutFiles()).toEqual([archivedFile, activeFile].sort())
  })

  it('treats only the latest Codex lifecycle event as an interrupted tail', () => {
    const aborted = JSON.stringify({ type: 'event_msg', payload: { type: 'turn_aborted' } })
    const resumed = JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } })
    expect(isCodexRolloutTailInterrupted(aborted)).toBe(true)
    expect(isCodexRolloutTailInterrupted(`${aborted}\n${resumed}`)).toBe(false)
  })

  it('parses codex rollout user and agent messages', () => {
    const filePath = writeTempFile(
      'rollout.jsonl',
      [
        JSON.stringify({
          timestamp: '2026-04-23T10:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'thread-1', cwd: '/tmp/demo', model_provider: 'openai' },
        }),
        JSON.stringify({
          timestamp: '2026-04-23T10:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: 'hello codex' },
        }),
        JSON.stringify({
          timestamp: '2026-04-23T10:00:02.000Z',
          type: 'event_msg',
          payload: { type: 'agent_message', message: 'hello human' },
        }),
        '',
      ].join('\n'),
    )

    const parsed = parseCodexRolloutChunk(filePath, 0)
    expect(parsed.events).toHaveLength(2)
    expect(parsed.events[0]).toMatchObject({
      agentType: 'codex',
      sourceSessionKey: 'thread-1',
      role: 'user',
      payload: 'hello codex',
      workDir: '/tmp/demo',
    })
    expect(parsed.events[1]).toMatchObject({
      role: 'agent',
      payload: 'hello human',
    })
  })

  it('keeps Codex provider event identity stable across active/archive paths', () => {
    const providerEvents = Array.from({ length: 15 }, (_, index) =>
      JSON.stringify({
        timestamp: `2026-09-03T02:00:${String(index + 1).padStart(2, '0')}.000Z`,
        type: 'event_msg',
        payload: {
          type: index % 2 === 0 ? 'user_message' : 'agent_message',
          message: `fixture-event-${index + 1}`,
        },
      }),
    )
    const content = [
      JSON.stringify({
        timestamp: '2026-09-03T02:00:00.000Z',
        type: 'session_meta',
        payload: { id: 'thread-moved', cwd: '/tmp/demo', model_provider: 'openai' },
      }),
      ...providerEvents,
      '',
    ].join('\n')
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-move-identity-'))
    registerNativeParserTempDir(root)
    const active = path.join(root, '.codex', 'sessions', '2026', '09', '03', 'rollout.jsonl')
    const archived = path.join(root, '.codex', 'archived_sessions', 'rollout.jsonl')
    fs.mkdirSync(path.dirname(active), { recursive: true })
    fs.mkdirSync(path.dirname(archived), { recursive: true })
    fs.writeFileSync(active, content)
    fs.writeFileSync(archived, content)

    const activeEvents = parseCodexRolloutChunk(active, 0).events
    const archivedEvents = parseCodexRolloutChunk(archived, 0).events
    expect(activeEvents).toHaveLength(15)
    expect(new Set(activeEvents.map((event) => event.sourceEventKey)).size).toBe(15)
    expect(archivedEvents.map((event) => event.sourceEventKey)).toEqual(
      activeEvents.map((event) => event.sourceEventKey),
    )
    expect(activeEvents.every((event) => !event.sourceEventKey.includes(root))).toBe(true)
  })

  it('does not import Codex rollouts created by the real Agent E2E smoke', () => {
    const workDir = path.join(os.tmpdir(), 'shennian-agent-e2e')
    const filePath = writeTempFile(
      'rollout-agent-e2e.jsonl',
      [
        JSON.stringify({
          timestamp: '2026-09-03T10:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'thread-agent-e2e', cwd: workDir, model_provider: 'openai' },
        }),
        JSON.stringify({
          timestamp: '2026-09-03T10:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: 'SHENNIAN_AGENT_E2E_OK_fixture' },
        }),
        '',
      ].join('\n'),
    )

    expect(parseCodexRolloutChunk(filePath, 0)).toEqual({
      nextOffset: fs.statSync(filePath).size,
      events: [],
    })
  })

  it('reads trustworthy native creation time and leaves incomplete headers pending', () => {
    const codexDir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-fusion-header-'))
    registerNativeParserTempDir(codexDir)
    const codexRoot = path.join(codexDir, '.codex', 'sessions')
    fs.mkdirSync(codexRoot, { recursive: true })
    const complete = path.join(codexRoot, 'rollout-complete.jsonl')
    fs.writeFileSync(
      complete,
      `${JSON.stringify({
        timestamp: '2026-09-01T08:00:10.000Z',
        type: 'session_meta',
        payload: { id: 'thread-header' },
      })}\n`,
    )
    const pending = path.join(codexRoot, 'rollout-pending.jsonl')
    fs.writeFileSync(pending, '{"timestamp":"2026-09-01')

    expect(inspectNativeSessionFile(complete)).toEqual({
      status: 'ready',
      createdAtMs: Date.parse('2026-09-01T08:00:10.000Z'),
      sources: [{ agentType: 'codex', sourceSessionKey: 'thread-header' }],
    })
    expect(inspectNativeSessionFile(pending)).toEqual({ status: 'pending' })
  })

  it('keeps an unterminated JSONL record behind the returned cursor', () => {
    const complete = `${JSON.stringify({
      timestamp: '2026-04-23T10:00:00.000Z',
      type: 'user',
      message: { content: 'complete' },
    })}\n`
    const filePath = writeTempFile('claude-partial.jsonl', `${complete}{"type":"assistant"`)

    const parsed = parseClaudeTranscriptChunk(filePath, 0)
    expect(parsed.nextOffset).toBe(Buffer.byteLength(complete))
    expect(parsed.events).toHaveLength(1)
  })

  it('parses codex rollout tool events from response_item and event_msg records', () => {
    const filePath = writeTempFile(
      'rollout-tools.jsonl',
      [
        JSON.stringify({
          timestamp: '2026-04-23T10:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'thread-tools-1', cwd: '/tmp/demo', model: 'gpt-5.3-codex' },
        }),
        JSON.stringify({
          timestamp: '2026-04-23T10:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: 'shell_command',
            arguments: '{"command":"pwd","workdir":"/tmp/demo"}',
            call_id: 'call-1',
          },
        }),
        JSON.stringify({
          timestamp: '2026-04-23T10:00:02.000Z',
          type: 'event_msg',
          payload: {
            type: 'exec_command_end',
            command: ['/bin/zsh', '-lc', 'pwd'],
            aggregated_output: '/tmp/demo\n',
            exit_code: 0,
          },
        }),
        JSON.stringify({
          timestamp: '2026-04-23T10:00:03.000Z',
          type: 'event_msg',
          payload: {
            type: 'mcp_tool_call_end',
            invocation: {
              server: 'chrome-devtools',
              tool: 'list_pages',
              arguments: {},
            },
            result: {
              Ok: {
                content: [{ type: 'text', text: '## Pages\n1: http://localhost:8081 [selected]' }],
              },
            },
          },
        }),
        '',
      ].join('\n'),
    )

    const parsed = parseCodexRolloutChunk(filePath, 0)
    expect(parsed.events).toHaveLength(3)
    expect(parsed.events[0]).toMatchObject({
      role: 'agent',
      modelId: 'gpt-5.3-codex',
    })
    expect(JSON.parse(parsed.events[0]!.payload)).toMatchObject({
      v: 1,
      type: 'tool',
      name: 'shell_command',
      status: 'running',
      resultOmitted: true,
      detailAvailable: true,
    })
    expect(JSON.parse(parsed.events[1]!.payload)).toMatchObject({
      v: 1,
      type: 'tool',
      name: 'command_execution',
      status: 'completed',
      resultOmitted: true,
      detailAvailable: true,
    })
    expect(JSON.parse(parsed.events[2]!.payload)).toMatchObject({
      v: 1,
      type: 'tool',
      name: 'list_pages',
      status: 'completed',
      resultOmitted: true,
      detailAvailable: true,
    })
    for (const event of parsed.events) {
      const payload = JSON.parse(event.payload) as Record<string, unknown>
      expect(payload.toolCallId).toBe(event.localToolDetail?.toolCallId)
      expect(payload.detailRevision).toBe(event.localToolDetail?.detailRevision)
      expect(payload).not.toHaveProperty('args')
      expect(payload).not.toHaveProperty('argsSummary')
      expect(payload).not.toHaveProperty('result')
      expect(event.payload).not.toContain('localhost:8081')
    }
    expect(parsed.events[0]?.localToolDetail).toMatchObject({
      name: 'shell_command',
      args: { command: 'pwd', workdir: '/tmp/demo' },
      status: 'running',
    })
    expect(parsed.events[1]?.localToolDetail).toMatchObject({
      name: 'command_execution',
      result: expect.stringContaining('/tmp/demo'),
      status: 'completed',
    })
    expect(parsed.events[2]?.localToolDetail).toMatchObject({
      name: 'list_pages',
      result: expect.anything(),
      status: 'completed',
    })
  })

  it('assigns call and output the same canonical tool identity', () => {
    const filePath = writeTempFile(
      'rollout-logical-tool.jsonl',
      [
        JSON.stringify({
          timestamp: '2026-09-02T01:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'thread-logical-tool', cwd: '/tmp/demo' },
        }),
        JSON.stringify({
          timestamp: '2026-09-02T01:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: 'run pwd' },
        }),
        JSON.stringify({
          timestamp: '2026-09-02T01:00:02.000Z',
          type: 'response_item',
          payload: { type: 'custom_tool_call', name: 'exec', call_id: 'call-1', input: 'pwd' },
        }),
        JSON.stringify({
          timestamp: '2026-09-02T01:00:03.000Z',
          type: 'response_item',
          payload: { type: 'custom_tool_call_output', call_id: 'call-1', output: '/tmp/demo' },
        }),
        '',
      ].join('\n'),
    )

    const parsed = parseCodexRolloutChunk(filePath, 0)
    const [running, completed] = parsed.events.slice(1)
    expect(running?.canonicalMessageKey).toBe(completed?.canonicalMessageKey)
    expect(running?.canonicalMutation).toBe('append')
    expect(completed?.canonicalMutation).toBe('upsert')
    expect(running?.localToolDetail?.toolCallId).toBe(completed?.localToolDetail?.toolCallId)
    expect(running?.localToolDetail?.detailRevision).toBe(1)
    expect(completed?.localToolDetail?.detailRevision).toBe(2)
  })

  it('uses codex session_index thread_name as the imported session title', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-'))
    registerNativeParserTempDir(home)
    fs.mkdirSync(path.join(home, '.codex'), { recursive: true })
    fs.writeFileSync(
      path.join(home, '.codex', 'session_index.jsonl'),
      [
        JSON.stringify({
          id: 'thread-title-1',
          thread_name: '同步出来的 Codex 标题',
        }),
        '',
      ].join('\n'),
    )
    const filePath = writeTempFile(
      'rollout-title.jsonl',
      [
        JSON.stringify({
          timestamp: '2026-04-23T10:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'thread-title-1', cwd: '/tmp/demo', model_provider: 'OpenAI' },
        }),
        JSON.stringify({
          timestamp: '2026-04-23T10:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: 'first user message fallback' },
        }),
        '',
      ].join('\n'),
    )

    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(home)
    try {
      const parsed = parseCodexRolloutChunk(filePath, 0)
      expect(parsed.events).toHaveLength(1)
      expect(parsed.events[0]).toMatchObject({
        sourceSessionKey: 'thread-title-1',
        title: '同步出来的 Codex 标题',
        titleSource: 'agent_native',
      })
    } finally {
      homedirSpy.mockRestore()
    }
  })

  it('ignores empty and generic Codex names so the first user fallback remains visible', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-'))
    registerNativeParserTempDir(home)
    fs.mkdirSync(path.join(home, '.codex'), { recursive: true })
    fs.writeFileSync(
      path.join(home, '.codex', 'session_index.jsonl'),
      [JSON.stringify({ id: 'thread-placeholder', thread_name: 'New Thread' }), ''].join('\n'),
    )
    const filePath = writeTempFile(
      'rollout-title-placeholder.jsonl',
      [
        JSON.stringify({
          timestamp: '2026-04-23T10:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'thread-placeholder', cwd: '/tmp/demo', model_provider: 'OpenAI' },
        }),
        JSON.stringify({
          timestamp: '2026-04-23T10:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: '排查手机缺少消息' },
        }),
        '',
      ].join('\n'),
    )

    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(home)
    try {
      expect(parseCodexRolloutChunk(filePath, 0).events[0]).toMatchObject({
        title: '排查手机缺少消息',
        titleSource: 'first_user_fallback',
      })
    } finally {
      homedirSpy.mockRestore()
    }
  })

  it('prefers the latest codex session_index title when the same thread appears multiple times', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-'))
    registerNativeParserTempDir(home)
    fs.mkdirSync(path.join(home, '.codex'), { recursive: true })
    fs.writeFileSync(
      path.join(home, '.codex', 'session_index.jsonl'),
      [
        JSON.stringify({
          id: 'thread-title-2',
          thread_name: '旧标题',
        }),
        JSON.stringify({
          id: 'thread-title-2',
          thread_name: '新标题',
        }),
        '',
      ].join('\n'),
    )
    const filePath = writeTempFile(
      'rollout-title-latest.jsonl',
      [
        JSON.stringify({
          timestamp: '2026-04-23T10:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'thread-title-2', cwd: '/tmp/demo', model_provider: 'OpenAI' },
        }),
        JSON.stringify({
          timestamp: '2026-04-23T10:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: 'fallback title' },
        }),
        '',
      ].join('\n'),
    )

    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(home)
    try {
      const parsed = parseCodexRolloutChunk(filePath, 0)
      expect(parsed.events).toHaveLength(1)
      expect(parsed.events[0]).toMatchObject({
        sourceSessionKey: 'thread-title-2',
        title: '新标题',
      })
    } finally {
      homedirSpy.mockRestore()
    }
  })

  it('streams codex session_index instead of reading the whole file', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-'))
    registerNativeParserTempDir(home)
    fs.mkdirSync(path.join(home, '.codex'), { recursive: true })
    const indexPath = path.join(home, '.codex', 'session_index.jsonl')
    fs.writeFileSync(
      indexPath,
      `${JSON.stringify({
        id: 'thread-title-streamed',
        thread_name: '流式读取标题',
      })}\n`,
    )
    const filePath = writeTempFile(
      'rollout-title-streamed.jsonl',
      [
        JSON.stringify({
          timestamp: '2026-04-23T10:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'thread-title-streamed', cwd: '/tmp/demo', model_provider: 'OpenAI' },
        }),
        JSON.stringify({
          timestamp: '2026-04-23T10:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: 'fallback title' },
        }),
        '',
      ].join('\n'),
    )

    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(home)
    const readFileSpy = vi.spyOn(fs, 'readFileSync')
    try {
      const parsed = parseCodexRolloutChunk(filePath, 0)
      expect(parsed.events).toHaveLength(1)
      expect(parsed.events[0]).toMatchObject({ title: '流式读取标题' })
      expect(readFileSpy).not.toHaveBeenCalledWith(indexPath, 'utf8')
    } finally {
      homedirSpy.mockRestore()
      readFileSpy.mockRestore()
    }
  })

  it('parses appended codex agent messages after the initial chunk', () => {
    const filePath = writeTempFile(
      'rollout.jsonl',
      [
        JSON.stringify({
          timestamp: '2026-04-23T10:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'thread-append-1', cwd: '/tmp/demo', model_provider: 'OpenAI' },
        }),
        JSON.stringify({
          timestamp: '2026-04-23T10:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: 'hello once' },
        }),
        '',
      ].join('\n'),
    )

    const first = parseCodexRolloutChunk(filePath, 0)
    expect(first.events).toHaveLength(1)
    expect(first.events[0]).toMatchObject({
      sourceSessionKey: 'thread-append-1',
      role: 'user',
      payload: 'hello once',
    })

    fs.appendFileSync(
      filePath,
      `${JSON.stringify({
        timestamp: '2026-04-23T10:00:03.000Z',
        type: 'event_msg',
        payload: { type: 'agent_message', message: 'hello twice' },
      })}\n`,
    )

    const second = parseCodexRolloutChunk(filePath, first.nextOffset)
    expect(second.events).toHaveLength(1)
    expect(second.events[0]).toMatchObject({
      sourceSessionKey: 'thread-append-1',
      role: 'agent',
      payload: 'hello twice',
      modelId: null,
      workDir: '/tmp/demo',
    })
    expect(second.events[0]?.terminal).toBe(false)
  })

  it('marks the last codex agent message as terminal when turn_completed arrives', () => {
    const filePath = writeTempFile(
      'rollout-terminal.jsonl',
      [
        JSON.stringify({
          timestamp: '2026-04-23T10:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'thread-terminal-1', cwd: '/tmp/demo', model_provider: 'OpenAI' },
        }),
        JSON.stringify({
          timestamp: '2026-04-23T10:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'agent_message', message: '最终答复' },
        }),
        JSON.stringify({
          timestamp: '2026-04-23T10:00:02.000Z',
          type: 'event_msg',
          payload: { type: 'turn_completed' },
        }),
        '',
      ].join('\n'),
    )

    const parsed = parseCodexRolloutChunk(filePath, 0)
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]).toMatchObject({
      role: 'agent',
      payload: '最终答复',
      terminal: true,
    })
  })

  it('replays the prior agent message when task_complete lands in a later append', () => {
    const filePath = writeTempFile(
      'rollout-split-terminal.jsonl',
      [
        JSON.stringify({
          timestamp: '2026-04-23T10:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'thread-split-terminal-1', cwd: '/tmp/demo' },
        }),
        JSON.stringify({
          timestamp: '2026-04-23T10:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            phase: 'final_answer',
            content: [{ type: 'output_text', text: 'split final' }],
          },
        }),
        '',
      ].join('\n'),
    )

    const first = parseCodexRolloutChunk(filePath, 0)
    expect(first.events).toEqual([
      expect.objectContaining({
        role: 'agent',
        payload: 'split final',
        terminal: false,
      }),
    ])
    fs.appendFileSync(
      filePath,
      `${JSON.stringify({
        timestamp: '2026-04-23T10:00:02.000Z',
        type: 'event_msg',
        payload: { type: 'task_complete' },
      })}\n`,
    )

    const second = parseCodexRolloutChunk(filePath, first.nextOffset)
    expect(second.events).toEqual([
      expect.objectContaining({
        sourceEventKey: first.events[0]?.sourceEventKey,
        role: 'agent',
        payload: 'split final',
        terminal: true,
      }),
    ])
  })

  it('parses codex response_item message assistant content', () => {
    const filePath = writeTempFile(
      'rollout-response-assistant.jsonl',
      [
        JSON.stringify({
          timestamp: '2026-04-23T10:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'thread-response-assistant-1', cwd: '/tmp/demo', model: 'gpt-5.3-codex' },
        }),
        JSON.stringify({
          timestamp: '2026-04-23T10:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'assistant from response_item' }],
          },
        }),
        '',
      ].join('\n'),
    )

    const parsed = parseCodexRolloutChunk(filePath, 0)
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]).toMatchObject({
      role: 'agent',
      payload: 'assistant from response_item',
      modelId: 'gpt-5.3-codex',
      sourceSessionKey: 'thread-response-assistant-1',
    })
  })

  it('preserves codex markdown newlines, blank lines and nested bullet indentation', () => {
    const markdown = [
      '# Codex Markdown 原样验证',
      '',
      '- **第一层重点**：包含 `inline code` 和普通说明',
      '  - 第二层 A：保留两个空格缩进',
      '  - 第二层 B：中间有 **bold**',
      '- 第一层第二项',
      '',
      '',
      '## 小结',
      '',
      '段落之间保留 Codex 原始空行。',
    ].join('\n')
    const filePath = writeTempFile(
      'rollout-markdown-fidelity.jsonl',
      [
        JSON.stringify({
          timestamp: '2026-05-29T10:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'thread-markdown-fidelity-1', cwd: '/tmp/demo', model: 'gpt-5.3-codex' },
        }),
        JSON.stringify({
          timestamp: '2026-05-29T10:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: markdown }],
          },
        }),
        '',
      ].join('\n'),
    )

    const parsed = parseCodexRolloutChunk(filePath, 0)
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]!.payload).toBe(markdown)
    expect(parsed.events[0]!.payload).toContain('\n  - 第二层 A')
    expect(parsed.events[0]!.payload).toContain('- 第一层第二项\n\n\n## 小结')
  })

  it('parses codex response_item message user content', () => {
    const filePath = writeTempFile(
      'rollout-response-user.jsonl',
      [
        JSON.stringify({
          timestamp: '2026-04-23T10:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'thread-response-user-1', cwd: '/tmp/demo', model_provider: 'OpenAI' },
        }),
        JSON.stringify({
          timestamp: '2026-04-23T10:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'user from response_item' }],
          },
        }),
        '',
      ].join('\n'),
    )

    const parsed = parseCodexRolloutChunk(filePath, 0)
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]).toMatchObject({
      role: 'user',
      payload: 'user from response_item',
      title: 'user from response_item',
      titleSource: 'first_user_fallback',
    })
  })

  it('does not import standalone codex environment_context metadata', () => {
    const environmentContext =
      '<environment_context>\n<cwd>/data/code/demo</cwd>\n<shell>zsh</shell>\n<current_date>2026-05-27</current_date>\n<timezone>Asia/Shanghai</timezone>\n</environment_context>'
    const filePath = writeTempFile(
      'rollout-environment-context.jsonl',
      [
        JSON.stringify({
          timestamp: '2026-05-27T10:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'thread-env-1', cwd: '/tmp/demo', model_provider: 'OpenAI' },
        }),
        JSON.stringify({
          timestamp: '2026-05-27T10:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: environmentContext }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-05-27T10:00:02.000Z',
          type: 'event_msg',
          payload: { type: 'agent_message', message: environmentContext },
        }),
        JSON.stringify({
          timestamp: '2026-05-27T10:00:03.000Z',
          type: 'event_msg',
          payload: { type: 'agent_message', message: 'normal reply' },
        }),
        '',
      ].join('\n'),
    )

    const parsed = parseCodexRolloutChunk(filePath, 0)
    expect(parsed.events.map((event) => event.payload)).toEqual(['normal reply'])
  })

  it('does not import compact codex environment_context metadata and keeps the following user text', () => {
    const environmentContext = [
      '<environment_context>',
      '  <current_date>2026-07-04</current_date>',
      '  <timezone>Asia/Shanghai</timezone>',
      '  <filesystem><workspace_roots><root>/Users/example/Documents/code/projects/shennian</root></workspace_roots>',
      '  <permission_profile type="disabled"><file_system type="unrestricted" /></permission_profile></filesystem>',
      '</environment_context>',
    ].join('\n')
    const filePath = writeTempFile(
      'rollout-compact-environment-context.jsonl',
      [
        JSON.stringify({
          timestamp: '2026-07-04T10:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'thread-compact-env-1', cwd: '/tmp/demo', model_provider: 'OpenAI' },
        }),
        JSON.stringify({
          timestamp: '2026-07-04T10:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: environmentContext }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-07-04T10:00:02.000Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: 'windows的helper和桌面端都需要重新打包一个？' },
        }),
        '',
      ].join('\n'),
    )

    const parsed = parseCodexRolloutChunk(filePath, 0)
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]).toMatchObject({
      role: 'user',
      payload: 'windows的helper和桌面端都需要重新打包一个？',
    })
  })
})
