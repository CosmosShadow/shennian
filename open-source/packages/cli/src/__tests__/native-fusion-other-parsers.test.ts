// @covers open-source/packages/cli/src/native-fusion/parsers.ts
// @covers open-source/packages/cli/src/native-fusion/codex-files.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  listClaudeTranscriptFiles,
  lookupClaudeTranscriptCwd,
  parseClaudeTranscriptChunk,
  parseOpenCodeSessionSnapshot,
} from '../native-fusion/parsers.js'
import {
  cleanupNativeParserTest,
  registerNativeParserTempDir,
  writeTempFile,
} from './native-fusion-parser-harness.js'

describe('native-fusion Claude and OpenCode parsers', () => {
  afterEach(cleanupNativeParserTest)
  it('parses claude transcript user and assistant messages', () => {
    const filePath = writeTempFile(
      'claude.jsonl',
      [
        JSON.stringify({
          type: 'user',
          timestamp: '2026-04-23T10:00:01.000Z',
          cwd: '/Users/example/Documents/code/projects/shennian',
          message: { role: 'user', content: 'hello claude' },
        }),
        JSON.stringify({
          type: 'assistant',
          timestamp: '2026-04-23T10:00:02.000Z',
          cwd: '/Users/example/Documents/code/projects/shennian',
          message: {
            model: 'claude-sonnet-4-6',
            content: [{ type: 'text', text: 'hello back' }],
          },
        }),
        '',
      ].join('\n'),
    )

    const parsed = parseClaudeTranscriptChunk(filePath, 0)
    expect(parsed.events).toHaveLength(2)
    expect(parsed.events[0]).toMatchObject({
      agentType: 'claude',
      role: 'user',
      payload: 'hello claude',
      titleSource: 'first_user_fallback',
      workDir: '/Users/example/Documents/code/projects/shennian',
    })
    expect(parsed.events[1]).toMatchObject({
      role: 'agent',
      payload: 'hello back',
      modelId: 'claude-sonnet-4-6',
      workDir: '/Users/example/Documents/code/projects/shennian',
    })
  })

  it('does not import claude subagent transcripts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-subagent-'))
    registerNativeParserTempDir(dir)
    const subagentDir = path.join(dir, 'subagents')
    fs.mkdirSync(subagentDir, { recursive: true })
    const filePath = path.join(subagentDir, 'agent-aa995ecba7764dcd4.jsonl')
    fs.writeFileSync(
      filePath,
      [
        JSON.stringify({
          type: 'user',
          timestamp: '2026-04-23T10:00:01.000Z',
          cwd: '/Users/example/Documents/code/projects/shennian',
          message: { role: 'user', content: 'review this diff' },
        }),
        JSON.stringify({
          type: 'assistant',
          timestamp: '2026-04-23T10:00:02.000Z',
          cwd: '/Users/example/Documents/code/projects/shennian',
          message: {
            model: 'claude-sonnet-4-6',
            content: [{ type: 'text', text: 'subagent review result' }],
          },
        }),
        '',
      ].join('\n'),
    )

    const parsed = parseClaudeTranscriptChunk(filePath, 0)
    expect(parsed.nextOffset).toBe(fs.statSync(filePath).size)
    expect(parsed.events).toEqual([])
  })

  it('skips oversized jsonl lines and continues parsing later claude events', () => {
    const oversizedLine =
      '{"type":"user","message":{"content":"' + 'x'.repeat(70 * 1024 * 1024) + '"}}'
    const filePath = writeTempFile(
      'claude-oversized.jsonl',
      [
        oversizedLine,
        JSON.stringify({
          timestamp: '2026-04-23T10:00:01.000Z',
          type: 'user',
          message: { content: 'after oversized line' },
        }),
        '',
      ].join('\n'),
    )

    const parsed = parseClaudeTranscriptChunk(filePath, 0)
    expect(parsed.nextOffset).toBe(fs.statSync(filePath).size)
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]).toMatchObject({
      role: 'user',
      payload: 'after oversized line',
    })
  }, 30_000)

  it('looks up claude cwd by transcript session id', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-projects-'))
    registerNativeParserTempDir(root)
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'))
    registerNativeParserTempDir(home)
    const transcriptDir = path.join(
      home,
      '.claude',
      'projects',
      '-Users-lichen-Documents-code-projects-shennian',
    )
    fs.mkdirSync(transcriptDir, { recursive: true })
    const filePath = path.join(transcriptDir, 'sid-claude-1.jsonl')
    fs.writeFileSync(
      filePath,
      [
        JSON.stringify({
          type: 'user',
          timestamp: '2026-04-23T10:00:01.000Z',
          cwd: '/Users/example/Documents/code/projects/shennian',
          message: { role: 'user', content: 'hello' },
        }),
        '',
      ].join('\n'),
    )

    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(home)
    try {
      expect(lookupClaudeTranscriptCwd('sid-claude-1')).toBe(
        '/Users/example/Documents/code/projects/shennian',
      )
    } finally {
      homedirSpy.mockRestore()
    }
  })

  it('skips the default claude memory observer transcript directory during native scans', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'))
    registerNativeParserTempDir(home)
    vi.spyOn(os, 'homedir').mockReturnValue(home)
    const projectsRoot = path.join(home, '.claude', 'projects')
    const ignoredDir = path.join(projectsRoot, '-root-.claude-mem-observer-session')
    const includedDir = path.join(projectsRoot, '-root-work-observer-session')
    fs.mkdirSync(ignoredDir, { recursive: true })
    fs.mkdirSync(includedDir, { recursive: true })
    const ignoredFile = path.join(ignoredDir, 'ignored-session.jsonl')
    const includedFile = path.join(includedDir, 'included-session.jsonl')
    const transcript = [
      JSON.stringify({
        type: 'user',
        timestamp: '2026-04-23T10:00:01.000Z',
        cwd: '/root/.claude-mem/observer-session',
        message: { role: 'user', content: 'ignore me' },
      }),
      '',
    ].join('\n')
    fs.writeFileSync(ignoredFile, transcript)
    fs.writeFileSync(
      includedFile,
      transcript.replace('/root/.claude-mem/observer-session', '/root/work/observer-session'),
    )

    expect(listClaudeTranscriptFiles()).toEqual([includedFile])

    const parsed = parseClaudeTranscriptChunk(ignoredFile, 0)
    expect(parsed).toEqual({
      nextOffset: fs.statSync(ignoredFile).size,
      events: [],
    })
  })

  it('imports opencode sqlite snapshots as native session events', () => {
    const events = parseOpenCodeSessionSnapshot('/tmp/opencode-snapshot.json', {
      sessions: [
        {
          id: 'ses_123',
          title: 'opencode chat',
          directory: '/repo',
          time_created: 1000,
          time_updated: 2000,
        },
      ],
      messages: [
        {
          id: 'msg_user',
          session_id: 'ses_123',
          time_created: 1100,
          data: JSON.stringify({ role: 'user' }),
        },
        {
          id: 'msg_assistant',
          session_id: 'ses_123',
          time_created: 1200,
          data: JSON.stringify({
            role: 'assistant',
            providerID: 'opencode',
            modelID: 'big-pickle',
          }),
        },
      ],
      parts: [
        {
          id: 'prt_user',
          message_id: 'msg_user',
          session_id: 'ses_123',
          time_created: 1100,
          data: JSON.stringify({ type: 'text', text: 'hello' }),
        },
        {
          id: 'prt_agent',
          message_id: 'msg_assistant',
          session_id: 'ses_123',
          time_created: 1200,
          data: JSON.stringify({ type: 'text', text: 'world' }),
        },
      ],
    })

    expect(events).toEqual([
      expect.objectContaining({
        agentType: 'opencode',
        sourceMode: 'opencode_session_import',
        sourceSessionKey: 'ses_123',
        sourceEventKey: 'opencode:ses_123:msg_user:user',
        role: 'user',
        payload: 'hello',
        title: 'opencode chat',
        titleSource: 'agent_native',
        workDir: '/repo',
      }),
      expect.objectContaining({
        agentType: 'opencode',
        role: 'agent',
        payload: 'world',
        modelId: 'opencode/big-pickle',
        terminal: true,
      }),
    ])
  })
})
