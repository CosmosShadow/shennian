// @arch open-source/docs/server-runtime.md
// @test src/__tests__/personal-cloud-history.test.ts
import { cloudPersonalHistoryEnabled, syncPersonalCloudHistoryBatch } from '../services/personal-cloud-history.js'
let timer: ReturnType<typeof setInterval> | undefined
let running: Promise<void> | undefined
export function startPersonalCloudHistoryJob() {
  if (timer || !cloudPersonalHistoryEnabled()) return
  timer = setInterval(() => {
    if (!running) running = syncPersonalCloudHistoryBatch()
      .catch(() => console.error('[personal-cloud-history] batch failed'))
      .finally(() => { running = undefined })
  }, 2000)
  timer.unref?.()
}
export async function stopPersonalCloudHistoryJob() {
  clearInterval(timer)
  timer = undefined
  await running
}
