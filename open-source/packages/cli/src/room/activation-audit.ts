// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/room-activation-audit.test.ts

import fs from 'node:fs'
import path from 'node:path'
import { resolveShennianPath } from '../config/index.js'

export type RoomActivationAuditEvent = {
  roomId: string
  bindingId: string
  causeMessageId: string
  rootCauseMessageId: string
  hopCount: number
  outcome: 'queued' | 'activated' | 'suppressed' | 'failed'
  reason: string
  at?: Date
}

export class RoomActivationAudit {
  constructor(private readonly root = resolveShennianPath('rooms')) {}

  record(event: RoomActivationAuditEvent): void {
    for (const value of [event.roomId, event.bindingId, event.causeMessageId, event.rootCauseMessageId]) {
      if (!/^[A-Za-z0-9_.:@-]{1,191}$/.test(value)) throw new Error('invalid_room_activation_audit_id')
    }
    if (!Number.isInteger(event.hopCount) || event.hopCount < 0 || event.hopCount > 32) {
      throw new Error('invalid_room_activation_audit_hop')
    }
    const directory = path.join(this.root, event.roomId)
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 })
    if (fs.existsSync(directory)) {
      const stat = fs.lstatSync(directory)
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe_room_activation_audit_path')
    } else {
      fs.mkdirSync(directory, { mode: 0o700 })
    }
    if (process.platform !== 'win32') fs.chmodSync(directory, 0o700)
    const file = path.join(directory, 'activation-audit.jsonl')
    if (fs.existsSync(file)) {
      const stat = fs.lstatSync(file)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('unsafe_room_activation_audit_path')
    }
    fs.appendFileSync(file, `${JSON.stringify({
      schemaVersion: 1,
      ...event,
      at: (event.at ?? new Date()).toISOString(),
    })}\n`, { encoding: 'utf8', mode: 0o600 })
    if (process.platform !== 'win32') fs.chmodSync(file, 0o600)
  }
}
