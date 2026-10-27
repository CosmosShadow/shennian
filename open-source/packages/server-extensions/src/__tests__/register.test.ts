// @arch ../../../../docs/server-extensions.md
// @covers ../contract.ts
// @covers ../register.ts
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerServerExtensions } from '../register.js'
import type { ServerExtension } from '../contract.js'
const apps: FastifyInstance[] = []
const makeApp = () => { const app = Fastify(); apps.push(app); return app }
afterEach(async () => { await Promise.allSettled(apps.splice(0).map(app => app.close())); vi.unstubAllEnvs() })
const modules = async (app: FastifyInstance) => (await app.inject('/public/modules')).json()

describe('trusted server extension composition', () => {
  it('leaves core routes working and makes absent billing explicitly unavailable', async () => {
    const app = makeApp()
    app.get('/core', async () => ({ ok: true }))
    await registerServerExtensions(app, [], 'official')
    expect((await app.inject('/core')).json()).toEqual({ ok: true })
    for (const method of ['GET', 'POST'] as const) {
      const response = await app.inject({ method, url: '/billing/orders' })
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'module_unavailable', module: 'billing' })
    }
    expect(await modules(app)).toEqual({ schemaVersion: 1, modules: { billing: { available: false, enabled: false } } })
  })

  it('installs routes with the Fastify lifecycle and reports only module status', async () => {
    const app = makeApp()
    const stopped = vi.fn()
    await registerServerExtensions(app, [{
      id: 'billing', apiVersion: 1,
      routes: async scope => {
        scope.get('/billing/status', async () => ({ ready: true }))
        scope.addHook('onClose', async () => { stopped() })
      },
    }], 'official')
    expect((await app.inject('/billing/status')).json()).toEqual({ ready: true })
    const response = await app.inject('/public/modules')
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toEqual({ schemaVersion: 1, modules: { billing: { available: true, enabled: true } } })
    expect((await app.inject('/api/public/modules')).json()).toEqual(response.json())
    await app.close()
    expect(stopped).toHaveBeenCalledOnce()
  })

  it('does not execute an official-only extension on self-hosted instances', async () => {
    const app = makeApp()
    const routes = vi.fn(async () => {})
    await registerServerExtensions(app, [{ id: 'billing', apiVersion: 1, officialOnly: true, routes }], 'self-hosted')
    expect(routes).not.toHaveBeenCalled()
    expect((await app.inject('/billing')).statusCode).toBe(404)
    expect((await modules(app)).modules.billing.available).toBe(false)
  })

  it('keeps independent manifests for separate app instances', async () => {
    const a = makeApp(), b = makeApp()
    await registerServerExtensions(a, [{ id: 'billing', apiVersion: 1, enabled: false, routes: async () => {} }], 'official')
    await registerServerExtensions(b, [], 'official')
    expect((await modules(a)).modules.billing).toEqual({ available: true, enabled: false })
    expect((await modules(b)).modules.billing).toEqual({ available: false, enabled: false })
  })

  it('validates the entire manifest before installing any route', async () => {
    const routes = vi.fn(async () => {})
    const valid: ServerExtension = { id: 'billing', apiVersion: 1, routes }
    for (const invalid of [
      { ...valid, apiVersion: 2 }, { ...valid, id: '../module' },
      { ...valid, id: 'constructor' }, { ...valid, id: undefined }, { ...valid, routes: null },
    ]) {
      await expect(registerServerExtensions(makeApp(), [valid, invalid as unknown as ServerExtension], 'official')).rejects.toThrow('invalid_server_extension')
    }
    await expect(registerServerExtensions(makeApp(), [valid, valid], 'official')).rejects.toThrow('duplicate_server_extension')
    expect(routes).not.toHaveBeenCalled()
  })

  it('propagates broken installed modules rather than claiming they are missing', async () => {
    const app = makeApp()
    await expect(registerServerExtensions(app, [{
      id: 'billing', apiVersion: 1,
      routes: async () => { throw new Error('broken_billing_dependency') },
    }], 'official')).rejects.toThrow('broken_billing_dependency')
  })
})
