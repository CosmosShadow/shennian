// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/personal-workspace.test.ts
import type { ReqFrame } from '@shennian/wire'
import type { SessionManagerRuntime } from '../types.js'
import { personalWorkspace } from '../../personal-workspace/service.js'
import { coordinationCommand } from '../../project-coordination/runtime.js'
export async function handlePersonalWorkspace(runtime: SessionManagerRuntime, req: ReqFrame) {
  try {
    if (req.params.action === 'project_coordination') {
      runtime.client.sendRes({ type: 'res', id: req.id, ok: true, payload: await coordinationCommand(runtime, req.params) })
      return
    }
    // Only worker settings expose the tool catalog. Directory/info/read requests
    // must never run synchronous provider probes before reading a local file.
    const agents = req.params.action === 'worker_info' ? runtime.getAgentSnapshot?.() ?? [] : []
    runtime.client.sendRes({ type: 'res', id: req.id, ok: true, payload: await personalWorkspace(req.params, agents) })
  }
  catch (error) {
    const message = error instanceof Error ? error.message : ''
    runtime.client.sendRes({ type: 'res', id: req.id, ok: false, error: /^(personal_|coordination_)[a-z_]+$/.test(message) ? message : 'personal_directory_unavailable' })
  }
}
