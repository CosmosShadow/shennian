// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/personal-recordings.test.ts
import type { ReqFrame } from '@shennian/wire'
import type { SessionManagerRuntime } from '../types.js'
import { receivePersonalRecording, type RecordingRequest } from '../../personal-workspace/recordings.js'
export function handlePersonalRecording(runtime: SessionManagerRuntime, req: ReqFrame) {
  try { runtime.client.sendRes({ type: 'res', id: req.id, ok: true, payload: receivePersonalRecording(req.params as RecordingRequest) }) }
  catch (error) {
    const message = error instanceof Error ? error.message : ''
    runtime.client.sendRes({ type: 'res', id: req.id, ok: false, error: /^recording_[a-z_]+$/.test(message) ? message : 'recording_unavailable' })
  }
}
