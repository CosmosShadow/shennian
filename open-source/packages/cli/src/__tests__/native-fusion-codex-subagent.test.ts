// @covers open-source/packages/cli/src/native-fusion/codex-parser.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseCodexRolloutChunk } from '../native-fusion/parsers.js'

const tempDirs: string[] = []

function writeTempFile(name: string, records: unknown[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-fusion-codex-subagent-'))
  tempDirs.push(dir)
  const filePath = path.join(dir, name)
  fs.writeFileSync(filePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`)
  return filePath
}

describe('native-fusion codex subagent rollouts', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('skips Codex subagent rollout files instead of importing them as top-level sessions', () => {
    const filePath = writeTempFile('rollout-subagent.jsonl', [
      {
        timestamp: '2026-07-13T09:48:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'child-thread-1',
          session_id: 'parent-thread-1',
          parent_thread_id: 'parent-thread-1',
          thread_source: 'subagent',
          cwd: '/tmp/demo',
          model_provider: 'OpenAI',
        },
      },
      {
        timestamp: '2026-07-13T09:48:01.000Z',
        type: 'event_msg',
        payload: { type: 'agent_message', message: 'subagent internal finding' },
      },
    ])

    const parsed = parseCodexRolloutChunk(filePath, 0)
    expect(parsed.events).toEqual([])
    expect(parsed.nextOffset).toBe(fs.statSync(filePath).size)
  })

  it('also skips newer Codex TUI subagent metadata that omits parent_thread_id', () => {
    const filePath = writeTempFile('rollout-subagent-no-parent.jsonl', [
      {
        timestamp: '2026-07-13T09:48:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'child-thread-2',
          session_id: 'child-thread-2',
          thread_source: 'subagent',
          cwd: '/tmp/demo',
          model_provider: 'OpenAI',
        },
      },
      {
        timestamp: '2026-07-13T09:48:01.000Z',
        type: 'event_msg',
        payload: { type: 'agent_message', message: 'another subagent finding' },
      },
    ])

    const parsed = parseCodexRolloutChunk(filePath, 0)
    expect(parsed.events).toEqual([])
    expect(parsed.nextOffset).toBe(fs.statSync(filePath).size)
  })
})
