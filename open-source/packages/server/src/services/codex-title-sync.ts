// @arch open-source/docs/server-runtime.md
// @test open-source/packages/server/src/__tests__/sessions-messages.test.ts

import {
  SESSION_SYNC_DATA_EPOCH,
  SESSION_SYNC_PROTOCOL_VERSION,
  isAvailableAgentType,
  type ReqFrame,
  type SessionTitleSetParams,
} from '@shennian/wire'
import { sendServerReqToMachine } from '../relay/server-requests.js'
import { prisma } from '../lib/prisma.js'

export function syncCodexThreadTitle(params: {
  machineId: string
  sessionId: string
  agentType?: string | null
  agentSessionId?: string | null
  workDir?: string | null
  title: string
  titleRevision: number
  titleOriginEventId: string
}): void {
  const title = params.title.trim()
  if (!title || !params.agentType || !isAvailableAgentType(params.agentType)) return
  const agentType = params.agentType

  void (async () => {
    const machine = await prisma.machine.findUnique({
      where: { id: params.machineId },
      select: { daemonInstallationId: true, sessionSyncDataEpoch: true },
    })
    if (!machine?.daemonInstallationId || machine.sessionSyncDataEpoch !== SESSION_SYNC_DATA_EPOCH) {
      throw new Error('upgrade_required')
    }
    const frame: Omit<ReqFrame, 'id'> = {
      type: 'req',
      method: 'session.title.set',
      params: {
        protocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
        dataEpoch: SESSION_SYNC_DATA_EPOCH,
        daemonInstallationId: machine.daemonInstallationId,
        sessionId: params.sessionId,
        agentType,
        agentSessionId: params.agentSessionId ?? null,
        workDir: params.workDir ?? '',
        title,
        titleSource: 'shennian_manual',
        titleRevision: params.titleRevision,
        titleOriginEventId: params.titleOriginEventId,
      } satisfies SessionTitleSetParams,
    }
    await sendServerReqToMachine(params.machineId, frame, 15_000)
  })().catch((error) => {
    console.warn(
      `[codex-title-sync] failed sessionId=${params.sessionId} agentSessionId=${params.agentSessionId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  })
}
