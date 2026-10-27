// @arch docs/features/network-rooms/ui.md#九受管智能体与-room-workspace
// @test src/__tests__/room-agent-settings.test.ts

import { getSessionLiveActivity } from '@shennian/shared'
import {
  SESSION_SYNC_DATA_EPOCH,
  SESSION_SYNC_PROTOCOL_VERSION,
  type NianSession,
  type ResFrame,
} from '@shennian/wire'

export async function stopRoomAgentTask(
  session: NianSession,
  daemonInstallationId: string,
  request: (
    machineId: string,
    method: 'chat.abort',
    params: Record<string, unknown>,
  ) => Promise<ResFrame>,
): Promise<void> {
  if (!getSessionLiveActivity(session)) throw new Error('room_agent_no_active_task')
  const response = await request(session.machineId, 'chat.abort', {
    protocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
    dataEpoch: SESSION_SYNC_DATA_EPOCH,
    daemonInstallationId,
    sessionId: session.id,
    agentType: session.agentType,
    agentSessionId: session.agentSessionId ?? null,
    workDir: session.workDir,
  })
  if (!response.ok) throw new Error(response.error ?? 'agent_stop_failed')
}
