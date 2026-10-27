// @arch open-source/docs/server-runtime.md
// @test src/__tests__/request-log-credential-cleanup.test.ts

import { prisma } from '../lib/prisma.js'
import { sanitizePersistedLog } from '../security/log-redaction.js'

type RequestLogRow = {
  id: bigint
  path: string | null
  payload: unknown
  metadata: unknown
  errorMessage: string | null
  errorStack: string | null
}

export type RequestLogCredentialCleanupReport = {
  mode: 'audit' | 'apply'
  scanned: number
  matchedRecords: number
  matchedFields: {
    path: number
    payload: number
    metadata: number
    errorMessage: number
    errorStack: number
  }
  cleanedRecords: number
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export async function cleanupRequestLogCredentials(
  options: { apply?: boolean; batchSize?: number } = {},
): Promise<RequestLogCredentialCleanupReport> {
  const batchSize = Math.min(1000, Math.max(1, options.batchSize ?? 250))
  const report: RequestLogCredentialCleanupReport = {
    mode: options.apply ? 'apply' : 'audit',
    scanned: 0,
    matchedRecords: 0,
    matchedFields: { path: 0, payload: 0, metadata: 0, errorMessage: 0, errorStack: 0 },
    cleanedRecords: 0,
  }
  let cursor: bigint | undefined

  for (;;) {
    const rows = await prisma.requestLog.findMany({
      take: batchSize,
      orderBy: { id: 'asc' },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        path: true,
        payload: true,
        metadata: true,
        errorMessage: true,
        errorStack: true,
      },
    }) as RequestLogRow[]
    if (rows.length === 0) break

    for (const row of rows) {
      report.scanned += 1
      const safe = sanitizePersistedLog(row)
      const changed = {
        path: !sameValue(row.path, safe.path),
        payload: !sameValue(row.payload, safe.payload),
        metadata: !sameValue(row.metadata, safe.metadata),
        errorMessage: !sameValue(row.errorMessage, safe.errorMessage),
        errorStack: !sameValue(row.errorStack, safe.errorStack),
      }
      const matched = Object.values(changed).some(Boolean)
      if (!matched) continue
      report.matchedRecords += 1
      for (const key of Object.keys(changed) as Array<keyof typeof changed>) {
        if (changed[key]) report.matchedFields[key] += 1
      }
      if (options.apply) {
        await prisma.requestLog.update({
          where: { id: row.id },
          data: {
            path: safe.path,
            payload: safe.payload as object,
            metadata: safe.metadata as object,
            errorMessage: safe.errorMessage,
            errorStack: safe.errorStack,
          },
        })
        report.cleanedRecords += 1
      }
    }
    cursor = rows.at(-1)!.id
  }
  return report
}
