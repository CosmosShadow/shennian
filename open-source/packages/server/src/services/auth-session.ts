// @arch open-source/docs/server-runtime.md
// @test src/__tests__/device-management.test.ts

import crypto from 'node:crypto'
import { getDeploymentMode } from './instance-settings.js'
import type { FastifyRequest } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { redis } from '../lib/redis.js'
import { publishDeviceRevoked } from '../relay/connection-control.js'
import { parseAppleBundleId, verifyAppleIdentityToken } from './apple-oauth.js'
import { verifyTencentCaptcha } from './captcha.js'
import { parseGoogleClientIds, verifyGoogleIdToken } from './google-oauth.js'
import { signToken } from './jwt.js'
import { sendSmsCode } from './sms.js'
import { publicEntitledUser } from './entitlements.js'
import { grantInitialProTrial } from './plan-access.js'
import { isReviewAccountPhone } from './review-account-policy.js'
import type { PublicUserAvatar } from './user-avatar.js'

const MAX_DEVICES_PER_USER = 50
const MAX_USER_NAME_LENGTH = 40
const MAX_INSTALLATION_ID_LENGTH = 191
const MAX_DEVICE_NAME_LENGTH = 120
const QR_TARGET_PLATFORMS = new Set(['desktop'])
const E164_REGEX = /^\+[1-9]\d{6,14}$/
function debugLoginPhone(): string | undefined {
  const phone = process.env.SHENNIAN_TEST_LOGIN_PHONE?.trim()
  return phone && E164_REGEX.test(phone) ? phone : undefined
}
const PHONE_CODE_TTL_SECONDS = 300
const DEBUG_CODE_GENERATION_ATTEMPTS = 8
const CONSUME_PHONE_CODE_SCRIPT = `
local actual = redis.call('GET', KEYS[1])
if actual and actual == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
`

export class AuthRouteError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'AuthRouteError'
  }
}

type PublicUser = {
  id: string
  phone: string
  email: string | null
  name: string
  nameSetupRequired: boolean
  avatar: PublicUserAvatar | null
  /** @deprecated Compatibility response for mobile clients that still render the retired switch. */
  pushPreviewEnabled: boolean
  accountTier: 'personal' | 'free' | 'pro' | 'enterprise'
  entitlements: ReturnType<typeof publicEntitledUser>['entitlements']
}

type IssuedDeviceSession = {
  deviceId: string
  token: string
  refreshToken: string
  user: PublicUser
}

type UserRow = {
  id: string
  phone: string | null
  email: string | null
  name: string
  nameSetupRequired?: boolean
  avatarVersion?: string | null
  avatarUpdatedAt?: Date | null
  accountTier?: string | null
  entitlementFlags?: unknown
}

function publicUser(user: UserRow): PublicUser {
  return publicEntitledUser(user)
}

async function ensureUserNickname(user: UserRow): Promise<UserRow> {
  if (user.name.trim()) return user
  await prisma.user.updateMany({
    where: { id: user.id, name: user.name },
    data: { name: defaultNickname(), nameSetupRequired: true },
  })
  return prisma.user.findUniqueOrThrow({ where: { id: user.id } })
}

function defaultNickname(): string {
  return `用户${crypto.randomBytes(5).toString('hex').toUpperCase()}`
}

function randomCode(): string {
  return String(crypto.randomInt(100000, 999999))
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeInstallationId(value: unknown): string | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string') {
    throw new AuthRouteError(400, 'installationId must be a string')
  }
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_INSTALLATION_ID_LENGTH) {
    throw new AuthRouteError(400, 'Invalid installationId')
  }
  return normalized
}

function normalizeQrTargetPlatform(value: unknown): string {
  if (typeof value !== 'string' || !QR_TARGET_PLATFORMS.has(value)) {
    throw new AuthRouteError(400, 'Invalid QR target platform')
  }
  return value
}

function normalizeQrTargetDeviceName(value: unknown): string {
  if (typeof value !== 'string') throw new AuthRouteError(400, 'deviceName must be a string')
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized || normalized.length > MAX_DEVICE_NAME_LENGTH) {
    throw new AuthRouteError(400, 'Invalid deviceName')
  }
  return normalized
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}

export function normalizeUserName(value: unknown): string {
  if (value == null) return ''
  if (typeof value !== 'string') {
    throw new AuthRouteError(400, 'name must be a string')
  }
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length > MAX_USER_NAME_LENGTH) {
    throw new AuthRouteError(400, `name must be ${MAX_USER_NAME_LENGTH} characters or fewer`)
  }
  return normalized
}

function readBooleanEnv(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function isLocalDebugIp(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost'
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err: unknown) {
      const isRetryable =
        typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2034'
      if (!isRetryable || attempt === maxRetries - 1) throw err
      await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt))
    }
  }
  throw new Error('unreachable')
}

/** When device count reaches MAX_DEVICES_PER_USER, evict the oldest ones. */
async function evictOldDevices(userId: string): Promise<void> {
  const count = await prisma.device.count({ where: { userId } })
  if (count < MAX_DEVICES_PER_USER) return

  const toEvict = await prisma.device.findMany({
    where: { userId },
    orderBy: { lastActiveAt: 'asc' },
    take: count - MAX_DEVICES_PER_USER + 1,
    select: { id: true },
  })

  await prisma.device.deleteMany({
    where: { id: { in: toEvict.map((device) => device.id) } },
  })
  for (const device of toEvict) publishDeviceRevoked(device.id)
}

export async function issueDeviceSession(
  userId: string,
  platform?: string,
  deviceName?: string,
  installationIdInput?: unknown,
): Promise<IssuedDeviceSession> {
  if (platform === 'web') throw new AuthRouteError(403, 'Web device login retired')
  const user = await ensureUserNickname(await prisma.user.findUniqueOrThrow({ where: { id: userId } }))
  const installationId = normalizeInstallationId(installationIdInput)
  const now = new Date()
  const tokenExpiry = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  const refreshExpiry = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)

  if (installationId) {
    const existing = await prisma.device.findUnique({
      where: { userId_installationId: { userId, installationId } },
    })
    if (existing) {
      const accessToken = signToken({ userId, deviceId: existing.id })
      await prisma.device.update({
        where: { id: existing.id },
        data: {
          platform: platform ?? existing.platform,
          name: deviceName ?? existing.name,
          accessToken,
          tokenExpiry,
          refreshExpiry,
          lastActiveAt: now,
        },
      })
      return {
        deviceId: existing.id,
        token: accessToken,
        refreshToken: existing.refreshToken,
        user: publicUser(user),
      }
    }
  }

  await evictOldDevices(userId)
  const refreshToken = crypto.randomBytes(64).toString('hex')

  let accessToken: string
  let issuedDeviceId = ''
  try {
    accessToken = await withRetry(async () => {
      const device = await prisma.device.create({
        data: {
          userId,
          installationId,
          platform: platform ?? 'unknown',
          name: deviceName ?? '',
          accessToken: `pending:${crypto.randomUUID()}`,
          refreshToken,
          tokenExpiry,
          refreshExpiry,
        },
      })
      issuedDeviceId = device.id

      const token = signToken({ userId, deviceId: device.id })
      await prisma.device.update({
        where: { id: device.id },
        data: { accessToken: token },
      })

      return token
    })
  } catch (error) {
    if (!installationId || !isUniqueConflict(error)) throw error
    const concurrent = await prisma.device.findUnique({
      where: { userId_installationId: { userId, installationId } },
    })
    if (!concurrent) throw error
    accessToken = signToken({ userId, deviceId: concurrent.id })
    await prisma.device.update({
      where: { id: concurrent.id },
      data: {
        platform: platform ?? concurrent.platform,
        name: deviceName ?? concurrent.name,
        accessToken,
        tokenExpiry,
        refreshExpiry,
        lastActiveAt: now,
      },
    })
    return {
      deviceId: concurrent.id,
      token: accessToken,
      refreshToken: concurrent.refreshToken,
      user: publicUser(user),
    }
  }

  return {
    deviceId: issuedDeviceId,
    token: accessToken,
    refreshToken,
    user: publicUser(user),
  }
}

function publicSession(session: IssuedDeviceSession) {
  const { deviceId: _deviceId, ...result } = session
  return result
}

export function getClientIp(request: FastifyRequest): string {
  const xf = request.headers['x-forwarded-for']
  if (typeof xf === 'string') return xf.split(',')[0]!.trim()
  if (Array.isArray(xf)) return xf[0]!.trim()
  return request.socket?.remoteAddress ?? '127.0.0.1'
}

export function buildPublicAuthConfig() {
  const isCN = process.env.SERVER_REGION === 'cn' || getDeploymentMode() === 'self-hosted'
  return {
    tencentCaptchaAppId: process.env.TENCENT_CAPTCHA_APP_ID?.trim() || null,
    googleWebClientId: isCN ? null : process.env.GOOGLE_OAUTH_WEB_CLIENT_ID?.trim() || null,
    googleIosClientId: isCN ? null : process.env.GOOGLE_OAUTH_IOS_CLIENT_ID?.trim() || null,
    googleAndroidClientId: isCN ? null : process.env.GOOGLE_OAUTH_ANDROID_CLIENT_ID?.trim() || null,
    appleEnabled: getDeploymentMode() !== 'self-hosted' && readBooleanEnv(process.env.APPLE_SIGN_IN_ENABLED),
    appleServiceId: process.env.APPLE_SIGN_IN_SERVICE_ID?.trim() || null,
    appleBundleId: process.env.APPLE_SIGN_IN_BUNDLE_ID?.trim() || null,
  }
}

function reviewLoginCode(): string | undefined {
  const code = process.env.SHENNIAN_REVIEW_LOGIN_CODE?.trim()
  return code && /^\d{6}$/.test(code) ? code : undefined
}

export async function sendPhoneLoginCode(params: {
  phone: string
  ticket?: string
  randstr?: string
  ip: string
}): Promise<{ code?: string }> {
  if (getDeploymentMode() === 'self-hosted') throw new AuthRouteError(404, 'provider_unavailable')
  if (!params.phone || !E164_REGEX.test(params.phone)) {
    throw new AuthRouteError(400, 'Invalid phone number (E.164)')
  }

  // App Store review test account — skip captcha, rate limit, and real SMS
  const reviewCode = reviewLoginCode()
  if (isReviewAccountPhone(params.phone) && reviewCode) {
    const codeKey = `sms:code:${params.phone}`
    await redis.set(codeKey, reviewCode, 'EX', 300)
    return {}
  }

  const captcha = await verifyTencentCaptcha(params.ticket, params.randstr, params.ip)
  if (!captcha.ok) {
    throw new AuthRouteError(400, captcha.message)
  }

  const limitKey = `sms:limit:${params.phone}`
  const exists = await redis.exists(limitKey)
  if (exists) {
    throw new AuthRouteError(429, 'Please wait 60s before resending')
  }

  const code = randomCode()
  const codeKey = `sms:code:${params.phone}`

  let result: { debug: boolean }
  try {
    result = await sendSmsCode(params.phone, code)
  } catch {
    throw new AuthRouteError(502, 'SMS service unavailable')
  }

  await redis.set(codeKey, code, 'EX', 300)
  await redis.set(limitKey, '1', 'EX', 60)

  return result.debug ? { code } : {}
}

export async function issueDebugPhoneLoginCode(params: {
  phone: string
  remoteAddress: string
}): Promise<{ phone: string; code: string; expiresInSeconds: number }> {
  const enabled = process.env.NODE_ENV !== 'production' || (
    readBooleanEnv(process.env.SHENNIAN_TEST_LOGIN_ENABLED) &&
    isLocalDebugIp(params.remoteAddress)
  )
  if (!enabled) {
    throw new AuthRouteError(404, 'Not found')
  }
  const phone = params.phone.startsWith('+') ? params.phone : `+86${params.phone}`
  if (phone !== debugLoginPhone()) {
    throw new AuthRouteError(403, 'Debug login is only available for the configured test phone')
  }
  // Debug/QA runs can overlap on the shared account. Keep each challenge in
  // its own one-time slot so another loopback-only issuance cannot invalidate
  // a code that is already being entered through the normal login surface.
  for (let attempt = 0; attempt < DEBUG_CODE_GENERATION_ATTEMPTS; attempt += 1) {
    const code = randomCode()
    const stored = await redis.set(
      debugPhoneCodeKey(phone, code),
      '1',
      'EX',
      PHONE_CODE_TTL_SECONDS,
      'NX',
    )
    if (stored === 'OK') return { phone, code, expiresInSeconds: PHONE_CODE_TTL_SECONDS }
  }
  throw new AuthRouteError(503, 'Debug login challenge unavailable')
}

export async function verifyPhoneLogin(params: {
  phone: string
  code: string
  name?: string
  platform?: string
  deviceName?: string
  installationId?: string
  inviteCode?: string
}) {
  const user = await verifyPhoneIdentity(params)
  return publicSession(
    await issueDeviceSession(user.id, params.platform, params.deviceName, params.installationId),
  )
}

/** Verifies a phone challenge without issuing an account-wide Device session. */
export async function verifyPhoneIdentity(params: {
  phone: string
  code: string
  name?: string
}, beforeConsume?: (userId: string | null) => Promise<void>) {
  if (getDeploymentMode() === 'self-hosted') throw new AuthRouteError(404, 'provider_unavailable')
  if (!params.phone || !params.code) {
    throw new AuthRouteError(400, 'phone and code are required')
  }

  const codeKey = `sms:code:${params.phone}`
  const isReviewTestLogin = isReviewAccountPhone(params.phone) && params.code === reviewLoginCode()
  const codeIsValid = isReviewTestLogin ||
    await checkPhoneCode(codeKey, params.code) ||
    await checkDebugPhoneCode(params.phone, params.code)
  if (!codeIsValid) {
    throw new AuthRouteError(400, 'Invalid or expired code')
  }

  let user = await prisma.user.findUnique({ where: { phone: params.phone } })
  // Scoped room login must check membership while the challenge is still usable.
  // A non-member can then follow an invitation without seeing a false "expired code" on retry.
  if (beforeConsume) await beforeConsume(user?.id ?? null)
  if (!user) {
    const name = normalizeUserName(params.name)
    if (!isReviewTestLogin && !await consumeVerifiedPhoneCode(params.phone, params.code)) {
      throw new AuthRouteError(400, 'Invalid or expired code')
    }
    user = await prisma.user.create({
      data: {
        phone: params.phone,
        name: name || defaultNickname(),
        nameSetupRequired: !name,
      },
    })
  } else if (!isReviewTestLogin && !await consumeVerifiedPhoneCode(params.phone, params.code)) {
    throw new AuthRouteError(400, 'Invalid or expired code')
  }
  // Idempotent for returning users, and also gives pre-existing phone accounts
  // the same one-time rollout trial as new signups.
  await grantInitialProTrial(user.id)

  return ensureUserNickname(user)
}

async function consumePhoneCode(key: string, expected: string): Promise<boolean> {
  const result = await redis.eval(CONSUME_PHONE_CODE_SCRIPT, 1, key, expected)
  return result === 1
}

async function checkPhoneCode(key: string, expected: string): Promise<boolean> {
  return await redis.get(key) === expected
}

async function consumeVerifiedPhoneCode(phone: string, code: string): Promise<boolean> {
  return await consumePhoneCode(`sms:code:${phone}`, code) || await consumeDebugPhoneCode(phone, code)
}

async function consumeDebugPhoneCode(phone: string, code: string): Promise<boolean> {
  if (phone !== debugLoginPhone() || !isDebugPhoneLoginEnabled()) return false
  return consumePhoneCode(debugPhoneCodeKey(phone, code), '1')
}

async function checkDebugPhoneCode(phone: string, code: string): Promise<boolean> {
  if (phone !== debugLoginPhone() || !isDebugPhoneLoginEnabled()) return false
  return checkPhoneCode(debugPhoneCodeKey(phone, code), '1')
}

function debugPhoneCodeKey(phone: string, code: string): string {
  const digest = crypto.createHash('sha256').update(code, 'utf8').digest('hex')
  return `sms:debug-code:${phone}:${digest}`
}

function isDebugPhoneLoginEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || readBooleanEnv(process.env.SHENNIAN_TEST_LOGIN_ENABLED)
}

export async function loginWithGoogle(params: {
  idToken: string
  platform?: string
  deviceName?: string
  installationId?: string
  inviteCode?: string
}) {
  if (getDeploymentMode() === 'self-hosted') throw new AuthRouteError(404, 'provider_unavailable')
  if (!params.idToken?.trim()) {
    throw new AuthRouteError(400, 'idToken is required')
  }

  const audiences = parseGoogleClientIds()
  if (audiences.length === 0) {
    throw new AuthRouteError(503, 'Google login is not configured on server')
  }

  let payload: Awaited<ReturnType<typeof verifyGoogleIdToken>>
  try {
    payload = await verifyGoogleIdToken(params.idToken, audiences)
  } catch {
    throw new AuthRouteError(401, 'Invalid Google credential')
  }

  const sub = payload.sub
  if (!sub) {
    throw new AuthRouteError(401, 'Invalid Google credential')
  }

  const email = normalizeOptionalString(payload.email)
  const name = normalizeOptionalString(payload.name) ?? ''

  let user = await prisma.user.findUnique({ where: { googleSub: sub } })
  if (!user) {
    throw new AuthRouteError(403, 'phone_login_required')
  } else {
    const data: { email?: string; name?: string } = {}
    if (email) data.email = email
    if (name && !user.name.trim()) data.name = name
    if (Object.keys(data).length > 0) {
      user = await prisma.user.update({
        where: { id: user.id },
        data,
      })
    }
  }

  return publicSession(
    await issueDeviceSession(user.id, params.platform, params.deviceName, params.installationId),
  )
}

export async function loginWithApple(params: {
  identityToken: string
  nonce?: string
  fullName?: string
  email?: string
  platform?: string
  deviceName?: string
  installationId?: string
  inviteCode?: string
}) {
  if (getDeploymentMode() === 'self-hosted') throw new AuthRouteError(404, 'provider_unavailable')
  if (!params.identityToken?.trim()) {
    throw new AuthRouteError(400, 'identityToken is required')
  }

  const appleEnabled = readBooleanEnv(process.env.APPLE_SIGN_IN_ENABLED)
  const bundleId = parseAppleBundleId()
  const serviceId = process.env.APPLE_SIGN_IN_SERVICE_ID?.trim() || null
  if (!appleEnabled || !bundleId) {
    throw new AuthRouteError(503, 'Apple login is not configured on server')
  }

  // Web sends serviceId as audience; native sends bundleId
  const audience = params.platform === 'web' && serviceId ? serviceId : bundleId

  let payload: Awaited<ReturnType<typeof verifyAppleIdentityToken>>
  try {
    payload = await verifyAppleIdentityToken({
      identityToken: params.identityToken,
      audience,
      nonce: normalizeOptionalString(params.nonce) ?? undefined,
    })
  } catch {
    throw new AuthRouteError(401, 'Invalid Apple credential')
  }

  const sub = normalizeOptionalString(payload.sub)
  if (!sub) {
    throw new AuthRouteError(401, 'Invalid Apple credential')
  }

  const email = normalizeOptionalString(payload.email) ?? normalizeOptionalString(params.email)
  const name = normalizeOptionalString(params.fullName) ?? ''

  let user = await prisma.user.findUnique({ where: { appleSub: sub } })
  if (!user) {
    throw new AuthRouteError(403, 'phone_login_required')
  } else {
    const data: { email?: string; name?: string } = {}
    if (email && !user.email) data.email = email
    if (name && !user.name) data.name = name
    if (Object.keys(data).length > 0) {
      user = await prisma.user.update({
        where: { id: user.id },
        data,
      })
    }
  }

  return publicSession(
    await issueDeviceSession(user.id, params.platform, params.deviceName, params.installationId),
  )
}

export async function refreshDeviceSession(params: {
  refreshToken: string
  platform?: string
  deviceName?: string
  installationId?: string
}) {
  if (!params.refreshToken) {
    throw new AuthRouteError(400, 'refreshToken is required')
  }

  const device = await prisma.device.findUnique({ where: { refreshToken: params.refreshToken } })
  if (!device || device.refreshExpiry < new Date()) {
    throw new AuthRouteError(401, 'Invalid or expired refresh token')
  }
  if (device.platform === 'web' || params.platform === 'web') {
    throw new AuthRouteError(403, 'Web device login retired')
  }

  const tokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const accessToken = signToken({ userId: device.userId, deviceId: device.id })
  const updateData: Record<string, unknown> = {
    accessToken,
    tokenExpiry,
    lastActiveAt: new Date(),
  }
  const installationId = normalizeInstallationId(params.installationId)
  if (installationId && !device.installationId) {
    updateData.installationId = installationId
  }
  if (params.platform && device.platform !== 'unknown' && device.platform !== params.platform) {
    throw new AuthRouteError(403, 'Device platform mismatch; reauthentication required')
  }
  if (params.platform && device.platform === 'unknown') {
    updateData.platform = params.platform
  }
  if (params.deviceName && (
    !device.name ||
    (device.platform === 'desktop' && device.name === 'Shennian Desktop' &&
      (params.deviceName === 'Mac Desktop' || params.deviceName === 'Windows Desktop'))
  )) {
    updateData.name = params.deviceName
  }

  try {
    await prisma.device.update({
      where: { id: device.id },
      data: updateData,
    })
  } catch (error) {
    if (!installationId || !isUniqueConflict(error)) throw error
    delete updateData.installationId
    await prisma.device.update({
      where: { id: device.id },
      data: updateData,
    })
  }

  const user = await ensureUserNickname(await prisma.user.findUniqueOrThrow({ where: { id: device.userId } }))
  return { token: accessToken, refreshToken: params.refreshToken, user: publicUser(user) }
}

export async function getCurrentUser(userId: string): Promise<{ user: PublicUser }> {
  const user = await ensureUserNickname(await prisma.user.findUniqueOrThrow({ where: { id: userId } }))
  await syncActiveHumanRoomMembershipAliases(userId, user.name)
  return { user: publicUser(user) }
}

export async function updateCurrentUserProfile(
  userId: string,
  input: { name?: unknown; pushPreviewEnabled?: unknown },
): Promise<{ user: PublicUser }> {
  const data: { name?: string; nameSetupRequired?: boolean } = {}
  if (input.name !== undefined) {
    data.name = normalizeUserName(input.name)
    if (!data.name) throw new AuthRouteError(400, 'profile_name_required')
    data.nameSetupRequired = false
  }
  if (input.pushPreviewEnabled !== undefined) {
    if (typeof input.pushPreviewEnabled !== 'boolean') {
      throw new AuthRouteError(400, 'pushPreviewEnabled must be a boolean')
    }
  }
  const user = await prisma.user.update({
    where: { id: userId },
    data,
  })
  if (data.name !== undefined) await syncActiveHumanRoomMembershipAliases(userId, data.name)
  return { user: publicUser(user) }
}

export async function syncActiveHumanRoomMembershipAliases(userId: string, name: string): Promise<void> {
  await prisma.roomMembership.updateMany({
    where: {
      userId,
      principalType: 'human',
      status: 'active',
      displayAlias: { not: name },
    },
    data: { displayAlias: name },
  })
}

export async function listDevices(userId: string, currentDeviceId: string) {
  const devices = await prisma.device.findMany({
    where: { userId, platform: { not: 'web' }, refreshExpiry: { gt: new Date() } },
    select: {
      id: true,
      platform: true,
      name: true,
      lastActiveAt: true,
      createdAt: true,
    },
    orderBy: { lastActiveAt: 'desc' },
  })

  return devices.map((device) => ({
    ...device,
    current: device.id === currentDeviceId,
  }))
}

export async function revokeCurrentDevice(deviceId: string) {
  await prisma.device.delete({ where: { id: deviceId } })
  publishDeviceRevoked(deviceId)
}

export async function revokeDevice(params: {
  id: string
  userId: string
  currentDeviceId: string
}) {
  if (params.id === params.currentDeviceId) {
    throw new AuthRouteError(400, 'Cannot revoke current device')
  }

  const device = await prisma.device.findUnique({ where: { id: params.id } })
  if (!device || device.userId !== params.userId) {
    throw new AuthRouteError(404, 'Device not found')
  }

  await prisma.device.delete({ where: { id: device.id } })
  publishDeviceRevoked(device.id)
}

export async function createQrLoginSession(params: {
  installationId?: string
  platform: string
  deviceName: string
}) {
  const qrToken = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 3 * 60 * 1000)
  const targetPlatform = normalizeQrTargetPlatform(params.platform)
  const targetDeviceName = normalizeQrTargetDeviceName(params.deviceName)

  await prisma.qrSession.create({
    data: {
      token: qrToken,
      type: 'login',
      deviceInstallationId: normalizeInstallationId(params.installationId),
      targetPlatform,
      targetDeviceName,
      expiresAt,
    },
  })

  const deepLink = `qr:${qrToken}`
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=10&data=${encodeURIComponent(deepLink)}`
  return { qrId: qrToken, qrUrl }
}

export async function confirmQrLogin(params: { qrToken: string; userId: string }) {
  if (!params.qrToken) {
    throw new AuthRouteError(400, 'qrToken is required')
  }

  const session = await prisma.qrSession.findUnique({ where: { token: params.qrToken } })
  if (!session || session.expiresAt < new Date()) {
    throw new AuthRouteError(400, 'Invalid or expired QR session')
  }
  if (session.status === 'confirmed' && session.userId === params.userId) return
  if (session.status !== 'pending') {
    throw new AuthRouteError(409, 'QR session is already being confirmed')
  }
  const claimed = await prisma.qrSession.updateMany({
    where: { id: session.id, status: 'pending' },
    data: { status: 'confirming' },
  })
  if (claimed.count !== 1) {
    throw new AuthRouteError(409, 'QR session is already being confirmed')
  }

  try {
    if (!session.targetPlatform || !session.targetDeviceName) {
      throw new AuthRouteError(409, 'QR login target identity is missing')
    }
    const issued = await issueDeviceSession(
      params.userId,
      session.targetPlatform,
      session.targetDeviceName,
      session.deviceInstallationId ?? undefined,
    )
    await prisma.qrSession.update({
      where: { id: session.id },
      data: { status: 'confirmed', userId: params.userId, deviceId: issued.deviceId },
    })
  } catch (error) {
    await prisma.qrSession
      .updateMany({
        where: { id: session.id, status: 'confirming' },
        data: { status: 'pending' },
      })
      .catch(() => {})
    throw error
  }
}

export async function getQrLoginStatus(qrToken: string) {
  const session = await prisma.qrSession.findUnique({ where: { token: qrToken } })
  if (!session) {
    throw new AuthRouteError(404, 'QR session not found')
  }

  if (session.status === 'confirming') {
    return { status: 'pending' as const }
  }

  if (session.expiresAt < new Date() && session.status === 'pending') {
    return { status: 'expired' as const }
  }

  if (session.status === 'confirmed') {
    const device = session.deviceId
      ? await prisma.device.findUnique({
          where: { id: session.deviceId },
          include: {
            user: {
              select: {
                id: true,
                phone: true,
                email: true,
                name: true,
                nameSetupRequired: true,
                avatarVersion: true,
                avatarUpdatedAt: true,
                accountTier: true,
                entitlementFlags: true,
              },
            },
          },
        })
      : null
    if (device && device.platform !== 'web') {
      return {
        status: 'confirmed' as const,
        token: device.accessToken,
        refreshToken: device.refreshToken,
        user: publicUser(await ensureUserNickname(device.user)),
      }
    }
  }

  return { status: session.status as 'pending' | 'confirmed' | 'expired' }
}
