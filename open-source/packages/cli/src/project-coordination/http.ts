// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/project-coordination-http.test.ts
import http from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { WORKBENCH_PAGE } from './workbench-page.js'
const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
export function createWorkbenchHandler(options: { token: string; cookie: string; origin: () => string; command: (input: Record<string, unknown>) => Promise<unknown> }) {
  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const origin = options.origin()
    res.setHeader('cache-control', 'no-store'); res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('referrer-policy', 'no-referrer')
    res.setHeader('content-security-policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
    const send = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
    if (req.headers.host !== new URL(origin).host) return send(403, { error: 'workbench_host_forbidden' })
    if (req.method === 'GET' && req.url === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(WORKBENCH_PAGE); return }
    if (req.method !== 'POST' || req.headers.origin !== origin || !req.headers['content-type']?.startsWith('application/json')) return send(403, { error: 'workbench_origin_forbidden' })
    if (req.url !== '/connect' && req.url !== '/command') return send(404, { error: 'not_found' })
    try {
      let body = ''
      for await (const chunk of req) { body += chunk.toString(); if (Buffer.byteLength(body) > 100000) return send(413, { error: 'request_too_large' }) }
      const input = JSON.parse(body)
      if (!input || typeof input !== 'object' || Array.isArray(input)) return send(400, { error: 'request_invalid' })
      if (req.url === '/connect') {
        if (typeof input.token !== 'string' || !equal(input.token, options.token)) return send(403, { error: 'workbench_auth_required' })
        res.setHeader('set-cookie', `sn_workbench=${options.cookie}; HttpOnly; SameSite=Strict; Path=/`)
        return send(200, { ok: true })
      }
      const cookie = /(?:^|;\s*)sn_workbench=([^;]+)/.exec(req.headers.cookie ?? '')?.[1] ?? ''
      if (!equal(cookie, options.cookie)) return send(403, { error: 'workbench_auth_required' })
      return send(200, await options.command(input))
    } catch (error) { return send(400, { error: error instanceof Error && /^coordination_[a-z_]+$/.test(error.message) ? error.message : 'workbench_request_failed' }) }
  }
}
export async function startProjectWorkbench(command: (input: Record<string, unknown>) => Promise<unknown>) {
  const token = randomBytes(32).toString('hex'), cookie = randomBytes(32).toString('hex')
  let origin = ''
  const server = http.createServer(createWorkbenchHandler({ token, cookie, origin: () => origin, command }))
  server.requestTimeout = 15000; server.headersTimeout = 10000
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()) })
  const address = server.address()
  if (!address || typeof address === 'string') { server.close(); throw new Error('workbench_start_failed') }
  origin = `http://127.0.0.1:${address.port}`
  server.unref()
  return { url: `${origin}/#${token}`, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
}
export class ProjectWorkbenchRegistry {
  private pages = new Map<string, Awaited<ReturnType<typeof startProjectWorkbench>>>()
  constructor(private command: (input: Record<string, unknown>) => Promise<unknown>) {}
  async open(workDir: string) {
    if (!workDir) throw new Error('coordination_directory_invalid')
    await this.command({ command: 'get', workDir })
    let page = this.pages.get(workDir)
    if (!page) { page = await startProjectWorkbench(input => this.command({ ...input, workDir })); this.pages.set(workDir, page) }
    return { url: page.url }
  }
  async close() { await Promise.all([...this.pages.values()].map(page => page.close())); this.pages.clear() }
}
