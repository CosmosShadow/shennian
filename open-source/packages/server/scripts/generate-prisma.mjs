// @arch open-source/docs/server-runtime.md
// @test open-source/deploy/self-hosted/core-boundary.test.mjs
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
// Generation does not connect to a DB. No default URL is provided to migrate deploy.
const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'generate'], {
  env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || 'mysql://build:build@127.0.0.1:3306/build', CHECKPOINT_DISABLE: '1' },
  stdio: 'inherit',
})
process.exitCode = result.status ?? 1
