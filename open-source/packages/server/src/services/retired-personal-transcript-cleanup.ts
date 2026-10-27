// @arch open-source/docs/server-runtime.md
// @test src/__tests__/retired-personal-transcript-cleanup.test.ts

import { deleteObjects, listObjectsByPrefix } from '../lib/oss.js'

type ObjectPage = Awaited<ReturnType<typeof listObjectsByPrefix>>

export type RetiredTranscriptCleanupReport = {
  prefix: string
  scanned: number
  matched: number
  matchedBytes: number
  blockedUnknown: number
  deleted: number
  remaining: number
}

function normalizedPrefix(value = process.env.OSS_TRANSCRIPT_PREFIX || 'shennian/transcripts'): string {
  const prefix = value.replace(/^\/+|\/+$/g, '')
  if (!prefix || prefix.includes('..')) throw new Error('invalid retired transcript prefix')
  return `${prefix}/`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function isRetiredPersonalTranscriptObjectKey(objectKey: string, prefix: string): boolean {
  const pattern = new RegExp(
    `^${escapeRegExp(prefix)}users/[^/]+/sessions/[^/]+/(?:transcript\\.jsonl|chunks/\\d{6}\\.jsonl)$`,
  )
  return pattern.test(objectKey)
}

export async function cleanupRetiredPersonalTranscriptObjects(input?: {
  execute?: boolean
  prefix?: string
  listPage?: (prefix: string, marker?: string | null) => Promise<ObjectPage>
  deleteBatch?: (objectKeys: string[]) => Promise<number>
}): Promise<RetiredTranscriptCleanupReport> {
  const prefix = normalizedPrefix(input?.prefix)
  const listPage = input?.listPage ?? listObjectsByPrefix
  const deleteBatch = input?.deleteBatch ?? deleteObjects
  const keys: string[] = []
  let scanned = 0
  let matchedBytes = 0
  let blockedUnknown = 0
  let marker: string | null = null

  do {
    const page = await listPage(prefix, marker)
    for (const object of page.objects) {
      scanned += 1
      if (!isRetiredPersonalTranscriptObjectKey(object.name, prefix)) {
        blockedUnknown += 1
        continue
      }
      keys.push(object.name)
      matchedBytes += Number.isFinite(object.size) && (object.size ?? 0) > 0 ? object.size! : 0
    }
    marker = page.isTruncated ? page.nextMarker : null
    if (page.isTruncated && !marker) throw new Error('retired transcript OSS pagination lost its marker')
  } while (marker)

  if (blockedUnknown > 0) {
    throw new Error(`retired transcript cleanup blocked by ${blockedUnknown} unknown object types`)
  }

  let deleted = 0
  if (input?.execute) {
    for (let offset = 0; offset < keys.length; offset += 500) {
      deleted += await deleteBatch(keys.slice(offset, offset + 500))
    }
  }

  return {
    prefix,
    scanned,
    matched: keys.length,
    matchedBytes,
    blockedUnknown,
    deleted,
    remaining: input?.execute ? Math.max(0, keys.length - deleted) : keys.length,
  }
}
