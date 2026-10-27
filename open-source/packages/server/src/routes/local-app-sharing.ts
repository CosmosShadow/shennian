// @arch open-source/docs/server-runtime.md
// @test src/__tests__/local-app-sharing.test.ts
import type { FastifyInstance } from 'fastify'
import { createHash, randomBytes } from 'node:crypto'
import { localServicePath } from '@shennian/wire'
import { requireUserOrMachineAuth, requireActivePlan } from '../middleware/auth.js'
import { relayService } from '../services/local-apps/gateway.js'
import { checkVisitor, createShare, createVisitor, rateLimit, readShare, revokeShare, shareKey, SHARE_SECONDS } from '../services/local-apps/sharing.js'
import { publicSdk, publicShell } from '../services/local-apps/public-page.js'

export async function localAppSharingRoutes(app: FastifyInstance) {
  const owner = [requireUserOrMachineAuth, requireActivePlan]
  app.post<{ Body: { machineId: string; appId: string; assets: string[]; posts: string[] } }>('/shares', { preHandler: owner, bodyLimit: 8000 }, async request => {
    const b = request.body
    if (!b || typeof b !== 'object' || typeof b.machineId !== 'string' || typeof b.appId !== 'string') throw new Error('invalid_share_request')
    // A paired machine credential cannot publish a different machine's applications.
    if (request.machineId && request.machineId !== b.machineId) throw new Error('machine_owner_required')
    await rateLimit(`publish:${request.userId}`, 10)
    const id = await createShare(request.userId, b.machineId, b.appId, b.assets ?? [], b.posts ?? [])
    return { shareId: id, sharePath: `/api/local-apps/shared/${id}/`, expiresIn: SHARE_SECONDS }
  })
  app.delete<{ Params: { id: string } }>('/shares/:id', { preHandler: owner }, async request => {
    await revokeShare(request.params.id, request.userId, request.machineId || undefined)
    return { revoked: true }
  })
  const options = { config: { cors: false }, logLevel: 'silent' as const }
  app.get<{ Params: { id: string } }>('/shared/:id/', options, async (request, reply) => {
    const id = request.params.id
    shareKey(id)
    await rateLimit(`ip:${createHash('sha256').update(request.ip).digest('hex')}`, 120)
    await rateLimit(`read:${id}`, 120)
    const share = await readShare(id), visitor = await createVisitor(id), nonce = randomBytes(16).toString('hex')
    // The edge may strip /api before forwarding. Browser URLs must keep the public API prefix.
    const base = `/api/local-apps/shared/${id}`
    reply.header('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; frame-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`)
    reply.header('Referrer-Policy', 'no-referrer').header('X-Content-Type-Options', 'nosniff')
    return reply.type('text/html').send(publicShell(base, share.app.entryPath, visitor, nonce))
  })
  app.get<{ Params: { id: string; '*': string } }>('/shared/:id/page/*', options, async (request, reply) => {
    const id = request.params.id
    shareKey(id)
    await rateLimit(`ip:${createHash('sha256').update(request.ip).digest('hex')}`, 120)
    await rateLimit(`read:${id}`, 120)
    const share = await readShare(id), path = localServicePath('/' + request.params['*'])
    if (request.raw.url?.includes('?') || !share.assets.includes(path)) throw new Error('local_share_forbidden')
    const response = await relayService(share.userId, share.machineId, { appId: share.app.id, port: share.app.port, method: 'GET', path, asset: true })
    reply.header('Content-Security-Policy', "default-src 'none'; sandbox allow-scripts allow-forms; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'")
    reply.header('Referrer-Policy', 'no-referrer').header('X-Content-Type-Options', 'nosniff').header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    // Never serve cookies, redirects, owner credentials or private registration metadata.
    reply.type(response.headers['content-type'] ?? 'application/octet-stream')
    let bytes = Buffer.from(response.base64, 'base64')
    if ((response.headers['content-type'] ?? '').includes('text/html')) {
      const html = bytes.toString('utf8')
      bytes = Buffer.from(/<head(?:\s[^>]*)?>/i.test(html) ? html.replace(/<head(?:\s[^>]*)?>/i, head => head + publicSdk()) : html.replace(/^(<!doctype[^>]*>)?/i, first => first + publicSdk()))
    }
    return reply.code(response.status).send(bytes)
  })
  app.post<{ Params: { id: string }; Body: { method: string; path: string; args?: Record<string, unknown> } }>('/shared/:id/service', { ...options, bodyLimit: 64000 }, async request => {
    const id = request.params.id
    await checkVisitor(id, request.headers['x-local-visitor'])
    await rateLimit(`write:${id}`, 30)
    await rateLimit(`visitor:${request.headers['x-local-visitor']}`, 10)
    const share = await readShare(id), b = request.body
    if (!b || Object.keys(b).some(k => !['method', 'path', 'args'].includes(k)) || b.method !== 'POST' || !share.posts.includes(b.path)) throw new Error('local_share_forbidden')
    const r = await relayService(share.userId, share.machineId, { appId: share.app.id, port: share.app.port, method: 'POST', path: b.path, args: b.args })
    const text = Buffer.from(r.base64, 'base64').toString('utf8')
    return { status: r.status, headers: r.headers, body: (r.headers['content-type'] ?? '').includes('application/json') ? JSON.parse(text) : text }
  })
}
