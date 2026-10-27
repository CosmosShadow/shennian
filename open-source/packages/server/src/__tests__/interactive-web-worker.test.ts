// @covers open-source/packages/server/src/jobs/interactive-content.ts
import { describe, expect, it, vi } from 'vitest'
import { startInteractiveContentJob, stopInteractiveContentJob } from '../jobs/interactive-content.js'
describe('retired shared HTML worker', () => {
  it('never starts a timer even if the old environment switch is enabled', async () => {
    const timer = vi.spyOn(globalThis, 'setInterval')
    vi.stubEnv('INTERACTIVE_CONTENT_ENABLED', '1')
    try { startInteractiveContentJob(); await stopInteractiveContentJob(); expect(timer).not.toHaveBeenCalled() }
    finally { timer.mockRestore(); vi.unstubAllEnvs() }
  })
})
