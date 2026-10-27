// @arch open-source/docs/server-runtime.md
// @test open-source/deploy/self-hosted/core-boundary.test.mjs
import fs from 'node:fs'
fs.cpSync('src/schemas', 'dist/schemas', { recursive: true })
