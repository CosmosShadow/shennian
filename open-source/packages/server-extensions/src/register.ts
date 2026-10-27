// @arch ../../../docs/server-extensions.md
// @test __tests__/register.test.ts
import type { FastifyInstance } from 'fastify'
import type { ServerExtension, ServerModulesResponse, ServerModuleStatus } from './contract.js'

export async function registerServerExtensions(
  app: FastifyInstance,
  extensions: readonly ServerExtension[],
  mode: 'official' | 'self-hosted',
): Promise<ServerModulesResponse> {
  const selected: ServerExtension[] = []
  const ids = new Set<string>()
  // Validate the whole manifest before executing any extension.
  for (const extension of extensions) {
    if (!extension || typeof extension.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(extension.id) ||
      ['constructor', 'prototype'].includes(extension.id) || extension.apiVersion !== 1 ||
      typeof extension.routes !== 'function' ||
      (extension.enabled !== undefined && typeof extension.enabled !== 'boolean') ||
      (extension.officialOnly !== undefined && typeof extension.officialOnly !== 'boolean')) {
      throw new Error('invalid_server_extension')
    }
    if (ids.has(extension.id)) throw new Error('duplicate_server_extension')
    ids.add(extension.id)
    if (mode === 'self-hosted' && extension.officialOnly) continue
    selected.push(Object.freeze({ ...extension }))
  }
  const statuses = new Map<string, ServerModuleStatus>([
    ['billing', Object.freeze({ available: false, enabled: false })],
  ])
  for (const extension of selected) {
    // Fastify's registration scope owns hooks / routes and handles plugin errors.
    // A broken imported module must fail startup, never masquerade as absent.
    await app.register(extension.routes)
    statuses.set(extension.id, Object.freeze({ available: true, enabled: extension.enabled ?? true }))
  }
  if (!statuses.get('billing')?.available) {
    const unavailable = async (_request: unknown, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) =>
      reply.code(404).send({ error: 'module_unavailable', module: 'billing' })
    app.all('/billing', unavailable)
    app.all('/billing/*', unavailable)
  }
  const response: ServerModulesResponse = Object.freeze({
    schemaVersion: 1,
    modules: Object.freeze(Object.fromEntries(statuses)),
  })
  const moduleStatus = async (_request: unknown, reply: { header: (name: string, value: string) => unknown }) => {
    reply.header('cache-control', 'no-store')
    return response
  }
  app.get('/public/modules', moduleStatus)
  app.get('/api/public/modules', moduleStatus)
  return response
}
