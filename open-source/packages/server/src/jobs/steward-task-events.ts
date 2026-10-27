// @arch open-source/docs/server-runtime.md
// @test src/__tests__/steward-task-watch.test.ts
import { drainStewardTaskEvents } from '../services/steward-task-watch.js'
let timer: ReturnType<typeof setInterval> | undefined
let running: Promise<void> | undefined
export function startStewardTaskEventsJob() {
  if (timer) return
  timer = setInterval(() => {
    if (!running) running = drainStewardTaskEvents().catch(() => console.error('[steward-task-events] tick failed')).finally(() => { running = undefined })
  }, 2000)
  timer.unref?.()
}
export async function stopStewardTaskEventsJob() { clearInterval(timer); timer = undefined; await running }
