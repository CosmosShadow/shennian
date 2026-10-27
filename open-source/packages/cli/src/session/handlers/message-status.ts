// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/session-store.test.ts

import type { ReqFrame, SessionMessageStatusParams } from '@shennian/wire'
import type { SessionManagerRuntime } from '../types.js'
import { getMessageDeliveryStatus } from '../store.js'
import { assertPersonalSyncIdentity } from '../../personal-sync/epoch.js'

export function handleSessionMessageStatus(runtime: SessionManagerRuntime, req: ReqFrame): void {
  const params = req.params as SessionMessageStatusParams
  assertPersonalSyncIdentity(params)
  if (!params.sessionId || !params.clientMessageId) {
    throw new Error('sessionId and clientMessageId are required')
  }
  runtime.client.sendRes({
    type: 'res', id: req.id, ok: true,
    payload: getMessageDeliveryStatus(params.sessionId, params.clientMessageId),
  })
}
