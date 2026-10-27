// @arch ./docs/server-extensions.md
// @test ./packages/server-extensions/src/__tests__/register.test.ts
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defineConfig } from 'vitest/config'

// macOS Unix sockets require short paths; /tmp is the system temp entry.
const parent = path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'shennian-tests', 'unit')
fs.mkdirSync(parent, { recursive: true })
const tmp = fs.mkdtempSync(path.join(parent, 'public-'))
process.env.TMPDIR = tmp
process.env.TMP = tmp
process.env.TEMP = tmp
process.env.SHENNIAN_ACCOUNT_NAMESPACE_ID ??= '0'.repeat(64)
process.env.DATABASE_URL ??= 'mysql://unit:unit@127.0.0.1:1/unit'
process.env.REDIS_URL ??= 'redis://127.0.0.1:1'

// Public unit tests have no private setup, Server env bootstrap or network probes.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: { include: ['packages/*/src/__tests__/**/*.test.ts'], exclude: ['**/*.real.test.ts', 'packages/server/src/__tests__/e2e-image.test.ts'], maxWorkers: Math.min(4, os.availableParallelism()) },
})
