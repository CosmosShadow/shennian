// @arch open-source/docs/server-runtime.md
// @test src/__tests__/device-management.test.ts src/__tests__/user-account-delete.test.ts

import type { FastifyInstance } from 'fastify'
import { getDeploymentMode } from '../services/instance-settings.js'
import { completeScopedNicknameSetup } from '../services/nickname-setup.js'
import { registerAuthDecorators, requireAuth } from '../middleware/auth.js'
import {
  AuthRouteError,
  buildPublicAuthConfig,
  confirmQrLogin,
  createQrLoginSession,
  getClientIp,
  getCurrentUser,
  getQrLoginStatus,
  issueDebugPhoneLoginCode,
  loginWithApple,
  listDevices,
  loginWithGoogle,
  refreshDeviceSession,
  revokeCurrentDevice,
  revokeDevice,
  sendPhoneLoginCode,
  updateCurrentUserProfile,
  verifyPhoneLogin,
} from '../services/auth-session.js'
import { deleteUserAccount, isAccountDeletionComplete } from '../services/user-account-delete.js'
import { removeUserAvatar, updateUserAvatar, UserAvatarError } from '../services/user-avatar.js'
import { broadcastRoomIdentityUpdated } from '../services/room-events.js'

function sendAuthError(
  reply: { code: (statusCode: number) => { send: (payload: { error: string }) => unknown } },
  error: unknown,
) {
  if (error instanceof AuthRouteError) {
    return reply.code(error.statusCode).send({ error: error.message })
  }
  throw error
}

export async function authRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    if (getDeploymentMode() === 'self-hosted' && /\/(?:send-code|verify-code|test-login\/code|google|apple|qr(?:\/.*)?)$/.test(request.routeOptions.url ?? '')) {
      return reply.code(404).send({ error: 'provider_unavailable' })
    }
  })
  registerAuthDecorators(app)
  app.addContentTypeParser(
    ['image/jpeg', 'image/png', 'image/webp'],
    { parseAs: 'buffer', bodyLimit: 5 * 1024 * 1024 },
    (_request, body, done) => done(null, body),
  )

  app.get('/public-config', async () => buildPublicAuthConfig())

  app.patch<{ Body: { token: string; name: string } }>('/nickname-setup', {
    schema: { body: {
      type: 'object', required: ['token', 'name'], additionalProperties: false,
      properties: {
        token: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        name: { type: 'string', minLength: 1, maxLength: 40 },
      },
    } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    try {
      return await completeScopedNicknameSetup(request.body.token, request.body.name)
    } catch (error) {
      return sendAuthError(reply, error)
    }
  })

  app.get('/me', { preHandler: requireAuth }, async (request) => getCurrentUser(request.userId))

  app.patch<{
    Body: { name?: string; pushPreviewEnabled?: boolean }
  }>('/me', { preHandler: requireAuth }, async (request, reply) => {
    try {
      return await updateCurrentUserProfile(request.userId, {
        name: request.body?.name,
        pushPreviewEnabled: request.body?.pushPreviewEnabled,
      })
    } catch (error) {
      return sendAuthError(reply, error)
    }
  })

  app.put<{ Body: Buffer }>('/me/avatar', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const result = await updateUserAvatar({
        userId: request.userId,
        contentType: request.headers['content-type'],
        buffer: request.body,
      })
      await broadcastRoomIdentityUpdated({ ownerUserId: request.userId })
      return { avatar: result.avatar }
    } catch (error) {
      if (!(error instanceof UserAvatarError)) throw error
      return reply.code(error.statusCode).send({ error: error.code })
    }
  })

  app.delete('/me/avatar', { preHandler: requireAuth }, async (request) => {
    await removeUserAvatar(request.userId)
    await broadcastRoomIdentityUpdated({ ownerUserId: request.userId })
    return { avatar: null }
  })

  app.post<{
    Body: { phone: string; ticket?: string; randstr?: string }
  }>('/send-code', async (request, reply) => {
    try {
      return await sendPhoneLoginCode({
        phone: request.body.phone,
        ticket: request.body.ticket,
        randstr: request.body.randstr,
        ip: getClientIp(request),
      })
    } catch (error) {
      return sendAuthError(reply, error)
    }
  })

  app.post<{
    Body: { phone: string }
  }>('/test-login/code', async (request, reply) => {
    try {
      return await issueDebugPhoneLoginCode({
        phone: request.body.phone,
        // Never trust X-Forwarded-For for this production-only internal gate.
        remoteAddress: request.socket.remoteAddress ?? '',
      })
    } catch (error) {
      return sendAuthError(reply, error)
    }
  })

  app.post<{
    Body: {
      phone: string
      code: string
      platform?: string
      deviceName?: string
      installationId?: string
      inviteCode?: string
      name?: string
    }
  }>('/verify-code', async (request, reply) => {
    try {
      return await verifyPhoneLogin(request.body)
    } catch (error) {
      return sendAuthError(reply, error)
    }
  })

  app.post<{
    Body: {
      idToken: string
      platform?: string
      deviceName?: string
      installationId?: string
      inviteCode?: string
    }
  }>('/google', async (request, reply) => {
    try {
      return await loginWithGoogle(request.body)
    } catch (error) {
      return sendAuthError(reply, error)
    }
  })

  app.post<{
    Body: {
      identityToken: string
      nonce?: string
      fullName?: string
      email?: string
      platform?: string
      deviceName?: string
      installationId?: string
      inviteCode?: string
    }
  }>('/apple', async (request, reply) => {
    try {
      return await loginWithApple(request.body)
    } catch (error) {
      return sendAuthError(reply, error)
    }
  })

  app.post<{
    Body: { refreshToken: string; platform?: string; deviceName?: string; installationId?: string }
  }>('/refresh', async (request, reply) => {
    try {
      return await refreshDeviceSession(request.body)
    } catch (error) {
      return sendAuthError(reply, error)
    }
  })

  app.get('/devices', { preHandler: requireAuth }, async (request) => {
    return listDevices(request.userId, request.deviceId)
  })

  app.delete('/devices/me', { preHandler: requireAuth }, async (request) => {
    await revokeCurrentDevice(request.deviceId)
    return {}
  })

  app.delete<{ Body: { operationId?: string } }>(
    '/account',
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        await deleteUserAccount(request.userId, request.body?.operationId ?? '')
        return { ok: true }
      } catch (error) {
        return sendAuthError(reply, error)
      }
    },
  )

  app.post<{ Body: { operationId?: string } }>('/account-deletion/status', async (request) => ({
    completed: await isAccountDeletionComplete(request.body?.operationId ?? ''),
  }))

  app.delete<{ Params: { id: string } }>(
    '/devices/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        await revokeDevice({
          id: request.params.id,
          userId: request.userId,
          currentDeviceId: request.deviceId,
        })
        return {}
      } catch (error) {
        return sendAuthError(reply, error)
      }
    },
  )

  app.post<{ Body: { installationId?: string; platform: string; deviceName: string } }>('/qr/create', async (request) =>
    createQrLoginSession(request.body ?? {}),
  )

  app.post<{ Body: { qrToken: string } }>(
    '/qr/confirm',
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        await confirmQrLogin({ qrToken: request.body.qrToken, userId: request.userId })
        return {}
      } catch (error) {
        return sendAuthError(reply, error)
      }
    },
  )

  app.get<{ Params: { qrToken: string } }>('/qr/status/:qrToken', async (request, reply) => {
    try {
      return await getQrLoginStatus(request.params.qrToken)
    } catch (error) {
      return sendAuthError(reply, error)
    }
  })
}
