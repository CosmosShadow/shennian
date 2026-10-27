// @arch open-source/docs/server-runtime.md
// @test src/__tests__/voice-chief-preferences.test.ts src/__tests__/voice-chief-ws.test.ts

import type {
  VoiceChiefPreferences,
  VoiceChiefVoiceId,
  VoiceChiefVoiceOption,
} from '@shennian/wire'
import { prisma } from '../lib/prisma.js'

export const VOICE_CHIEF_DEFAULT_VOICE: VoiceChiefVoiceId = 'longanlingxin'

export const VOICE_CHIEF_OFFICIAL_VOICE_IDS = [
  'longanqian',
  'longanlingxin',
  'longanlingxi',
  'longanxiaoxin',
  'longanlufeng',
] as const satisfies readonly VoiceChiefVoiceId[]

export const VOICE_CHIEF_VISIBLE_VOICE_OPTIONS = [
  { id: 'longanqian', labelKey: 'voice_chief_voice_warm_female' },
  { id: 'longanlingxin', labelKey: 'voice_chief_voice_clear_female', default: true },
  { id: 'longanlufeng', labelKey: 'voice_chief_voice_steady_male' },
  { id: 'longanxiaoxin', labelKey: 'voice_chief_voice_bright' },
] as const satisfies readonly VoiceChiefVoiceOption[]

const OFFICIAL_VOICE_SET = new Set<string>(VOICE_CHIEF_OFFICIAL_VOICE_IDS)

export type VoiceChiefUserPreferences = {
  voice: VoiceChiefVoiceId
}

export class VoiceChiefPreferenceError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'VoiceChiefPreferenceError'
  }
}

export function normalizeVoiceChiefVoice(value: unknown): VoiceChiefVoiceId | null {
  if (typeof value !== 'string') return null
  const voice = value.trim()
  return OFFICIAL_VOICE_SET.has(voice) ? (voice as VoiceChiefVoiceId) : null
}

function preferencePayload(voice: VoiceChiefVoiceId): VoiceChiefPreferences {
  return {
    voice,
    options: [...VOICE_CHIEF_VISIBLE_VOICE_OPTIONS],
  }
}

function defaultVoiceFromEnv(): VoiceChiefVoiceId {
  return normalizeVoiceChiefVoice(process.env.VOICE_CHIEF_VOICE) ?? VOICE_CHIEF_DEFAULT_VOICE
}

export async function loadVoiceChiefUserPreferences(
  userId: string,
): Promise<VoiceChiefUserPreferences> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { voiceChiefVoice: true },
  })
  return {
    voice: normalizeVoiceChiefVoice(user?.voiceChiefVoice) ?? defaultVoiceFromEnv(),
  }
}

export async function getVoiceChiefPreferences(userId: string): Promise<VoiceChiefPreferences> {
  const preferences = await loadVoiceChiefUserPreferences(userId)
  return preferencePayload(preferences.voice)
}

export async function updateVoiceChiefPreferences(
  userId: string,
  input: { voice?: unknown },
): Promise<VoiceChiefPreferences> {
  const voice = normalizeVoiceChiefVoice(input.voice)
  if (!voice || !VOICE_CHIEF_VISIBLE_VOICE_OPTIONS.some((option) => option.id === voice)) {
    throw new VoiceChiefPreferenceError(400, 'Invalid voice')
  }
  const user = await prisma.user.update({
    where: { id: userId },
    data: { voiceChiefVoice: voice },
    select: { voiceChiefVoice: true },
  })
  return preferencePayload(normalizeVoiceChiefVoice(user.voiceChiefVoice) ?? VOICE_CHIEF_DEFAULT_VOICE)
}
