// @arch open-source/docs/server-runtime.md
// @test src/__tests__/retired-external-channels.test.ts
import type { FastifyInstance, FastifyReply } from 'fastify'

const RETIRED_RESPONSE = {
  error: 'feature_retired',
  message: 'External IM connectors have been retired. Use Shennian Rooms or the public Agent Protocol instead.',
} as const

function replyRetired(reply: FastifyReply) {
  return reply.code(410).send(RETIRED_RESPONSE)
}
/**
 * Compatibility endpoint for already-released clients. Provider implementations
 * are deliberately not imported here: old URLs remain deterministic without
 * keeping credentials, callbacks, schedulers, or new write paths alive.
 */
export async function retiredExternalChannelRoutes(app: FastifyInstance) {
  app.all('/', async (_request, reply) => replyRetired(reply))
  app.all('/*', async (_request, reply) => replyRetired(reply))
}
