// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/session-manager-core.test.ts

import { isAvailableAgentType, type SessionDeletionsSyncResponse } from '@shennian/wire'

export function validateDeletionSyncResponse(
  payload: SessionDeletionsSyncResponse,
  afterRevision: number,
): void {
  if (
    !payload ||
    !Number.isSafeInteger(payload.baselineRevision) ||
    payload.baselineRevision < afterRevision ||
    !Number.isSafeInteger(payload.latestRevision) ||
    payload.latestRevision < payload.baselineRevision ||
    !Array.isArray(payload.deletions)
  )
    throw new Error('invalid deletion sync response')
  let previous = payload.baselineRevision
  for (const deletion of payload.deletions) {
    if (
      !deletion?.sessionId ||
      !Number.isSafeInteger(deletion.deletionRevision) ||
      deletion.deletionRevision !== previous + 1 ||
      !Array.isArray(deletion.sources) ||
      Number.isNaN(Date.parse(deletion.deletedAt)) ||
      (deletion.nativeCleanupPolicy !== undefined &&
        deletion.nativeCleanupPolicy !== 'none' &&
        deletion.nativeCleanupPolicy !== 'auto')
    ) {
      throw new Error('invalid session deletion command')
    }
    for (const source of deletion.sources) {
      if (!source?.sourceSessionKey || !isAvailableAgentType(source.agentType)) {
        throw new Error('invalid native source deletion command')
      }
    }
    previous = deletion.deletionRevision
  }
  if (previous !== payload.latestRevision) throw new Error('invalid deletion sync revision range')
}
