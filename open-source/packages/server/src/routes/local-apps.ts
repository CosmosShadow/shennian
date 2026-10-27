// @arch open-source/docs/server-runtime.md
// @test src/__tests__/local-apps.test.ts
import { localAppSharingRoutes } from './local-app-sharing.js'
import type { FastifyInstance } from 'fastify'
import { createHash } from 'node:crypto'
import { localAppSdk, localServicePath } from '@shennian/wire'
import { prisma } from '../lib/prisma.js'
import { registerAuthDecorators, requireAuth, requireActivePlan } from '../middleware/auth.js'
import { createRuntime, listApps, machineCall, readRuntime, relayService, RUNTIME_SECONDS } from '../services/local-apps/gateway.js'

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_request')
  return value as Record<string, unknown>
}
const id = (value: unknown) => { if (typeof value !== 'string' || !/^[\w-]{1,100}$/.test(value)) throw new Error('invalid_id'); return value }
export async function localAppsRoutes(app: FastifyInstance) {
  registerAuthDecorators(app)
  app.setErrorHandler((error, _request, reply) => {
    const message = error instanceof Error ? error.message : ''
    const known = /^(invalid_|machine_owner_|local_|service_)/.test(message)
    return reply.code(message === 'local_share_rate_limited' ? 429 : message === 'local_share_forbidden' || message === 'machine_owner_required' ? 403 : message === 'local_share_unavailable' || message === 'local_visitor_expired' ? 410 : message === 'local_runtime_expired' ? 410 : message.startsWith('invalid_') ? 400 : 503).header('Cache-Control', 'no-store').send({ error: known ? message : 'local_apps_unavailable' })
  })
  app.addHook('onSend', async (request, reply) => { if (!request.url.includes('/runtime/')) reply.header('Cache-Control', 'no-store') })
  await app.register(localAppSharingRoutes)
  const auth = [requireAuth, async (request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => {
    const device = await prisma.device.findUnique({ where: { id: request.deviceId }, select: { userId: true } })
    if (device?.userId !== request.userId) return reply.code(401).send({ error: 'local_device_expired' })
  }, requireActivePlan]
  app.get('/machines', { preHandler: auth }, async request => ({ machines: await prisma.machine.findMany({ where: { userId: request.userId, paired: true, remoteAccessDisabledAt: null }, select: { id: true, name: true, online: true } }) }))
  app.get<{ Params: { machineId: string } }>('/machines/:machineId/apps', { preHandler: auth }, async request => ({ apps: await listApps(request.userId, id(request.params.machineId)) }))
  app.post<{ Params: { machineId: string } }>('/machines/:machineId/apps', { preHandler: auth, bodyLimit: 8000 }, async request => machineCall(request.userId, id(request.params.machineId), 'personal.apps.register', object(request.body)))
  app.delete<{ Params: { machineId: string; appId: string } }>('/machines/:machineId/apps/:appId', { preHandler: auth }, async request => machineCall(request.userId, id(request.params.machineId), 'personal.apps.remove', { appId: id(request.params.appId) }))
  app.post('/service', { preHandler: auth, bodyLimit: 300000 }, async request => {
    const { machineId, ...input } = object(request.body)
    return relayService(request.userId, id(machineId), input)
  })
  app.post('/runtime', { preHandler: auth, bodyLimit: 1000 }, async request => {
    const b = object(request.body), machineId = id(b.machineId), appId = id(b.appId)
    const { token, app: entry } = await createRuntime(request.userId, request.deviceId, machineId, appId)
    // Relative URL is resolved against configured API base by native, not a hard-coded host.
    return { runtimePath: `/local-apps/runtime/${token}${entry.entryPath}`, expiresIn: RUNTIME_SECONDS }
  })
  app.get<{ Params: { token: string; '*': string } }>('/runtime/:token/*', { config: { cors: false }, logLevel: 'silent' }, async (request, reply) => {
    const runtime = await readRuntime(request.params.token)
    const prefix = `${app.prefix}/runtime/${request.params.token}/`
    const cookieName = 'sn_local_runtime'
    const cookie = request.headers.cookie?.split(';').map(p => p.trim()).find(p => p.startsWith(cookieName + '='))?.slice(cookieName.length + 1)
    if (cookie !== runtime.cookie) {
      await requireAuth(request, reply)
      if (reply.sent) return
      if (request.userId !== runtime.userId || request.deviceId !== runtime.deviceId) return reply.code(403).send({ error: 'machine_owner_required' })
      await requireActivePlan(request, reply)
      if (reply.sent) return
    }
    const device = await prisma.device.findUnique({ where: { id: runtime.deviceId }, select: { tokenExpiry: true, userId: true } })
    if (!device || device.userId !== runtime.userId || device.tokenExpiry < new Date()) return reply.code(401).send({ error: 'local_runtime_expired' })
    request.userId = runtime.userId; request.deviceId = runtime.deviceId
    await requireActivePlan(request, reply)
    if (reply.sent) return
    const query = request.raw.url?.includes('?') ? '?' + request.raw.url.split('?').slice(1).join('?') : ''
    const path = localServicePath('/' + request.params['*'] + query)
    const response = await relayService(runtime.userId, runtime.machineId, { appId: runtime.app.id, port: runtime.app.port, method: 'GET', path, asset: true })
    reply.header('Set-Cookie', `${cookieName}=${runtime.cookie}; Path=${prefix}; Max-Age=${RUNTIME_SECONDS}; HttpOnly; Secure; SameSite=Strict`)
    reply.header('Cache-Control', 'private, no-cache').header('Vary', 'Cookie, Authorization')
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer')
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    // No platform bearer credential, arbitrary network access, navigation or other app frames.
    reply.header('Content-Security-Policy', "default-src 'none'; sandbox allow-scripts allow-same-origin; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'")
    for (const [name, value] of Object.entries(response.headers)) reply.header(name, value)
    let bytes = Buffer.from(response.base64, 'base64')
    if ((response.headers['content-type'] ?? '').includes('text/html')) {
      const script = '<script>' + localAppSdk(runtime.machineId, runtime.app.port) + '</script>'
      const html = bytes.toString('utf8')
      bytes = Buffer.from(/<head(?:\s[^>]*)?>/i.test(html) ? html.replace(/<head(?:\s[^>]*)?>/i, head => head + script) : html.replace(/^(<!doctype[^>]*>)?/i, first => first + script))
    }
    const etag = '"' + createHash('sha256').update(bytes).digest('hex') + '"'
    reply.header('ETag', etag)
    if (response.status === 200 && request.headers['if-none-match'] === etag) return reply.code(304).send()
    return reply.code(response.status).send(bytes)
  })
}
