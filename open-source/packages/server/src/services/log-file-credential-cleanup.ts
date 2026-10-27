// @arch open-source/docs/server-runtime.md
// @test src/__tests__/log-file-credential-cleanup.test.ts

import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { redactSensitiveLogText } from '../security/log-redaction.js'

export type LogFileCredentialCleanupReport = {
  mode: 'audit' | 'apply'
  files: number
  scannedBytes: number
  matchedFiles: number
  matchedLines: number
  cleanedFiles: number
}

export async function cleanupLogFiles(
  filePaths: string[],
  options: { apply?: boolean } = {},
): Promise<LogFileCredentialCleanupReport> {
  if (filePaths.length === 0) throw new Error('at least one explicit log file is required')
  const report: LogFileCredentialCleanupReport = {
    mode: options.apply ? 'apply' : 'audit',
    files: 0,
    scannedBytes: 0,
    matchedFiles: 0,
    matchedLines: 0,
    cleanedFiles: 0,
  }
  for (const filePath of filePaths) {
    const absolutePath = path.resolve(filePath)
    const stat = await fs.stat(absolutePath)
    if (!stat.isFile()) throw new Error(`not a regular file: ${absolutePath}`)
    const original = await fs.readFile(absolutePath, 'utf8')
    const sanitized = redactSensitiveLogText(original)
    report.files += 1
    report.scannedBytes += Buffer.byteLength(original)
    if (sanitized === original) continue
    report.matchedFiles += 1
    const before = original.split(/\r?\n/)
    const after = sanitized.split(/\r?\n/)
    report.matchedLines += before.reduce(
      (count, line, index) => count + (line === after[index] ? 0 : 1),
      0,
    )
    if (!options.apply) continue
    const temporaryPath = `${absolutePath}.sanitize-${process.pid}-${randomBytes(4).toString('hex')}`
    try {
      await fs.writeFile(temporaryPath, sanitized, { mode: stat.mode })
      await fs.rename(temporaryPath, absolutePath)
      report.cleanedFiles += 1
    } finally {
      await fs.unlink(temporaryPath).catch(() => {})
    }
  }
  return report
}
