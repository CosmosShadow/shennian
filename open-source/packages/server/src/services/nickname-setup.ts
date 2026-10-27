// @arch open-source/docs/server-runtime.md
// @test src/__tests__/auth-nickname.test.ts
import crypto from 'node:crypto'
import { prisma } from '../lib/prisma.js'
import { redis } from '../lib/redis.js'
import { AuthRouteError, normalizeUserName, syncActiveHumanRoomMembershipAliases } from './auth-session.js'

function key(token: string) {
  return `nickname-setup:${crypto.createHash('sha256').update(token).digest('hex')}`
}

/** Only offered after identity verification. Never grants account or Room access. */
export async function offerScopedNicknameSetup(user: {
  id: string; name: string; nameSetupRequired?: boolean
}) {
  if (user.nameSetupRequired !== true) return undefined
  const token = crypto.randomBytes(32).toString('hex')
  try {
    await redis.set(key(token), user.id, 'EX', 15 * 60)
    return { name: user.name, token }
  } catch {
    // An optional prompt must not turn an already-completed login/join into failure.
    return undefined
  }
}

export async function completeScopedNicknameSetup(token: string, input: unknown) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new AuthRouteError(401, 'nickname_setup_expired')
  const userId = await redis.get(key(token))
  if (!userId) throw new AuthRouteError(401, 'nickname_setup_expired')
  const name = normalizeUserName(input)
  if (!name) throw new AuthRouteError(400, 'profile_name_required')
  // Concurrent saves, retries and older proofs cannot overwrite a chosen nickname.
  await prisma.user.updateMany({
    where: { id: userId, nameSetupRequired: true },
    data: { name, nameSetupRequired: false },
  })
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new AuthRouteError(401, 'nickname_setup_expired')
  await syncActiveHumanRoomMembershipAliases(user.id, user.name)
  // Keep the narrowly scoped proof until expiry so a lost response can be retried.
  return { name: user.name, nameSetupRequired: user.nameSetupRequired }
}
