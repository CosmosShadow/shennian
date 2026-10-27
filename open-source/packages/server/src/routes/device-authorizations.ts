// @arch open-source/docs/server-runtime.md
// @test src/__tests__/login-intent-routes.test.ts

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { registerAuthDecorators, requireAuth } from '../middleware/auth.js'
import {
  approveLoginIntent,
  cancelLoginIntent,
  claimLoginIntent,
  createLoginIntent,
  denyLoginIntent,
  getLoginIntentApproval,
  getPrivateLoginIntentStatus,
  getPublicLoginIntent,
  LoginIntentError,
} from '../services/login-intents.js'
import { createLoginIntentQr, getLoginIntentQrStatus } from '../services/login-intent-qr.js'
import { AuthRouteError, verifyPhoneIdentity } from '../services/auth-session.js'
import { offerScopedNicknameSetup } from '../services/nickname-setup.js'
import { requireNonReviewMachineAccess } from '../services/review-account-policy.js'

type CreateBody = {
  deviceSecretHash?: unknown
  daemonInstallationId?: unknown
  machineName?: unknown
  machineOs?: unknown
  agentList?: unknown
  actionType?: unknown
  actionSummary?: unknown
  actionPayloadHash?: unknown
  returnTo?: unknown
}

function sendError(reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }, error: unknown) {
  if (error instanceof LoginIntentError) {
    return reply.code(error.statusCode).send({ error: error.code, message: error.message })
  }
  throw error
}

function deviceSecret(request: FastifyRequest): unknown {
  return request.headers['x-shennian-device-secret']
}

function requestOrigin(request: FastifyRequest): string {
  const configured = (process.env.WEB_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL)?.trim().replace(/\/+$/, '')
  if (configured) return configured
  if (process.env.NODE_ENV === 'production') return 'https://shennian.net'
  const hostname = request.hostname.includes(':') ? `[${request.hostname}]` : request.hostname
  return `http://${hostname}:8081`
}

export async function deviceAuthorizationRoutes(app: FastifyInstance) {
  registerAuthDecorators(app)

  app.post<{ Body: CreateBody }>('/', async (request, reply) => {
    try {
      const intent = await createLoginIntent(request.body ?? {})
      return reply.code(201).send({
        loginIntentId: intent.id,
        publicLoginUrl: `${requestOrigin(request)}/authorize/${encodeURIComponent(intent.id)}`,
        expiresAt: intent.expiresAt,
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post<{ Params: { id: string } }>('/:id/qr', async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    try { return await createLoginIntentQr(request.params.id) }
    catch (error) { return sendError(reply, error) }
  })

  app.post<{ Params: { id: string }; Body: { token?: unknown } }>(
    '/:id/qr-status', async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      try { return await getLoginIntentQrStatus(request.params.id, request.body?.token) }
      catch (error) { return sendError(reply, error) }
    },
  )

  // Fresh phone proof authorizes only this intent; ambient browser credentials
  // are deliberately ignored and no browser Device session is issued.
  app.post<{ Params: { id: string }; Body: { phone: string; code: string; name?: string } }>(
    '/:id/verify-phone',
    {
      schema: {
        body: {
          type: 'object', required: ['phone', 'code'], additionalProperties: false,
          properties: {
            phone: { type: 'string', pattern: '^\\+861[0-9]{10}$' },
            code: { type: 'string', pattern: '^[0-9]{6}$' },
            name: { type: 'string', minLength: 1, maxLength: 40 },
          },
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      try {
        const intent = await getPublicLoginIntent(request.params.id)
        if (intent.expired) {
          throw new LoginIntentError('login_intent_expired', 410, 'Authorization request expired.')
        }
        const user = await verifyPhoneIdentity(request.body)
        await approveLoginIntent(request.params.id, user.id)
        return { status: 'approved', nicknameSetup: await offerScopedNicknameSetup(user) }
      } catch (error) {
        if (error instanceof AuthRouteError) {
          return reply.code(error.statusCode).send({ error: error.message })
        }
        return sendError(reply, error)
      }
    },
  )

  app.get<{ Params: { id: string } }>('/:id/public', async (request, reply) => {
    try {
      return await getPublicLoginIntent(request.params.id)
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get<{ Params: { id: string } }>(
    '/:id/approval',
    { preHandler: [requireAuth, requireNonReviewMachineAccess] },
    async (request, reply) => {
      try {
        return await getLoginIntentApproval(request.params.id, request.userId)
      } catch (error) {
        return sendError(reply, error)
      }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/:id/approve',
    { preHandler: [requireAuth, requireNonReviewMachineAccess] },
    async (request, reply) => {
      try {
        return await approveLoginIntent(request.params.id, request.userId)
      } catch (error) {
        return sendError(reply, error)
      }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/:id/deny',
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        return await denyLoginIntent(request.params.id, request.userId)
      } catch (error) {
        return sendError(reply, error)
      }
    },
  )

  app.get<{ Params: { id: string } }>('/:id/status', async (request, reply) => {
    try {
      return await getPrivateLoginIntentStatus(request.params.id, deviceSecret(request))
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post<{ Params: { id: string } }>('/:id/claim', async (request, reply) => {
    try {
      return await claimLoginIntent(request.params.id, deviceSecret(request))
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post<{ Params: { id: string } }>('/:id/cancel', async (request, reply) => {
    try {
      return await cancelLoginIntent(request.params.id, deviceSecret(request))
    } catch (error) {
      return sendError(reply, error)
    }
  })
}
