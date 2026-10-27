// @arch docs/architecture/data-sync.md#工具详情按需读取
// @test src/__tests__/tool-detail-request.test.ts

import type { ToolCall } from '@shennian/shared'
import {
  SESSION_SYNC_DATA_EPOCH,
  SESSION_SYNC_PROTOCOL_VERSION,
  type SessionToolDetailRequest,
} from '@shennian/wire'

export function buildToolDetailRequest(
  sessionId: string,
  daemonInstallationId: string | null | undefined,
  tool: ToolCall | undefined,
): SessionToolDetailRequest | null {
  if (
    !sessionId || !daemonInstallationId || !tool?.toolCallId ||
    !Number.isSafeInteger(tool.detailRevision) || (tool.detailRevision ?? -1) < 0
  ) return null
  return {
    protocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
    dataEpoch: SESSION_SYNC_DATA_EPOCH,
    daemonInstallationId,
    sessionId,
    toolCallId: tool.toolCallId,
    detailRevision: tool.detailRevision as number,
    maxBytes: 32 * 1024,
  }
}
