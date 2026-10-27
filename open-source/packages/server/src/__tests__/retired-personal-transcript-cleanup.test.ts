// @covers src/services/retired-personal-transcript-cleanup.ts

import { describe, expect, it, vi } from 'vitest'
import {
  cleanupRetiredPersonalTranscriptObjects,
  isRetiredPersonalTranscriptObjectKey,
} from '../services/retired-personal-transcript-cleanup.js'

const prefix = 'shennian/transcripts/'

describe('retired personal transcript object cleanup', () => {
  it('accepts only the complete retired object grammar', () => {
    expect(isRetiredPersonalTranscriptObjectKey(
      'shennian/transcripts/users/u1/sessions/s1/transcript.jsonl', prefix,
    )).toBe(true)
    expect(isRetiredPersonalTranscriptObjectKey(
      'shennian/transcripts/users/u1/sessions/s1/chunks/000042.jsonl', prefix,
    )).toBe(true)
    expect(isRetiredPersonalTranscriptObjectKey(
      'shennian/transcripts/users/u1/sessions/s1/chunks/42.jsonl', prefix,
    )).toBe(false)
    expect(isRetiredPersonalTranscriptObjectKey(
      'shennian/rooms/r1/attachments/a1/original', prefix,
    )).toBe(false)
  })

  it('audits without deleting and executes only exact matches in bounded batches', async () => {
    const objects = Array.from({ length: 501 }, (_, index) => ({
      name: `${prefix}users/u/sessions/s/chunks/${String(index).padStart(6, '0')}.jsonl`,
      size: 10,
    }))
    const remove = vi.fn(async (keys: string[]) => keys.length)
    const listPage = vi.fn(async () => ({ objects, nextMarker: null, isTruncated: false }))

    await expect(cleanupRetiredPersonalTranscriptObjects({ prefix, listPage, deleteBatch: remove }))
      .resolves.toMatchObject({ matched: 501, matchedBytes: 5010, deleted: 0, remaining: 501 })
    expect(remove).not.toHaveBeenCalled()

    await expect(cleanupRetiredPersonalTranscriptObjects({
      execute: true, prefix, listPage, deleteBatch: remove,
    })).resolves.toMatchObject({ matched: 501, deleted: 501, remaining: 0 })
    expect(remove).toHaveBeenCalledTimes(2)
  })

  it('fails closed before deletion when any object has an unknown shape', async () => {
    const remove = vi.fn()
    await expect(cleanupRetiredPersonalTranscriptObjects({
      execute: true,
      prefix,
      listPage: async () => ({
        objects: [{ name: `${prefix}unexpected.bin`, size: 1 }],
        nextMarker: null,
        isTruncated: false,
      }),
      deleteBatch: remove,
    })).rejects.toThrow(/blocked by 1 unknown object types/)
    expect(remove).not.toHaveBeenCalled()
  })
})
