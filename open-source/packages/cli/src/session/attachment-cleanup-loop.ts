// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/attachment-cleanup-loop.test.ts

import { sweepAttachmentTransfersCooperatively } from './attachment-transfer-store.js'

type CleanupOptions = {
  getRoots: () => Iterable<string>
  onError: (error: unknown) => void
  sweep?: (root: string, shouldContinue: () => boolean) => Promise<unknown>
}

/** A single cancellable sweep prevents slow disks from piling up minute jobs. */
export function startAttachmentCleanupLoop(options: CleanupOptions): () => void {
  let stopped = false
  let active = false
  const shouldContinue = () => !stopped
  const sweep = options.sweep ?? ((root, canContinue) =>
    sweepAttachmentTransfersCooperatively(root, Date.now(), canContinue))
  const run = async () => {
    for (const root of new Set(options.getRoots())) {
      if (stopped) return
      try { await sweep(root, shouldContinue) }
      catch (error) { options.onError(error) }
      await new Promise<void>(resolve => setImmediate(resolve))
    }
  }
  const timer = setInterval(() => {
    if (stopped || active) return
    active = true
    void run().catch(options.onError).finally(() => { active = false })
  }, 60_000)
  timer.unref?.()
  return () => { stopped = true; clearInterval(timer) }
}
