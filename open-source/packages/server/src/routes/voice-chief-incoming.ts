// @arch open-source/docs/server-runtime.md docs/features/voice-shennian.md
// @test src/__tests__/voice-incoming-call.test.ts src/__tests__/voice-chief-preferences.test.ts

import type { FastifyInstance } from 'fastify'
import { registerAuthDecorators, requireAuth } from '../middleware/auth.js'
import { enqueueVoiceIncomingCallIntent } from '../services/voice-incoming-call-intent.js'
import {
  getVoiceChiefPreferences,
  updateVoiceChiefPreferences,
  VoiceChiefPreferenceError,
} from '../services/voice-chief-preferences.js'

function sendVoiceChiefPreferenceError(
  reply: { code: (statusCode: number) => { send: (payload: { error: string }) => unknown } },
  error: unknown,
) {
  if (error instanceof VoiceChiefPreferenceError) {
    return reply.code(error.statusCode).send({ error: error.message })
  }
  throw error
}

export async function voiceChiefIncomingRoutes(app: FastifyInstance) {
  registerAuthDecorators(app)

  app.get('/preferences', { preHandler: requireAuth }, async (request) => {
    return getVoiceChiefPreferences(request.userId)
  })

  app.patch<{
    Body: {
      voice?: string
    }
  }>('/preferences', { preHandler: requireAuth }, async (request, reply) => {
    try {
      return await updateVoiceChiefPreferences(request.userId, { voice: request.body?.voice })
    } catch (error) {
      return sendVoiceChiefPreferenceError(reply, error)
    }
  })

  app.post<{
    Body: {
      reason?: string
      initialPrompt?: string
      projectHint?: string
      targetPlatform?: 'ios' | 'android'
    }
  }>('/incoming-calls', { preHandler: requireAuth }, async (request, reply) => {
    const result = await enqueueVoiceIncomingCallIntent({
      userId: request.userId,
      reason: request.body?.reason,
      initialPrompt: request.body?.initialPrompt,
      projectHint: request.body?.projectHint,
      targetPlatform: request.body?.targetPlatform,
    })

    return reply.code(202).send(result)
  })
}
