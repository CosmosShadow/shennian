// @covers ../../../../tests/fixtures/personal-sync-hard-cut-incidents.json

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const fixturePath = path.resolve(
  import.meta.dirname,
  '../../../../tests/fixtures/personal-sync-hard-cut-incidents.json',
)

describe('personal sync hard-cut incident fixture', () => {
  it('freezes all four content-free production failure shapes', () => {
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as {
      containsMessageContent: boolean
      incidents: Array<{ id: string; expected: Record<string, unknown> }>
    }

    expect(fixture.containsMessageContent).toBe(false)
    expect(fixture.incidents.map((incident) => incident.id)).toEqual([
      'legacy-index-after-server-purge',
      'personal-index-conflicts-with-room-authority',
      'history-response-with-zero-app-cache',
      'codex-active-archive-attention-duplicate',
    ])
    expect(fixture.incidents[0]?.expected).toMatchObject({
      code: 'upgrade_required',
      retryable: false,
      requiredAction: 'upgrade_client',
    })
    expect(fixture.incidents[1]?.expected).toMatchObject({
      code: 'room_authority_conflict',
      retryable: false,
      requiredAction: 'quarantine_record',
    })
    expect(JSON.stringify(fixture)).not.toMatch(/"(?:body|text|content|token|phone|userId|sessionId)"\s*:/)
  })
})
