// @arch open-source/docs/server-runtime.md
// @test src/__tests__/instance-auth.test.ts
import type { FastifyInstance } from 'fastify'
import { getDeploymentMode } from '../services/instance-settings.js'
import { localInstanceAuth, localRegistrationPolicy, throttleInstanceLogin } from '../services/instance-auth.js'
import { AuthRouteError } from '../services/auth-session.js'

export async function instanceRoutes(app: FastifyInstance) {
  app.get('/public/instance', async (_request, reply) => {
    reply.header('cache-control', 'no-store')
    const selfHosted = getDeploymentMode() === 'self-hosted'
    return {
      schemaVersion: 1, mode: selfHosted ? 'self-hosted' : 'official',
      instanceId: selfHosted ? process.env.SHENNIAN_INSTANCE_ID : 'shennian-cloud',
      name: (process.env.SHENNIAN_INSTANCE_NAME ?? 'Shennian').slice(0, 64),
      auth: { password: selfHosted, registration: selfHosted ? localRegistrationPolicy() : 'closed' },
    }
  })
  for (const register of [false, true]) {
    app.post<{ Body: import('../services/instance-auth.js').InstanceLogin }>(`/auth/local/${register ? 'register' : 'login'}`, {
      bodyLimit: 4096,
      schema: { body: { type: 'object', required: ['username', 'password'], additionalProperties: false,
        properties: Object.fromEntries(['username', 'password', 'name', 'invite', 'platform', 'deviceName', 'installationId'].map(key => [key, { type: 'string', maxLength: key === 'password' ? 256 : 191 }])) } },
    }, async (request, reply) => {
      reply.header('cache-control', 'no-store')
      try {
        await throttleInstanceLogin(request.socket.remoteAddress ?? 'unknown', request.body.username)
        return await localInstanceAuth(request.body, register)
      } catch (error) {
        if (error instanceof AuthRouteError) return reply.code(error.statusCode).send({ error: error.message })
        throw error
      }
    })
  }
}
