// @covers src/native-fusion/codex-parser.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCodexRolloutChunk } from '../native-fusion/codex-parser.js'

describe('Codex delegated task import', () => {
  it('uses the delegation input as the first user boundary after a daemon restart', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-delegation-'))
    const filePath = path.join(directory, 'rollout.jsonl')
    const input = '这是 daemon 重启窗口内创建的新任务。'
    fs.writeFileSync(filePath, [
      JSON.stringify({
        timestamp: '2026-09-02T09:57:50.000Z',
        type: 'session_meta',
        payload: { id: 'delegated-thread', cwd: '/tmp/project' },
      }),
      JSON.stringify({
        timestamp: '2026-09-02T09:57:59.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{
            type: 'input_text',
            text: '<recommended_plugins></recommended_plugins>\n# AGENTS.md instructions for /tmp/project\n<INSTRUCTIONS>rules</INSTRUCTIONS>\n<environment_context><cwd>/tmp/project</cwd></environment_context>',
          }],
        },
      }),
      JSON.stringify({
        timestamp: '2026-09-02T09:57:59.100Z',
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          namespace: 'codex_app',
          name: 'create_thread',
          output: `<codex_delegation>\n  <source_thread_id>source-thread</source_thread_id>\n  <input>${input}</input>\n</codex_delegation>`,
        },
      }),
      JSON.stringify({
        timestamp: '2026-09-02T09:58:03.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: '任务完成' }],
        },
      }),
      '',
    ].join('\n'))

    const events = parseCodexRolloutChunk(filePath, 0).events

    expect(events.map((event) => ({ role: event.role, payload: event.payload }))).toEqual([
      { role: 'user', payload: input },
      { role: 'agent', payload: '任务完成' },
    ])
    expect(events[0]!.sourceEventKey).toContain('delegation:user')
  })
})
