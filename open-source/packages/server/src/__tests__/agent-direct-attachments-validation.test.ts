// @covers open-source/packages/server/src/services/agent-direct-attachments.ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/prisma.js', () => ({ prisma: {} }))
vi.mock('../lib/oss.js', () => ({}))

import { validateDirectAttachment } from '../services/agent-direct-attachments.js'

const valid = { name: 'demo.mp4', mimeType: 'video/mp4', mediaKind: 'video',
  byteSize: 100 * 1024 * 1024, sha256: 'a'.repeat(64) }

describe('public link attachment limits', () => {
  it('allows a video or ordinary file up to 100 MB', () => {
    expect(validateDirectAttachment(valid).mediaKind).toBe('video')
    expect(validateDirectAttachment({ ...valid, name: 'notes.pdf',
      mimeType: 'application/pdf', mediaKind: 'file' }).mediaKind).toBe('file')
  })

  it('rejects oversize media and unsafe content', () => {
    for (const change of [
      { byteSize: 100 * 1024 * 1024 + 1 },
      { mediaKind: 'image', mimeType: 'image/png', byteSize: 20 * 1024 * 1024 + 1 },
      { name: 'run.sh' }, { name: 'page.svg', mimeType: 'image/svg+xml', mediaKind: 'image' },
      { sha256: 'invalid' },
    ]) {
      expect(() => validateDirectAttachment({ ...valid, ...change })).toThrow()
    }
  })
})
