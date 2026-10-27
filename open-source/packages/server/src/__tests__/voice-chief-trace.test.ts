// @covers open-source/packages/server/src/services/voice-chief-trace.ts

import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { VoiceChiefTraceLogger } from '../services/voice-chief-trace.js'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  )
})

describe('voice chief V5 trace logger', () => {
  it('writes full diagnostic payloads to an independent protected JSONL file', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'voice-v5-trace-'))
    directories.push(directory)
    const logger = new VoiceChiefTraceLogger({
      callId: 'call-1',
      userId: 'private-user-id',
      enabled: true,
      directory,
    })
    logger.write('model_request', {
      systemPrompt: '完整系统提示词',
      messages: [{ role: 'user', content: '当前有哪些对话？' }],
      tools: [{ name: 'read_task' }],
    })
    await logger.flush()

    const filePath = path.join(directory, `voice-v5-${new Date().toISOString().slice(0, 10)}.jsonl`)
    const line = JSON.parse((await readFile(filePath, 'utf8')).trim())
    expect(line).toMatchObject({
      version: 1,
      callId: 'call-1',
      event: 'model_request',
      data: { systemPrompt: '完整系统提示词' },
    })
    expect(line.userRef).toMatch(/^[a-f0-9]{16}$/)
    expect(JSON.stringify(line)).not.toContain('private-user-id')
    expect((await stat(filePath)).mode & 0o777).toBe(0o600)
  })
})
