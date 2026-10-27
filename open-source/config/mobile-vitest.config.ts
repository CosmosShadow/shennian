// @arch open-source/docs/mobile-app.md
// @test packages/app/src/__tests__/app-config.test.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
const parent = path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'shennian-tests', 'unit')
fs.mkdirSync(parent, { recursive: true })
const tmp = fs.mkdtempSync(path.join(parent, 'mobile-'))
process.env.TMPDIR = tmp
process.env.TMP = tmp
process.env.TEMP = tmp
process.env.SHENNIAN_ACCOUNT_NAMESPACE_ID ??= '0'.repeat(64)
process.env.DATABASE_URL ??= 'mysql://unit:unit@127.0.0.1:1/unit'
process.env.REDIS_URL ??= 'redis://127.0.0.1:1'
export default defineConfig({
  root: fileURLToPath(new URL('../../', import.meta.url)),
  resolve: { dedupe: ['react', 'react-dom'] },
  test: {
    server: { deps: { inline: ['zustand'] } },
    include: ['packages/app/src/__tests__/**/*.test.ts'], maxWorkers: Math.min(4, os.availableParallelism()),
    exclude: [
      '**/desktop-*.test.ts',
      // Legacy integration suites import the paused Desktop main process.
      // Their Native transport contracts have a standalone mobile suite.
      '**/agent-room-session-client.test.ts',
      '**/remove-room-agent.test.ts',
      '**/room-invitation-client.test.ts',
      '**/machine-readable-page-state-matrix.test.ts',
      '**/workbuddy-integration-ui.test.ts',
      'packages/app/src/__tests__/ota-channel-config.test.ts',
    ],
  },
})
