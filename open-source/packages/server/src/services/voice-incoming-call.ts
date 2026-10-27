// @arch open-source/docs/server-runtime.md
// @test src/__tests__/voice-incoming-call.test.ts

import { randomUUID } from 'node:crypto'
import { systemPushEnabled } from './instance-settings.js'
import { prisma } from '../lib/prisma.js'
import { writeLog } from './log.js'
import {
  isApnsVoipConfigured,
  sendApnsVoipPush,
  type ApnsVoipPayload,
  type ApnsVoipTransport,
} from './apns-voip.js'
import { sendJPushCustomMessageToRegistrationId } from './push.js'

export type VoiceIncomingCallStatus =
  | 'ringing'
  | 'unavailable'
  | 'failed'

export type CreateVoiceIncomingCallInput = {
  userId: string
  /** Stable identifier for durable delivery retries. Omit for an immediate call. */
  callId?: string
  reason?: string
  initialPrompt?: string
  projectHint?: string
  targetPlatform?: 'ios' | 'android'
  transport?: ApnsVoipTransport
}

export type VoiceIncomingCallResult = {
  callId: string
  status: VoiceIncomingCallStatus
  platform?: 'ios' | 'android'
  message?: string
}

function trimOptional(value: string | undefined, maxLength: number): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed
}

function buildPayload(input: {
  callId: string
  reason?: string
  initialPrompt?: string
  projectHint?: string
}): ApnsVoipPayload {
  const reason = trimOptional(input.reason, 80)
  return {
    aps: {
      alert: reason ? `神念来电：${reason}` : '神念来电',
      sound: 'default',
      'content-available': 1,
    },
    call_id: input.callId,
    caller_name: '神念',
    ...(reason ? { reason } : {}),
    ...(trimOptional(input.initialPrompt, 500) ? { initial_prompt: trimOptional(input.initialPrompt, 500) } : {}),
    ...(trimOptional(input.projectHint, 120) ? { project_hint: trimOptional(input.projectHint, 120) } : {}),
    timestamp: Math.floor(Date.now() / 1000),
  }
}

async function findLatestIosVoipToken(userId: string): Promise<{
  deviceId: string
  token: string
} | null> {
  const registrations = await prisma.devicePushRegistration.findMany({
    where: {
      userId,
      provider: 'apns-voip',
      platform: 'ios',
    },
    select: {
      deviceId: true,
      token: true,
      updatedAt: true,
      device: {
        select: {
          lastActiveAt: true,
        },
      },
    },
    orderBy: {
      updatedAt: 'desc',
    },
    take: 8,
  })

  const sorted = registrations
    .filter((registration) => registration.token.trim())
    .sort((left, right) => {
      const leftTs = left.device?.lastActiveAt?.getTime() ?? left.updatedAt.getTime()
      const rightTs = right.device?.lastActiveAt?.getTime() ?? right.updatedAt.getTime()
      return rightTs - leftTs
    })
  const target = sorted[0]
  return target ? { deviceId: target.deviceId, token: target.token } : null
}

async function findLatestAndroidJPushToken(userId: string): Promise<{
  deviceId: string
  token: string
} | null> {
  const registrations = await prisma.devicePushRegistration.findMany({
    where: {
      userId,
      provider: 'jpush',
      platform: 'android',
    },
    select: {
      deviceId: true,
      token: true,
      updatedAt: true,
      device: {
        select: {
          lastActiveAt: true,
        },
      },
    },
    orderBy: {
      updatedAt: 'desc',
    },
    take: 8,
  })

  const sorted = registrations
    .filter((registration) => registration.token.trim())
    .sort((left, right) => {
      const leftTs = left.device?.lastActiveAt?.getTime() ?? left.updatedAt.getTime()
      const rightTs = right.device?.lastActiveAt?.getTime() ?? right.updatedAt.getTime()
      return rightTs - leftTs
    })
  const target = sorted[0]
  return target ? { deviceId: target.deviceId, token: target.token } : null
}

export async function createVoiceIncomingCall(
  input: CreateVoiceIncomingCallInput,
): Promise<VoiceIncomingCallResult> {
  const callId = trimOptional(input.callId, 191) ?? `call_${randomUUID()}`
  const targetPlatform = input.targetPlatform
  if (!systemPushEnabled()) {
    return { callId, status: 'unavailable', platform: targetPlatform, message: 'System push is disabled.' }
  }

  if (targetPlatform === 'android') {
    const target = await findLatestAndroidJPushToken(input.userId)
    if (!target) {
      return {
        callId,
        status: 'unavailable',
        platform: 'android',
        message: 'No Android JPush device token is registered.',
      }
    }

    const reason = trimOptional(input.reason, 80)
    const initialPrompt = trimOptional(input.initialPrompt, 500)
    const projectHint = trimOptional(input.projectHint, 120)
    const body = reason ? `神念来电：${reason}` : '神念来电'
    try {
      await sendJPushCustomMessageToRegistrationId({
        registrationId: target.token,
        platform: 'android',
        title: '神念来电',
        content: body,
        data: {
          shennian_type: 'voice_incoming_call',
          callId,
          ...(reason ? { reason } : {}),
          ...(initialPrompt ? { initialPrompt } : {}),
          ...(projectHint ? { projectHint } : {}),
          timestamp: Math.floor(Date.now() / 1000),
        },
      })
      void writeLog({
        traceId: callId.slice(0, 32),
        userId: input.userId,
        source: 'server',
        type: 'internal',
        level: 'info',
        path: 'voice.incoming_call.ringing',
        metadata: {
          callId,
          deviceId: target.deviceId,
          platform: 'android',
          reason: reason ?? null,
        },
      })
      return { callId, status: 'ringing', platform: 'android' }
    } catch (error) {
      void writeLog({
        traceId: callId.slice(0, 32),
        userId: input.userId,
        source: 'server',
        type: 'internal',
        level: 'error',
        path: 'voice.incoming_call.failed',
        errorMessage: error instanceof Error ? error.message : String(error),
        metadata: {
          callId,
          deviceId: target.deviceId,
          platform: 'android',
        },
      })
      return {
        callId,
        status: 'failed',
        platform: 'android',
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  if (targetPlatform && targetPlatform !== 'ios') {
    return {
      callId,
      status: 'unavailable',
      platform: targetPlatform,
      message: 'Unsupported incoming call platform.',
    }
  }

  if (!isApnsVoipConfigured()) {
    if (!targetPlatform) {
      return createVoiceIncomingCall({ ...input, targetPlatform: 'android' })
    }
    return {
      callId,
      status: 'failed',
      platform: 'ios',
      message: 'APNs VoIP is not configured.',
    }
  }

  const target = await findLatestIosVoipToken(input.userId)
  if (!target) {
    if (!targetPlatform) {
      return createVoiceIncomingCall({ ...input, targetPlatform: 'android' })
    }
    return {
      callId,
      status: 'unavailable',
      platform: 'ios',
      message: 'No iOS VoIP device token is registered.',
    }
  }

  const payload = buildPayload({
    callId,
    reason: input.reason,
    initialPrompt: input.initialPrompt,
    projectHint: input.projectHint,
  })

  try {
    await sendApnsVoipPush({
      token: target.token,
      payload,
      transport: input.transport,
    })
    void writeLog({
      traceId: callId.slice(0, 32),
      userId: input.userId,
      source: 'server',
      type: 'internal',
      level: 'info',
      path: 'voice.incoming_call.ringing',
      metadata: {
        callId,
        deviceId: target.deviceId,
        platform: 'ios',
        reason: payload.reason ?? null,
      },
    })
    return { callId, status: 'ringing', platform: 'ios' }
  } catch (error) {
    void writeLog({
      traceId: callId.slice(0, 32),
      userId: input.userId,
      source: 'server',
      type: 'internal',
      level: 'error',
      path: 'voice.incoming_call.failed',
      errorMessage: error instanceof Error ? error.message : String(error),
      metadata: {
        callId,
        deviceId: target.deviceId,
        platform: 'ios',
      },
    })
    return {
      callId,
      status: 'failed',
      platform: 'ios',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}
