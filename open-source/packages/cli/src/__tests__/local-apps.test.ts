// @covers open-source/packages/cli/src/local-apps/service.ts
// @covers open-source/packages/cli/src/commands/local-apps.ts
// @covers open-source/packages/wire/src/local-apps.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { localServicePath } from '@shennian/wire'
import { Command } from 'commander'
import { registerLocalAppsCommand } from '../commands/local-apps.js'
import { localApps } from '../local-apps/service.js'
import * as config from '../config/index.js'
import { createLocalAppService } from '../local-apps/service.js'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
async function fixture(transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"count":2}', { headers: { 'content-type': 'application/json', 'set-cookie': 'private=secret' } }))) {
  const parent = path.join(os.tmpdir(), 'shennian-tests', 'unit'); await fs.mkdir(parent, { recursive: true })
  const root = await fs.mkdtemp(path.join(parent, 'local-apps-')); roots.push(root)
  const service = createLocalAppService(root, transport)
  const app = await service.register({ title: 'My local app', port: 5173, entryPath: '/', directory: '/unit/project' })
  return { root, service, app, transport }
}
describe('private local app service', () => {
  it('publishes only to the configured instance and supports revoking the same scoped link', async () => {
    const cfg = vi.spyOn(config, 'loadConfig').mockReturnValue({ serverUrl: 'https://unit.example', machineId: 'unit-machine', machineToken: 'unit-machine-token' })
    const get = vi.spyOn(localApps, 'get').mockResolvedValue({ id: 'unit', title: 'Example', port: 5173, entryPath: '/', directory: '/unit', updatedAt: '' })
    const shareId = 'a'.repeat(48), sharePath = `/api/local-apps/shared/${shareId}/`
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ shareId, sharePath, expiresIn: 2592000 }), { status: 200 }))
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const command = new Command(); registerLocalAppsCommand(command)
      await command.parseAsync(['node', 'unit', 'local-apps', 'share', 'unit', '--post', '/api/submissions'])
      expect(request).toHaveBeenCalledWith('https://unit.example/api/local-apps/shares', expect.objectContaining({ method: 'POST', body: JSON.stringify({ appId: 'unit', assets: [], posts: ['/api/submissions'], machineId: 'unit-machine' }) }))
      expect(JSON.parse(output.mock.calls[0]![0]).url).toBe('https://unit.example' + sharePath)
      request.mockResolvedValueOnce(new Response('{"revoked":true}', { status: 200 }))
      const revoke = new Command(); registerLocalAppsCommand(revoke)
      await revoke.parseAsync(['node', 'unit', 'local-apps', 'unshare', shareId])
      expect(request).toHaveBeenLastCalledWith(`https://unit.example/api/local-apps/shares/${shareId}`, expect.objectContaining({ method: 'DELETE' }))
      expect(request.mock.calls.at(-1)?.[1]?.headers).not.toHaveProperty('content-type')
    } finally { cfg.mockRestore(); get.mockRestore(); request.mockRestore(); output.mockRestore() }
  })
  it('does not attempt a publish when machine pairing is absent', async () => {
    const cfg = vi.spyOn(config, 'loadConfig').mockReturnValue({})
    const get = vi.spyOn(localApps, 'get').mockResolvedValue({ id: 'unit', title: 'Example', port: 5173, entryPath: '/', directory: '/unit', updatedAt: '' })
    const request = vi.spyOn(globalThis, 'fetch')
    try {
      const command = new Command(); registerLocalAppsCommand(command)
      await expect(command.parseAsync(['node', 'unit', 'local-apps', 'share', 'unit'])).rejects.toThrow('machine_pairing_required')
      expect(request).not.toHaveBeenCalled()
    } finally { cfg.mockRestore(); get.mockRestore(); request.mockRestore() }
  })

  it('registers local development services through the CLI without generating files or starting agents', async () => {
    const registration = vi.spyOn(localApps, 'register').mockResolvedValue({ id: 'unit', title: 'Example', port: 5173, entryPath: '/', directory: '/unit', updatedAt: '' })
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const command = new Command(); registerLocalAppsCommand(command)
      await command.parseAsync(['node', 'unit', 'local-apps', 'register', '--title', 'Example', '--port', '5173', '--directory', '/unit'])
      expect(registration).toHaveBeenCalledWith({ title: 'Example', port: 5173, entryPath: '/', directory: '/unit' })
    } finally { registration.mockRestore(); output.mockRestore() }
  })
  it('updates one registry record without HTML history; removing keeps source files', async () => {
    const { root, service, app } = await fixture()
    await fs.writeFile(path.join(root, 'source.html'), 'owned file')
    await service.register({ ...app, updatedAt: undefined }).catch(() => {}) // unknown fields cannot be persisted
    await service.register({ id: app.id, title: 'Updated', port: 5174, entryPath: '/index.html', directory: '/unit/project' })
    expect((await service.list()).map(a => [a.id, a.title, a.port])).toEqual([[app.id, 'Updated', 5174]])
    expect((await fs.readdir(root)).filter(f => f.endsWith('.json'))).toEqual([app.id + '.json'])
    await service.remove(app.id)
    expect(await service.list()).toEqual([])
    expect(await fs.readFile(path.join(root, 'source.html'), 'utf8')).toBe('owned file')
  })
  it('forwards only to the registered loopback service and strips cookies', async () => {
    const { service, app, transport } = await fixture()
    const result = await service.request({ appId: app.id, port: 5173, method: 'post', path: '/api/vote', args: { reason: 'useful' } })
    const [url, init] = transport.mock.calls[0]!
    expect(String(url)).toBe('http://127.0.0.1:5173/api/vote')
    expect(init).toMatchObject({ method: 'POST', redirect: 'manual', body: '{"reason":"useful"}' })
    expect(result).toMatchObject({ status: 200, headers: { 'content-type': 'application/json' }, base64: Buffer.from('{"count":2}').toString('base64') })
    expect(result.headers['set-cookie']).toBeUndefined()
    await expect(service.request({ appId: app.id, port: 8000, method: 'GET', path: '/' })).rejects.toThrow('service_port_forbidden')
    expect(transport).toHaveBeenCalledTimes(1)
  })
  it.each(['/../x', '/%2e%2e/x', '/%252e%252e/x', '//elsewhere/a', '/%2felsewhere', '/a\\b', '/%5cb', '/a#b', '/%', 'https://example.com'])('rejects unsafe path %s before fetching', value => expect(() => localServicePath(value)).toThrow('invalid_service_path'))
  it('keeps GET parameters and DELETE JSON separate and rejects arbitrary headers', async () => {
    const { service, app, transport } = await fixture(vi.fn<typeof fetch>().mockImplementation(async () => new Response('ok')))
    await service.request({ appId: app.id, port: app.port, method: 'GET', path: '/api?q=one', args: { q: 'two', tags: ['a'] } })
    expect(String(transport.mock.calls[0]![0])).toBe('http://127.0.0.1:5173/api?q=two&tags=%5B%22a%22%5D')
    await service.request({ appId: app.id, port: app.port, method: 'DELETE', path: '/api/1', args: { confirm: true } })
    expect(transport.mock.calls[1]![1]).toMatchObject({ method: 'DELETE', body: '{"confirm":true}' })
    await expect(service.request({ appId: app.id, port: app.port, method: 'GET', path: '/', headers: { authorization: 'unsafe' } })).rejects.toThrow('invalid_service_request')
  })
  it('never follows redirects or retries a failed write', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }))
    const { service, app } = await fixture(transport)
    await expect(service.request({ appId: app.id, port: app.port, method: 'POST', path: '/' })).rejects.toThrow('service_redirect_blocked')
    expect(transport).toHaveBeenCalledTimes(1)
  })
  it('enforces the streamed response cap', async () => {
    const { service, app } = await fixture(vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array(2 * 1024 * 1024 + 1))))
    await expect(service.request({ appId: app.id, port: app.port, method: 'GET', path: '/' })).rejects.toThrow('service_response_too_large')
  })
})

describe('read-only AI configuration and diagnostics', () => {
  it('checks only the registered entry and returns no page text or headers', async () => {
    const { service, app, transport } = await fixture()
    const config = await service.get(app.id)
    expect(config).toMatchObject({ port: 5173, directory: '/unit/project', entryPath: '/' })
    expect(transport).not.toHaveBeenCalled() // inspecting configuration is offline/read-only
    const result = await service.doctor(app.id)
    expect(result).toEqual({ check: 'local_entry_http', appId: app.id, status: 'ready', httpStatus: 200 })
    expect(transport).toHaveBeenCalledTimes(1)
    expect(String(transport.mock.calls[0]![0])).toBe('http://127.0.0.1:5173/')
    expect(transport.mock.calls[0]![1]).toMatchObject({ method: 'GET', redirect: 'manual' })
    expect(await service.get(app.id)).toEqual(config) // no registration or version changes
  })
  it('distinguishes HTTP failures, an absent registration and an unavailable service without leaking errors', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('private app error', { status: 500 })).mockRejectedValueOnce(new Error('private URL and internal stack'))
    const { service, app } = await fixture(transport)
    expect(await service.doctor(app.id)).toEqual({ check: 'local_entry_http', appId: app.id, status: 'http_error', httpStatus: 500 })
    expect(await service.doctor(app.id)).toEqual({ check: 'local_entry_http', appId: app.id, status: 'unavailable', reason: 'service_unavailable' })
    expect(await service.doctor('missing')).toEqual({ check: 'local_entry_http', appId: 'missing', status: 'unavailable', reason: 'app_not_registered' })
    expect(transport).toHaveBeenCalledTimes(2)
  })
  it('does not follow redirects in diagnostic requests', async () => {
    const { service, app, transport } = await fixture(vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://other/' } })))
    expect(await service.doctor(app.id)).toMatchObject({ status: 'unavailable', reason: 'service_redirect_blocked' })
    expect(transport).toHaveBeenCalledTimes(1)
  })
  it('exposes the real diagnostic CLI command without invoking Agent or repair actions', async () => {
    const doctor = vi.spyOn(localApps, 'doctor').mockResolvedValue({ check: 'local_entry_http', appId: 'unit', status: 'ready', httpStatus: 200 })
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const command = new Command(); registerLocalAppsCommand(command)
      await command.parseAsync(['node', 'unit', 'local-apps', 'doctor', 'unit'])
      expect(doctor).toHaveBeenCalledWith('unit')
      expect(JSON.parse(String(output.mock.calls[0]![0]))).toEqual({ check: 'local_entry_http', appId: 'unit', status: 'ready', httpStatus: 200 })
    } finally { doctor.mockRestore(); output.mockRestore() }
  })
})

it('returns only the selected registration and machine identity for explicit AI inspection', async () => {
  const app = { id: 'unit', title: 'App', port: 5173, entryPath: '/', directory: '/unit', updatedAt: '' }
  const get = vi.spyOn(localApps, 'get').mockResolvedValue(app)
  const read = vi.spyOn(config, 'loadConfig').mockReturnValue({ machineId: 'unit-machine', machineToken: 'private-token-must-not-be-returned' })
  const output = vi.spyOn(console, 'log').mockImplementation(() => {})
  try {
    const command = new Command(); registerLocalAppsCommand(command)
    await command.parseAsync(['node', 'unit', 'local-apps', 'inspect', 'unit'])
    expect(get).toHaveBeenCalledWith('unit')
    expect(JSON.parse(String(output.mock.calls[0]![0]))).toEqual({ app, machineId: 'unit-machine' })
  } finally { get.mockRestore(); read.mockRestore(); output.mockRestore() }
})
