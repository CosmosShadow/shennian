// @arch open-source/docs/server-runtime.md
// @test src/__tests__/task-completion-push.test.ts

import JPush from 'jpush-sdk'
import { systemPushEnabled } from './instance-settings.js'
import webpush from 'web-push'
import { prisma } from '../lib/prisma.js'
import { writeLog } from './log.js'
import { randomBytes } from 'crypto'

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? ''
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? ''
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? 'mailto:support@shennian.ai'
const JPUSH_APP_KEY = process.env.JPUSH_APP_KEY?.trim() ?? ''
const JPUSH_MASTER_SECRET = process.env.JPUSH_MASTER_SECRET?.trim() ?? ''
const JPUSH_APNS_PRODUCTION =
  (process.env.JPUSH_APNS_PRODUCTION ?? 'true').trim().toLowerCase() !== 'false'

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
}

export type PushProvider = 'expo' | 'web' | 'jpush' | 'apns-voip'

export type PushData = {
  sessionId?: string
  runId?: string
  [key: string]: string | number | boolean | undefined
}

type ResolvedPushTarget = {
  deviceId: string
  platform: string
  provider: PushProvider
  token: string
  lastActiveAt?: Date
}

type PushAudience = 'all' | 'mobile'

type PushSendOptions = {
  audience?: PushAudience
  traceId?: string
  badge?: number
  requireDelivery?: boolean
}

const PUSH_PROVIDER_ORDER: PushProvider[] = ['jpush', 'expo', 'web', 'apns-voip']

function normalizeProvider(provider: string | null | undefined): PushProvider | null {
  if (provider === 'expo' || provider === 'web' || provider === 'jpush' || provider === 'apns-voip') return provider
  return null
}

function inferLegacyProvider(token: string): PushProvider | null {
  if (token.startsWith('ExponentPushToken')) return 'expo'
  if (token.startsWith('{')) return 'web'
  return null
}

function isProviderConfigured(provider: PushProvider): boolean {
  if (provider === 'expo') return true
  if (provider === 'web') return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY)
  if (provider === 'apns-voip') return false
  return Boolean(JPUSH_APP_KEY && JPUSH_MASTER_SECRET)
}

function choosePreferredRegistration(
  registrations: Array<{ provider: string; platform: string; token: string; lastActiveAt?: Date }>,
): ResolvedPushTarget | null {
  const normalized = registrations
    .map((registration) => ({
      ...registration,
      normalizedProvider: normalizeProvider(registration.provider),
    }))
    .filter(
      (
        registration,
      ): registration is typeof registration & { normalizedProvider: PushProvider } =>
        Boolean(registration.normalizedProvider),
    )
    .sort(
      (left, right) =>
        PUSH_PROVIDER_ORDER.indexOf(left.normalizedProvider) -
        PUSH_PROVIDER_ORDER.indexOf(right.normalizedProvider),
    )

  for (const registration of normalized) {
    if (!isProviderConfigured(registration.normalizedProvider)) continue
    return {
      deviceId: '',
      platform: registration.platform,
      provider: registration.normalizedProvider,
      token: registration.token,
      lastActiveAt: registration.lastActiveAt,
    }
  }

  return null
}

function getJPushClient() {
  if (!JPUSH_APP_KEY || !JPUSH_MASTER_SECRET) return null
  return JPush.buildClient({
    appKey: JPUSH_APP_KEY,
    masterSecret: JPUSH_MASTER_SECRET,
    isDebug: process.env.DEBUG === 'true',
  })
}

function isMissingDevicePushRegistrationTable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const maybe = error as {
    code?: string
    meta?: {
      modelName?: string
      driverAdapterError?: { cause?: { kind?: string; table?: string } }
    }
  }
  return (
    maybe.code === 'P2021' &&
    maybe.meta?.modelName === 'DevicePushRegistration'
  )
}

async function sendViaExpo(
  token: string,
  title: string,
  body: string,
  data?: PushData,
  badge?: number,
): Promise<void> {
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: token,
      title,
      body,
      sound: 'default',
      data,
      ...(typeof badge === 'number' ? { badge } : {}),
    }),
  })
  if (!res.ok) {
    throw new Error(`Expo push returned ${res.status}`)
  }

  const payload = (await res.json().catch(() => null)) as
    | {
        data?: Array<{
          status?: string
          message?: string
          details?: Record<string, unknown>
        }>
      }
    | null

  const first = payload?.data?.[0]
  if (first?.status && first.status !== 'ok') {
    throw Object.assign(new Error(first.message || `Expo push failed: ${first.status}`), {
      details: first.details,
      providerStatus: first.status,
    })
  }
}

async function sendViaWebPush(
  token: string,
  title: string,
  body: string,
  data?: PushData,
): Promise<void> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return
  const subscription = JSON.parse(token) as webpush.PushSubscription
  await webpush.sendNotification(subscription, JSON.stringify({ title, body, data }))
}

async function sendViaJPush(
  token: string,
  platform: string,
  title: string,
  body: string,
  data?: PushData,
  badge?: number,
): Promise<void> {
  const client = getJPushClient()
  if (!client) {
    throw new Error('JPush is not configured')
  }

  const extras = Object.fromEntries(
    Object.entries(data ?? {}).map(([key, value]) => [key, String(value)]),
  )

  await new Promise<void>((resolve, reject) => {
    const payload = client
      .push()
      .setPlatform(platform === 'ios' ? 'ios' : 'android')
      .setAudience(JPush.registration_id(token))

    if (platform === 'ios') {
      payload.setNotification(title, JPush.ios(body, 'default', badge ?? 1, false, extras))
      payload.setOptions(null, 60, null, JPUSH_APNS_PRODUCTION)
    } else {
      payload.setNotification(JPush.android(body, title, 1, extras, 1))
    }

    payload.send((err: Error | null) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

export async function sendJPushNotificationToRegistrationId(input: {
  registrationId: string
  platform: 'android' | 'ios'
  title: string
  body: string
  data?: PushData
  badge?: number
}): Promise<void> {
  if (!systemPushEnabled()) throw new Error('push_disabled')
  await sendViaJPush(
    input.registrationId,
    input.platform,
    input.title,
    input.body,
    input.data,
    input.badge,
  )
}

export async function sendJPushCustomMessageToRegistrationId(input: {
  registrationId: string
  platform: 'android' | 'ios'
  title: string
  content: string
  data?: PushData
}): Promise<void> {
  if (!systemPushEnabled()) throw new Error('push_disabled')
  const client = getJPushClient()
  if (!client) {
    throw new Error('JPush is not configured')
  }
  const extras = Object.fromEntries(
    Object.entries(input.data ?? {}).map(([key, value]) => [key, String(value)]),
  )
  await new Promise<void>((resolve, reject) => {
    const payload = client
      .push()
      .setPlatform(input.platform === 'ios' ? 'ios' : 'android')
      .setAudience(JPush.registration_id(input.registrationId))
    ;(payload as unknown as {
      setMessage(content: string, title: string, contentType: string, extras: Record<string, string>): {
        send(callback: (err: Error | null) => void): void
      }
    })
      .setMessage(input.content, input.title, 'voice_incoming_call', extras)
      .send((err: Error | null) => {
        if (err) reject(err)
        else resolve()
      })
  })
}

async function sendToTarget(
  target: ResolvedPushTarget,
  title: string,
  body: string,
  data?: PushData,
  badge?: number,
): Promise<void> {
  if (target.provider === 'expo') {
    await sendViaExpo(target.token, title, body, data, badge)
    return
  }
  if (target.provider === 'web') {
    await sendViaWebPush(target.token, title, body, data)
    return
  }
  if (target.provider === 'apns-voip') return
  await sendViaJPush(target.token, target.platform, title, body, data, badge)
}

export async function registerPushToken(params: {
  userId: string
  deviceId: string
  provider: PushProvider
  platform: string
  pushToken: string
}): Promise<void> {
  if (!systemPushEnabled()) return
  const traceId = randomBytes(8).toString('hex')
  try {
    await prisma.devicePushRegistration.upsert({
      where: {
        deviceId_provider: {
          deviceId: params.deviceId,
          provider: params.provider,
        },
      },
      create: {
        userId: params.userId,
        deviceId: params.deviceId,
        provider: params.provider,
        platform: params.platform,
        token: params.pushToken,
      },
      update: {
        userId: params.userId,
        platform: params.platform,
        token: params.pushToken,
      },
    })
  } catch (error) {
    if (!isMissingDevicePushRegistrationTable(error)) throw error
  }

  if (params.provider === 'expo' || params.provider === 'web') {
    await prisma.device.update({
      where: { id: params.deviceId },
      data: { pushToken: params.pushToken },
    })
  }

  void writeLog({
    traceId,
    userId: params.userId,
    source: 'server',
    type: 'internal',
    level: 'info',
    path: 'push.register',
    metadata: {
      deviceId: params.deviceId,
      provider: params.provider,
      platform: params.platform,
    },
  })
}

export async function unregisterPushToken(params: {
  deviceId: string
  provider: PushProvider
}): Promise<void> {
  const traceId = randomBytes(8).toString('hex')
  try {
    await prisma.devicePushRegistration.deleteMany({
      where: {
        deviceId: params.deviceId,
        provider: params.provider,
      },
    })
  } catch (error) {
    if (!isMissingDevicePushRegistrationTable(error)) throw error
  }

  if (params.provider === 'expo' || params.provider === 'web') {
    await prisma.device.update({
      where: { id: params.deviceId },
      data: { pushToken: null },
    })
  }

  void writeLog({
    traceId,
    source: 'server',
    type: 'internal',
    level: 'info',
    path: 'push.unregister',
    metadata: {
      deviceId: params.deviceId,
      provider: params.provider,
    },
  })
}

function isMobilePlatform(platform: string): boolean {
  return platform === 'ios' || platform === 'android'
}

async function resolvePushTargets(
  userId: string,
  audience: PushAudience = 'all',
): Promise<ResolvedPushTarget[]> {
  const [registrations, legacyDevices] = await Promise.all([
    prisma.devicePushRegistration
      .findMany({
        where: { userId },
        select: {
          deviceId: true,
          platform: true,
          provider: true,
          token: true,
          device: {
            select: {
              lastActiveAt: true,
            },
          },
        },
      })
      .catch((error) => {
        if (isMissingDevicePushRegistrationTable(error)) {
          return []
        }
        throw error
      }),
    prisma.device.findMany({
      where: { userId, pushToken: { not: null } },
      select: { id: true, platform: true, pushToken: true, lastActiveAt: true },
    }),
  ])

  const registrationsByDevice = new Map<
    string,
    Array<{ provider: string; platform: string; token: string; lastActiveAt?: Date }>
  >()

  for (const registration of registrations) {
    const list = registrationsByDevice.get(registration.deviceId) ?? []
    list.push({
      provider: registration.provider,
      platform: registration.platform,
      token: registration.token,
      lastActiveAt: registration.device?.lastActiveAt,
    })
    registrationsByDevice.set(registration.deviceId, list)
  }

  for (const legacyDevice of legacyDevices) {
    if (!legacyDevice.pushToken || registrationsByDevice.has(legacyDevice.id)) continue
    const provider = inferLegacyProvider(legacyDevice.pushToken)
    if (!provider) continue
    registrationsByDevice.set(legacyDevice.id, [
      {
        provider,
        platform: legacyDevice.platform,
        token: legacyDevice.pushToken,
        lastActiveAt: legacyDevice.lastActiveAt,
      },
    ])
  }

  const targets: ResolvedPushTarget[] = []
  for (const [deviceId, deviceRegistrations] of registrationsByDevice) {
    const preferred = choosePreferredRegistration(deviceRegistrations)
    if (!preferred) continue
    if (audience === 'mobile' && !isMobilePlatform(preferred.platform)) continue
    targets.push({ ...preferred, deviceId })
  }

  const dedupedByToken = new Map<string, ResolvedPushTarget>()
  for (const target of targets) {
    const key = `${target.provider}:${target.token}`
    const existing = dedupedByToken.get(key)
    if (
      !existing ||
      (target.lastActiveAt?.getTime() ?? 0) > (existing.lastActiveAt?.getTime() ?? 0)
    ) {
      dedupedByToken.set(key, target)
    }
  }

  return Array.from(dedupedByToken.values())
}

export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  data?: PushData,
  options?: PushSendOptions,
): Promise<void> {
  if (!systemPushEnabled()) {
    if (options?.requireDelivery) throw new Error('push_disabled')
    return
  }
  const traceId = options?.traceId ?? randomBytes(8).toString('hex')
  const audience = options?.audience ?? 'all'
  const badge = typeof options?.badge === 'number' ? options.badge : undefined
  const sessionId =
    typeof data?.sessionId === 'string' ? data.sessionId : null

  const targets = await resolvePushTargets(userId, audience)

  void writeLog({
    traceId,
    userId,
    sessionId,
    source: 'server',
    type: 'internal',
    level: 'info',
    path: 'push.send',
    metadata: {
      audience,
      badge: badge ?? null,
      targetCount: targets.length,
      targets: targets.map((target) => ({
        deviceId: target.deviceId,
        provider: target.provider,
        platform: target.platform,
      })),
    },
  })

  const sends = targets.map(async (target) => {
    try {
      // Bind every provider payload to the actual recipient, never caller input.
      // Foreground clients otherwise redact the preview as a legacy/unknown-account push.
      await sendToTarget(target, title, body, { ...data, recipientUserId: userId }, badge)
      void writeLog({
        traceId,
        userId,
        sessionId,
        source: 'server',
        type: 'internal',
        level: 'info',
        path: 'push.delivered',
        metadata: {
          audience,
          deviceId: target.deviceId,
          provider: target.provider,
          platform: target.platform,
          badge: badge ?? null,
        },
      })
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode
      console.warn('[push] send failed', {
        deviceId: target.deviceId,
        provider: target.provider,
        platform: target.platform,
        statusCode,
        err,
      })
      void writeLog({
        traceId,
        userId,
        sessionId,
        source: 'server',
        type: 'internal',
        level: 'warn',
        path: 'push.failed',
        statusCode: statusCode ?? null,
        errorMessage: err instanceof Error ? err.message : String(err),
        errorStack: err instanceof Error ? err.stack ?? null : null,
        metadata: {
          audience,
          deviceId: target.deviceId,
          provider: target.provider,
          platform: target.platform,
          badge: badge ?? null,
        },
      })
      if (
        target.provider === 'web' &&
        (statusCode === 410 || statusCode === 404)
      ) {
        await unregisterPushToken({ deviceId: target.deviceId, provider: 'web' }).catch(() => {})
      }
      if (options?.requireDelivery) throw err
    }
  })

  await Promise.allSettled(sends)
}
