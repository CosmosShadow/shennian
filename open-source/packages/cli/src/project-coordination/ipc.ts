// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/project-coordination-runtime.test.ts
import type { JsonValue } from '../daemon-ipc/json.js'
import type { SessionManager } from '../session/manager.js'
export function createProjectCoordinationIpcHandlers(manager: () => SessionManager | undefined) {
  return Object.fromEntries(['project.workbench', 'project.coordination'].map(method => [method, async (params: JsonValue | undefined) => {
    const active = manager()
    if (!active) throw new Error('daemon_starting')
    return await (method === 'project.workbench' ? active.openProjectWorkbench(params as Record<string, unknown>) : active.coordinateFromLocal(params as Record<string, unknown>)) as JsonValue
  }]))
}
