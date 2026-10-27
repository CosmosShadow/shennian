// @arch open-source/docs/server-runtime.md
// @test src/__tests__/sessions-messages.test.ts

import type { FastifyReply, FastifyRequest } from 'fastify'
import { SESSION_SYNC_DATA_EPOCH, SESSION_SYNC_PROTOCOL_VERSION } from '@shennian/wire'

export async function requirePersonalSyncHttpEpoch(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const protocol = request.headers['x-shennian-sync-protocol-version']
  const epoch = request.headers['x-shennian-data-epoch']
  if (protocol !== String(SESSION_SYNC_PROTOCOL_VERSION)) {
    return reply.code(426).send({
      error: 'upgrade_required',
      rejection: {
        code: 'upgrade_required', retryable: false, requiredAction: 'upgrade_client',
        authoritativeEpoch: SESSION_SYNC_DATA_EPOCH,
      },
    })
  }
  if (epoch !== String(SESSION_SYNC_DATA_EPOCH)) {
    return reply.code(409).send({
      error: 'epoch_mismatch',
      rejection: {
        code: 'epoch_mismatch', retryable: false, requiredAction: 'reset_epoch',
        authoritativeEpoch: SESSION_SYNC_DATA_EPOCH,
      },
    })
  }
}
