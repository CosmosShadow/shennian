// @arch open-source/docs/server-runtime.md
// @test src/__tests__/agent-room-recovery.test.ts

import { createHash } from 'node:crypto'

export function agentRoomRecoveryCreationKey(input: {
  userId: string
  agentIdentityId: string
  bindingId: string
  recoveryIntentId: string
}): string {
  return createHash('sha256')
    .update(
      `${input.userId}\0${input.agentIdentityId}\0${input.bindingId}\0${input.recoveryIntentId}`,
    )
    .digest('hex')
}
