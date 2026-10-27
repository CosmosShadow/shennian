import { deliverProjectTaskEvent } from '../../steward/project-event.js'
// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/personal-workspace.test.ts
// @test src/__tests__/personal-recordings.test.ts
// @test src/__tests__/local-apps.test.ts
import type { ReqFrame } from '@shennian/wire'
import type { SessionManagerRuntime } from '../types.js'
import { handlePersonalWorkspace } from './personal-workspace.js'
import { handlePersonalRecording } from './personal-recording.js'
import { handleLocalApps } from './local-apps.js'
/** Keep the session manager a dispatcher; personal-resource handlers own their validation. */
export async function handlePersonalRequest(runtime: SessionManagerRuntime, req: ReqFrame) {
  if (req.method === 'project.taskEvent') {
    if (!runtime.chatQueue) throw new Error('project_event_queue_unavailable')
    return deliverProjectTaskEvent(req, runtime.chatQueue)
  }
  if (req.method === 'personal.workspace') return handlePersonalWorkspace(runtime, req)
  if (req.method === 'personal.recording') return handlePersonalRecording(runtime, req)
  return handleLocalApps(runtime, req)
}
