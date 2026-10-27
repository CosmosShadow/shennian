// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/session-manager-session-refresh.test.ts

import type { ReqFrame } from '@shennian/wire'
import type { SessionManagerRuntime } from '../types.js'

export async function handleSessionRefresh(
  runtime: SessionManagerRuntime,
  req: ReqFrame,
): Promise<void> {
  const params = req.params as {
    sessionId?: string
    agentType?: string
    agentSessionId?: string | null
    workDir?: string
  }

  if (!params.sessionId) {
    runtime.client.sendRes({
      type: 'res',
      id: req.id,
      ok: false,
      error: 'sessionId is required',
    })
    return
  }

  if (!runtime.nativeFusion) {
    runtime.client.sendRes({
      type: 'res',
      id: req.id,
      ok: true,
      payload: { scanned: false },
    })
    return
  }

  await runtime.nativeFusion.scanNow()
  runtime.client.sendRes({
    type: 'res',
    id: req.id,
    ok: true,
    payload: {
      scanned: true,
      sessionId: params.sessionId,
      agentType: params.agentType ?? null,
      agentSessionId: params.agentSessionId ?? null,
    },
  })
}
