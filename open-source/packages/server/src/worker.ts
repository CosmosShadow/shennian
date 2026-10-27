// @arch open-source/docs/server-runtime.md
// @test src/__tests__/worker-runtime.test.ts
import './env.js'
import { startWorker } from './worker-entry.js'
await startWorker()
