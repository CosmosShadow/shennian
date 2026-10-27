// @arch open-source/docs/server-runtime.md
// @test src/__tests__/instance-auth.test.ts
import { randomBytes, scrypt as derive, timingSafeEqual, createHash } from 'node:crypto'
import { prisma } from '../lib/prisma.js'
import { redis } from '../lib/redis.js'
import { AuthRouteError, issueDeviceSession } from './auth-session.js'
import { getDeploymentMode } from './instance-settings.js'
const cost = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
let activeKdfs = 0
async function scrypt(password: string, salt: string): Promise<Buffer> {
  if (activeKdfs >= 2) throw new AuthRouteError(503, 'authentication_busy')
  activeKdfs++
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      derive(password, salt, 64, cost, (error, hash) => error ? reject(error) : resolve(hash))
    })
  } finally { activeKdfs-- }
}

export function localRegistrationPolicy(): 'closed' | 'invite' | 'open' {
  const policy = process.env.SHENNIAN_REGISTRATION_POLICY ?? 'invite'
  if (!['closed', 'invite', 'open'].includes(policy)) throw new Error('invalid_registration_policy')
  return policy as 'closed' | 'invite' | 'open'
}
function requireSelfHosted() {
  if (getDeploymentMode() !== 'self-hosted') throw new AuthRouteError(404, 'Not found')
}
export async function hashInstancePassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const hash = await scrypt(password, salt) as Buffer
  return `scrypt-v1:${salt}:${hash.toString('hex')}`
}
export async function verifyInstancePassword(password: string, stored: string): Promise<boolean> {
  const [version, salt, hash] = stored.split(':')
  if (version !== 'scrypt-v1' || !/^[a-f0-9]{32}$/.test(salt ?? '') || !/^[a-f0-9]{128}$/.test(hash ?? '')) return false
  const actual = await scrypt(password, salt!) as Buffer
  return timingSafeEqual(actual, Buffer.from(hash!, 'hex'))
}
export type InstanceLogin = {
  username: string; password: string; name?: string; invite?: string
  platform?: string; deviceName?: string; installationId?: string
}
function validate(input: InstanceLogin) {
  const username = input.username.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username) || input.password.length < 12 || input.password.length > 256) {
    throw new AuthRouteError(400, 'invalid_local_credentials')
  }
  if (input.name && input.name.length > 40) throw new AuthRouteError(400, 'invalid_name')
  if (input.platform === 'web') throw new AuthRouteError(403, 'Web device login retired')
  return username
}
export async function throttleInstanceLogin(ip: string, username: string) {
  requireSelfHosted()
  const hash = (value: string) => createHash('sha256').update(value).digest('hex')
  for (const [key, limit] of [[`instance-auth:ip:${hash(ip)}`, 40], [`instance-auth:account:${hash(username.trim().toLowerCase())}`, 10]] as const) {
    // Atomic expiry: failed requests cannot leave a permanent lockout counter.
    const count = await redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n", 1, key)
    if (Number(count) > limit) throw new AuthRouteError(429, 'too_many_attempts')
  }
}
export async function localInstanceAuth(input: InstanceLogin, register = false) {
  requireSelfHosted()
  const username = validate(input)
  let userId: string
  if (register) {
    const policy = localRegistrationPolicy()
    if (policy === 'closed') throw new AuthRouteError(403, 'registration_closed')
    if (policy === 'invite') {
      const expected = process.env.SHENNIAN_REGISTRATION_INVITE ?? ''
      const actual = input.invite ?? ''
      const digest = (value: string) => createHash('sha256').update(value).digest()
      if (expected.length < 24 || !timingSafeEqual(digest(actual), digest(expected))) throw new AuthRouteError(403, 'invalid_invite')
    }
    const passwordHash = await hashInstancePassword(input.password)
    try {
      const row = await prisma.instanceAccount.create({ data: {
        username, passwordHash,
        user: { create: { name: input.name?.trim() || username } },
      }, select: { userId: true } })
      userId = row.userId
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new AuthRouteError(409, 'account_already_exists')
      throw error
    }
  } else {
    const account = await prisma.instanceAccount.findUnique({ where: { username } })
    // Same KDF work for unknown accounts to avoid a fast existence oracle.
    const stored = account?.passwordHash ?? `scrypt-v1:${'0'.repeat(32)}:${'0'.repeat(128)}`
    const valid = await verifyInstancePassword(input.password, stored)
    if (!account || !valid) throw new AuthRouteError(401, 'invalid_local_credentials')
    userId = account.userId
  }
  const { deviceId: _deviceId, ...session } = await issueDeviceSession(userId, input.platform, input.deviceName, input.installationId)
  return session
}
