// @arch open-source/docs/server-runtime.md
// @test src/__tests__/login-intent-qr.test.ts
import { randomBytes, createHash } from 'node:crypto'
import { redis } from '../lib/redis.js'
import { prisma } from '../lib/prisma.js'
import { approveLoginIntent, getPublicLoginIntent, LoginIntentError } from './login-intents.js'

const key = (token: string) => `pair-intent:${createHash('sha256').update(token).digest('hex')}`

export async function createLoginIntentQr(id: string) {
  const intent = await getPublicLoginIntent(id)
  if (intent.expired) throw new LoginIntentError('login_intent_expired', 410, 'Pairing request expired.')
  const token = `auth-${randomBytes(32).toString('base64url')}`
  const ttl = Math.max(1, Math.ceil((new Date(intent.expiresAt).getTime() - Date.now()) / 1000))
  await redis.set(key(token), id, 'EX', ttl)
  return { token, expiresAt: intent.expiresAt }
}

async function resolveIntent(token: unknown): Promise<string> {
  if (typeof token !== 'string' || !/^auth-[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new LoginIntentError('invalid_pair_qr', 400, 'Invalid pairing QR code.')
  }
  const id = await redis.get(key(token))
  if (!id) throw new LoginIntentError('login_intent_expired', 410, 'Pairing QR code expired.')
  return id
}

/** The existing mobile pair scanner supplies fresh, explicit scan authorization. */
export async function approveLoginIntentQr(token: string, userId: string) {
  const id = await resolveIntent(token)
  await approveLoginIntent(id, userId)
  return { ok: true }
}

export async function getLoginIntentQrStatus(id: string, token: unknown) {
  if (await resolveIntent(token) !== id) {
    throw new LoginIntentError('invalid_pair_qr', 400, 'QR code belongs to a different request.')
  }
  const intent = await prisma.loginIntent.findUnique({ where: { id }, select: { status: true, expiresAt: true } })
  if (!intent) throw new LoginIntentError('login_intent_not_found', 404, 'Pairing request not found.')
  const approved = ['approved', 'claiming', 'claimed'].includes(intent.status)
  return { status: approved ? 'approved' : intent.expiresAt <= new Date() ? 'expired' : intent.status }
}
