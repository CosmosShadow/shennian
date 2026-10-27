// @arch open-source/docs/server-runtime.md
// @test open-source/packages/server/src/__tests__/ota-updates.test.ts

import type { FastifyPluginAsync } from 'fastify'
import { getOtaUpdate, type OtaChannel, type OtaPlatform } from '../services/ota-update.js'

function header(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

export const otaUpdateRoutes: FastifyPluginAsync = async (app) => {
  for (const path of ['/updates', '/api/updates']) {
    app.get(path, async (request, reply) => {
      const protocol = header(request.headers['expo-protocol-version'])
      const platform = header(request.headers['expo-platform'])
      const runtimeVersion = header(request.headers['expo-runtime-version'])
      const requestedChannel = header(request.headers['expo-channel-name']) || 'production'
      if (protocol !== '1') return reply.code(406).send({ error: 'Expo Updates Protocol v1 required' })
      if (platform !== 'ios' && platform !== 'android') return reply.code(400).send({ error: 'Invalid expo-platform' })
      if (requestedChannel !== 'production' && requestedChannel !== 'preview') {
        return reply.code(400).send({ error: 'Invalid expo-channel-name' })
      }
      const update = await getOtaUpdate({
        channel: requestedChannel as OtaChannel,
        platform: platform as OtaPlatform,
        runtimeVersion,
      })
      if (!update) return reply.code(204).send()
      const expectsSignature = Boolean(request.headers['expo-expect-signature'])
      if (expectsSignature && !update.signature) {
        return reply.code(404).send({ error: 'No signed update available' })
      }
      reply.header('expo-protocol-version', '1')
      reply.header('expo-sfv-version', '0')
      reply.header('Cache-Control', 'private, max-age=0')
      reply.header('Content-Type', 'application/expo+json')
      if (update.signature) reply.header('expo-signature', update.signature)
      return reply.send(update.manifestBody)
    })
  }
}
