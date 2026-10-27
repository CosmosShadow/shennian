// @covers src/project-coordination/http.ts
// @covers src/project-coordination/workbench-page.ts
import { describe, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import type http from 'node:http'
import { createWorkbenchHandler } from '../project-coordination/http.js'
import { WORKBENCH_PAGE } from '../project-coordination/workbench-page.js'
const origin = 'http://127.0.0.1:7777'
async function request(url: string, headers: Record<string, string>, body: unknown) {
  const command = vi.fn(async () => ({ enabled: true })), collected = { status: 0, headers: {} as Record<string, unknown>, body: '' }
  const handler = createWorkbenchHandler({ token: 'private-token', cookie: 'private-cookie', origin: () => origin, command })
  const req = Object.assign(Readable.from([JSON.stringify(body)]), { method: 'POST', url, headers: { host: '127.0.0.1:7777', origin, 'content-type': 'application/json', ...headers } })
  const res = { setHeader: (k: string, v: unknown) => { collected.headers[k] = v }, writeHead: (s: number) => { collected.status = s }, end: (v: string) => { collected.body = v } }
  await handler(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse)
  return { ...collected, command }
}
describe('local project workbench boundary', () => {
  it('refuses cross-site, rebound-host and unauthenticated commands without invoking the Client', async () => {
    for (const headers of [{ origin: 'https://evil.example' }, { host: 'evil.example' }, {}] as Array<Record<string, string>>) {
      const result = await request('/command', headers, { command: 'configure' })
      expect(result.status).toBe(403); expect(result.command).not.toHaveBeenCalled()
    }
  })
  it('issues a strict local cookie only for the private opening token and validates it on commands', async () => {
    expect((await request('/connect', {}, { token: 'wrong' })).status).toBe(403)
    const connected = await request('/connect', {}, { token: 'private-token' })
    expect(connected.headers['set-cookie']).toContain('HttpOnly; SameSite=Strict')
    const response = await request('/command', { cookie: 'sn_workbench=private-cookie' }, { command: 'get' })
    expect(response.status).toBe(200); expect(response.command).toHaveBeenCalledWith({ command: 'get' })
  })
  it('has a valid standalone script and uses text nodes for model output', () => {
    const script = /<script>([\s\S]+)<\/script>/.exec(WORKBENCH_PAGE)![1]!
    expect(() => new Function(script)).not.toThrow()
    expect(script).not.toContain('innerHTML')
  })
})
