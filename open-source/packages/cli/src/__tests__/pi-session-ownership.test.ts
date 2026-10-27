// @arch open-source/docs/cli-runtime.md
// @covers src/agents/pi-session-ownership.ts

import fs from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { resolveShennianPath } from '../config/index.js'

import {
  deleteOwnedPiSession,
  recordPiSessionOwnership,
} from '../agents/pi-session-ownership.js'

const testRoot = resolveShennianPath('runtime', 'pi-coding-agent', 'ownership-test')
afterAll(() => fs.rmSync(testRoot, { recursive: true, force: true }))

describe('Pi session ownership', () => {
  it('deletes only an exactly indexed Shennian-owned sessions directory', () => {
    const sessionDir = path.join(testRoot, 'nian-1', 'sessions')
    fs.mkdirSync(sessionDir, { recursive: true })
    fs.writeFileSync(path.join(sessionDir, 'session.jsonl'), '{}\n')
    recordPiSessionOwnership('pi-native-1', sessionDir)

    expect(deleteOwnedPiSession('unknown')).toBe('already_absent')
    expect(fs.existsSync(sessionDir)).toBe(true)
    expect(deleteOwnedPiSession('pi-native-1')).toBe('deleted')
    expect(fs.existsSync(sessionDir)).toBe(false)
    expect(deleteOwnedPiSession('pi-native-1')).toBe('already_absent')
  })

  it('rejects ownership records that point outside the private runtime', () => {
    expect(() => recordPiSessionOwnership('pi-native-2', path.dirname(resolveShennianPath()))).toThrow(
      'pi_session_ownership_invalid',
    )
  })
})
