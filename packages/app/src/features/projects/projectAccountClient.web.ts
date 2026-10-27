// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test src/__tests__/project-account-client-web.test.ts
import type { NianProject } from '@shennian/wire'
import type { ProjectAccountClient } from './projectAccountClient.types'

type ProjectBridge = {
  execute(command: {
    requestId: string
    operation: 'project.defaults.update'
    input: { projectId: string; defaultAgentType: string; defaultModelId: string | null }
  }): Promise<
    | { ok: true; value: unknown }
    | { ok: false; error: { code: string; message: string; retryable: boolean } }
  >
}

let sequence = 0

export const projectAccountClient: ProjectAccountClient = {
  async updateDefaults(projectId, defaults) {
    const bridge = (globalThis as typeof globalThis & {
      shennianDesktop?: { account?: ProjectBridge }
    }).shennianDesktop?.account
    if (!bridge || typeof bridge.execute !== 'function') {
      throw Object.assign(new Error('Desktop project account bridge is unavailable.'), {
        code: 'BRIDGE_UNAVAILABLE', retryable: false,
      })
    }
    const result = await bridge.execute({
      requestId: `project-account-${Date.now()}-${++sequence}`,
      operation: 'project.defaults.update',
      input: { projectId, ...defaults },
    })
    if (!result.ok) throw Object.assign(new Error(result.error.message), result.error)
    const project = (result.value as { project?: NianProject } | null)?.project
    if (!project || project.id !== projectId || typeof project.machineId !== 'string' ||
        typeof project.workDir !== 'string' ||
        project.defaultAgentType !== defaults.defaultAgentType ||
        project.defaultModelId !== defaults.defaultModelId) {
      throw Object.assign(new Error('Desktop project account response is invalid.'), {
        code: 'INVALID_RESPONSE', retryable: false,
      })
    }
    return project
  },
}
