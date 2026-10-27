// @arch docs/features/network-rooms/ui.md#九受管智能体与-room-workspace
// @test ../../__tests__/desktop-room-agent-controller.test.ts
import type { DesktopRoomAgentModeInput } from './desktopRoomAgentClient'
import type { RoomAgentSettingsData } from '../rooms/useRoomAgentSettings'

/** Short-lived view state only. Main owns relationship validation and mutations. */
export function createDesktopRoomAgentReader(deps: {
  isCurrent(): boolean
  read(): Promise<RoomAgentSettingsData>
  publish(data: RoomAgentSettingsData | null, failed: boolean): void
}) {
  let active = false
  let revision = 0
  return {
    start() { active = true; revision += 1 },
    stop() { active = false; revision += 1 },
    async refresh() {
      if (!active || !deps.isCurrent()) return
      const ticket = ++revision
      const current = () => active && ticket === revision && deps.isCurrent()
      try {
        const data = await deps.read()
        if (current()) deps.publish(data, false)
      } catch {
        // A failed authoritative relationship read cannot keep authorizing actions.
        if (current()) deps.publish(null, true)
      }
    },
  }
}

export function createDesktopRoomAgentModeController(deps: {
  isCurrent(): boolean
  save(input: DesktopRoomAgentModeInput): Promise<RoomAgentSettingsData>
}) {
  let active = false
  let epoch = 0
  let pending: symbol | null = null
  let releaseBusy: (() => void) | null = null
  const release = () => { const callback = releaseBusy; releaseBusy = null; callback?.() }
  return {
    start() { release(); active = true; epoch += 1; pending = null },
    stop() { active = false; epoch += 1; pending = null; release() },
    async apply(input: DesktopRoomAgentModeInput, callbacks: {
      busy(value: boolean): void
      committed(data: RoomAgentSettingsData): Promise<void>
      failed(error: unknown): Promise<void>
    }) {
      if (!active || !deps.isCurrent() || pending || input.original === input.desired) return
      const request = Symbol()
      const generation = epoch
      const current = () => active && epoch === generation && deps.isCurrent()
      pending = request
      releaseBusy = () => callbacks.busy(false)
      callbacks.busy(true)
      try {
        const data = await deps.save(input)
        if (current()) await callbacks.committed(data)
      } catch (error) {
        if (current()) await callbacks.failed(error)
      } finally {
        if (pending === request) { pending = null; release() }
      }
    },
  }
}
