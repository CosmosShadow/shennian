// @covers open-source/packages/server/src/services/log-file-credential-cleanup.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupLogFiles } from '../services/log-file-credential-cleanup.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('historical file log cleanup', () => {
  it('audits counts without values, then atomically sanitizes explicit files', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-log-cleanup-'))
    directories.push(directory)
    const file = path.join(directory, 'daemon.log')
    const canary = 'machine-canary-123456789'
    fs.writeFileSync(file, [
      `GET /relay?token=${canary}&other=value HTTP/1.1`,
      `Authorization: Bearer ${canary}`,
      'ordinary status line',
    ].join('\n'))

    const audit = await cleanupLogFiles([file])
    expect(audit).toMatchObject({ mode: 'audit', files: 1, matchedFiles: 1, matchedLines: 2 })
    expect(JSON.stringify(audit)).not.toContain(canary)
    expect(fs.readFileSync(file, 'utf8')).toContain(canary)

    const applied = await cleanupLogFiles([file], { apply: true })
    expect(applied).toMatchObject({ mode: 'apply', cleanedFiles: 1 })
    const cleaned = fs.readFileSync(file, 'utf8')
    expect(cleaned).not.toContain(canary)
    expect(cleaned).toContain('GET /relay HTTP/1.1')
    expect(cleaned).toContain('ordinary status line')
  })
})
