// @covers src/room/activation-audit.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RoomActivationAudit } from '../room/activation-audit.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('RoomActivationAudit', () => {
  it('appends a private, metadata-only audit trail', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-room-audit-'))
    roots.push(root)
    new RoomActivationAudit(root).record({
      roomId: 'room_1', bindingId: 'binding_1', causeMessageId: 'message_1',
      rootCauseMessageId: 'message_1', hopCount: 0, outcome: 'queued', reason: 'policy_match',
      at: new Date('2026-08-23T00:00:00.000Z'),
    })
    const file = path.join(root, 'room_1', 'activation-audit.jsonl')
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({
      outcome: 'queued', reason: 'policy_match', at: '2026-08-23T00:00:00.000Z',
    })
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600)
  })

  it('refuses a symbolic-link audit file', () => {
    if (process.platform === 'win32') return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-room-audit-link-'))
    roots.push(root)
    const room = path.join(root, 'room_1')
    fs.mkdirSync(room)
    const target = path.join(root, 'target')
    fs.writeFileSync(target, '')
    fs.symlinkSync(target, path.join(room, 'activation-audit.jsonl'))
    expect(() => new RoomActivationAudit(root).record({
      roomId: 'room_1', bindingId: 'binding_1', causeMessageId: 'message_1',
      rootCauseMessageId: 'message_1', hopCount: 0, outcome: 'queued', reason: 'policy_match',
    })).toThrow('unsafe_room_activation_audit_path')
  })
})
