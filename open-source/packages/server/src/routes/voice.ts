// @arch open-source/docs/server-runtime.md
// @test src/__tests__/voice-routes.test.ts

import type { FastifyInstance } from 'fastify'
import { registerAuthDecorators, requireAuth } from '../middleware/auth.js'
import {
  createVoiceDraft,
  createVoiceDraftFromText,
  finalizeVoiceDraftFromTranscript,
  refineVoiceTranscriptSegment,
} from '../services/voice.js'

function mapVoiceError(
  reply: { code: (statusCode: number) => { send: (payload: { error: string }) => unknown } },
  error: Error,
) {
  if (error.message === 'Session not found') {
    return reply.code(404).send({ error: error.message })
  }
  if (error.message === 'Not authorized') {
    return reply.code(403).send({ error: error.message })
  }
  if (error.message === 'LLM service not configured') {
    return reply.code(503).send({ error: error.message })
  }
  throw error
}

export async function voiceRoutes(app: FastifyInstance) {
  registerAuthDecorators(app)

  app.post<{
    Body: {
      sessionId: string
      currentDraft?: string
      transcript: string
      cleanup?: boolean
    }
  }>('/finalize-text', { preHandler: requireAuth }, async (request, reply) => {
    const { sessionId, currentDraft, transcript, cleanup } = request.body
    if (!sessionId || !transcript) {
      return reply.code(400).send({ error: 'sessionId and transcript are required' })
    }

    try {
      if (cleanup !== false) {
        return await createVoiceDraftFromText({
          userId: request.userId,
          sessionId,
          currentDraft,
          transcript,
        })
      }
      return await finalizeVoiceDraftFromTranscript({
        userId: request.userId,
        sessionId,
        currentDraft,
        transcript,
      })
    } catch (error) {
      return mapVoiceError(reply, error as Error)
    }
  })

  app.post<{
    Body: {
      sessionId: string
      currentDraft?: string
      transcript: string
    }
  }>('/refine-text', { preHandler: requireAuth }, async (request, reply) => {
    const { sessionId, currentDraft, transcript } = request.body
    if (!sessionId || !transcript) {
      return reply.code(400).send({ error: 'sessionId and transcript are required' })
    }

    try {
      return await createVoiceDraftFromText({
        userId: request.userId,
        sessionId,
        currentDraft,
        transcript,
      })
    } catch (error) {
      return mapVoiceError(reply, error as Error)
    }
  })

  app.post<{
    Body: {
      sessionId: string
      transcript: string
      currentTranscript?: string
    }
  }>('/refine-segment', { preHandler: requireAuth }, async (request, reply) => {
    const { sessionId, transcript, currentTranscript } = request.body
    if (!sessionId || !transcript) {
      return reply.code(400).send({ error: 'sessionId and transcript are required' })
    }

    try {
      return await refineVoiceTranscriptSegment({
        userId: request.userId,
        sessionId,
        transcript,
        currentTranscript,
      })
    } catch (error) {
      return mapVoiceError(reply, error as Error)
    }
  })

  app.post<{
    Body: {
      sessionId: string
      currentDraft?: string
      audioBase64: string
      audioMimeType?: string
    }
  }>('/draft', { preHandler: requireAuth }, async (request, reply) => {
    const { sessionId, currentDraft, audioBase64, audioMimeType } = request.body
    if (!sessionId || !audioBase64) {
      return reply.code(400).send({ error: 'sessionId and audioBase64 are required' })
    }

    try {
      return await createVoiceDraft({
        userId: request.userId,
        sessionId,
        currentDraft,
        audioBase64,
        audioMimeType,
      })
    } catch (error) {
      return mapVoiceError(reply, error as Error)
    }
  })
}
