// @arch docs/features/machine-owned-personal-session-authority.md
// @covers packages/app/src/storage/db.native.ts
// @covers packages/app/src/config/sync.ts

import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const read = (relativePath: string) => fs.readFileSync(
  path.resolve(__dirname, '..', relativePath),
  'utf8',
)

describe('personal data epoch reset contract', () => {
  it('clears personal projections transactionally without deleting installation or Room identity', () => {
    const source = read('storage/db.native.ts')
    const reset = source.slice(
      source.indexOf('async resetPersonalData()'),
      source.indexOf('// --- Projects ---'),
    )

    expect(reset).toContain('withWriteTransaction')
    for (const table of [
      'sessions',
      'projects',
      'session_deletions',
      'personal_session_messages',
      'personal_session_message_tombstones',
      'personal_session_body_state',
    ]) {
      expect(reset).toContain(`DELETE FROM ${table}`)
    }
    expect(reset).not.toContain('DELETE FROM machines')
    expect(reset).not.toContain('DELETE FROM room_')
    expect(reset).not.toContain('DELETE FROM agents')
  })

  it('derives the marker from Wire and clears every personal async cache silently', () => {
    const source = read('config/sync.ts')
    expect(source).toContain('personal-data-epoch:${SESSION_SYNC_DATA_EPOCH}:cutover:2')
    for (const clearer of [
      'clearAllChatDrafts()',
      'clearAllChatOutboundMessages()',
      'clearAllChatScrollPositions()',
      'clearAllReasoningEffortPreferences()',
      'clearAllAttachmentPreviewCaches()',
    ]) {
      expect(source).toContain(clearer)
    }
    expect(source).not.toContain('数据升级完成')
    expect(source).not.toContain('旧对话已清理')
  })
})
