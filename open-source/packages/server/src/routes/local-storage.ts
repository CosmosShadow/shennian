// @arch open-source/docs/server-runtime.md
// @test src/__tests__/local-object-store.test.ts
import type { FastifyInstance } from 'fastify'
import { createHash } from 'node:crypto'
import { getStorageProvider, getLocalObjectStore } from '../lib/oss.js'
import { MAX_LOCAL_OBJECT_BYTES } from '../lib/local-object-store.js'
import { verifyLocalStorageCapability } from '../lib/local-storage-capability.js'

export async function localStorageRoutes(app: FastifyInstance) {
  app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    const status = error.statusCode === 413 ? 413 : error.statusCode === 400 ? 400 : 500
    return reply.code(status).send({ error: status === 413 ? 'storage_object_too_large' : 'local_storage_failed' })
  })
  // Encapsulated binary parser: never changes auth/Room JSON parsers.
  app.removeAllContentTypeParsers()
  app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: MAX_LOCAL_OBJECT_BYTES }, (_request, body, done) => done(null, body))
  app.addHook('onRequest', async (request, reply) => {
    reply.header('cache-control', 'private, no-store')
      .header('referrer-policy', 'no-referrer')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "sandbox; default-src 'none'")
    if (getStorageProvider() !== 'local') return reply.code(404).send({ error: 'local_storage_unavailable' })
    const query = request.query as { capability?: unknown }
    if (!verifyLocalStorageCapability(query.capability, request.method)) {
      return reply.code(403).send({ error: 'storage_capability_invalid' })
    }
  })
  const path = '/storage/local/object'
  app.get<{ Querystring: { capability: string } }>(path, { exposeHeadRoute: false }, async (request, reply) => {
    const capability = verifyLocalStorageCapability(request.query.capability, 'GET')
    if (!capability) return reply.code(403).send({ error: 'storage_capability_invalid' })
    const object = await getLocalObjectStore().get(capability.key)
    if (!object) return reply.code(404).send({ error: 'storage_object_missing' })
    return reply.type(object.mimeType ?? 'application/octet-stream')
      .header('content-disposition', 'attachment').send(object.buffer)
  })
  app.put<{ Querystring: { capability: string }; Body: Buffer }>(path, { bodyLimit: MAX_LOCAL_OBJECT_BYTES }, async (request, reply) => {
    const capability = verifyLocalStorageCapability(request.query.capability, 'PUT')
    if (!capability) return reply.code(403).send({ error: 'storage_capability_invalid' })
    const body = request.body
    if (!Buffer.isBuffer(body) || request.headers['content-type'] !== capability.contentType ||
      (capability.byteSize !== undefined && body.length !== capability.byteSize) ||
      createHash('sha256').update(body).digest('hex') !== capability.sha256) {
      return reply.code(400).send({ error: 'storage_upload_mismatch' })
    }
    await getLocalObjectStore().put(capability.key, body, capability.contentType!)
    return reply.code(204).send()
  })
}
