// @covers open-source/packages/cli/src/native-fusion/parsers.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { vi } from 'vitest'

const tempDirs: string[] = []

export function registerNativeParserTempDir(dir: string): void {
  tempDirs.push(dir)
}

export function writeTempFile(name: string, content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-fusion-test-'))
  tempDirs.push(dir)
  const filePath = path.join(dir, name)
  fs.writeFileSync(filePath, content)
  return filePath
}

export function cleanupNativeParserTest(): void {
  vi.restoreAllMocks()
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
}
