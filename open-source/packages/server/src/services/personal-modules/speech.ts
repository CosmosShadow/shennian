// @arch open-source/docs/server-runtime.md
// @test src/__tests__/personal-modules.test.ts
import { get, put } from './store.js'
import { object, text } from './domain.js'
import { withDistributedLease } from '../distributed-lease.js'
const MAX_AUDIO_BYTES = 6 * 1024 * 1024
export function speechPcm(wav: Buffer) {
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('speech_invalid_audio')
  let sampleRate = 0
  let pcm: Buffer | null = null
  for (let at = 12; at + 8 <= wav.length;) {
    const kind = wav.toString('ascii', at, at + 4), declaredSize = wav.readUInt32LE(at + 4), start = at + 8
    // Qwen returns streaming-WAV sentinel lengths even for its downloadable
    // result. Only its final data chunk may extend to the bounded HTTP EOF.
    const size = kind === 'data' && declaredSize >= 0x7fff0000 && wav.readUInt32LE(4) >= 0x7fff0000 ? wav.length - start : declaredSize
    if (start + size > wav.length) throw new Error('speech_invalid_audio')
    if (kind === 'fmt ') {
      if (size < 16 || wav.readUInt16LE(start) !== 1 || wav.readUInt16LE(start + 2) !== 1 || wav.readUInt16LE(start + 14) !== 16)
        throw new Error('speech_invalid_audio')
      sampleRate = wav.readUInt32LE(start + 4)
    } else if (kind === 'data') pcm = wav.subarray(start, start + size)
    at = start + size + (size % 2)
  }
  if (![16000, 24000, 48000].includes(sampleRate) || !pcm?.length || pcm.length % 2 || pcm.length > MAX_AUDIO_BYTES)
    throw new Error('speech_invalid_audio')
  return { sampleRate, pcmBase64: pcm.toString('base64') }
}
export async function synthesizeSpeech(content: string, language: 'Chinese' | 'English' | 'Auto') {
  if (!content.trim() || [...content].length > 600) throw new Error('invalid_speech_text')
  const key = process.env.DASHSCOPE_API_KEY
  if (!key) throw new Error('speech_unavailable')
  const signal = AbortSignal.timeout(25000)
  const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation', {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'qwen3-tts-flash', input: { text: content, voice: 'Cherry', language_type: language } }),
  })
  if (!response.ok) throw new Error('speech_unavailable')
  const result = await response.json() as { output?: { audio?: { url?: string } } }
  const url = new URL(result.output?.audio?.url ?? '')
  // The provider returns a short-lived OSS URL. Never proxy arbitrary hosts or
  // redirects, expose signed URLs, or store synthesized private speech on disk.
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port ||
      !/^dashscope-result-[a-z0-9-]+\.oss-[a-z0-9-]+\.aliyuncs\.com$/.test(url.hostname))
    throw new Error('speech_invalid_audio')
  url.protocol = 'https:'
  const audio = await fetch(url, { signal, redirect: 'error' })
  if (!audio.ok || Number(audio.headers.get('content-length')) > MAX_AUDIO_BYTES) throw new Error('speech_invalid_audio')
  const reader = audio.body?.getReader()
  if (!reader) throw new Error('speech_invalid_audio')
  const chunks: Buffer[] = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_AUDIO_BYTES) throw new Error('speech_invalid_audio')
      chunks.push(Buffer.from(value))
    }
  } finally { await reader.cancel().catch(() => {}) }
  return { ...speechPcm(Buffer.concat(chunks)), text: content }
}
export async function recordingSpeech(userId: string, raw: unknown) {
  const input = object(raw), language = input.language === 'en' ? 'English' : 'Chinese'
  let content: string
  if (input.promptKey) {
    const row = await get(userId, 'english-prompt', text(input.promptKey)), prompt = object(row?.payload ?? {})
    if (!row || !Number.isFinite(Date.parse(String(prompt.expiresAt))) || Date.parse(String(prompt.expiresAt)) <= Date.now())
      throw new Error('prompt_expired')
    content = text(prompt.text)
  } else if (input.kind === 'reminder') {
    content = language === 'Chinese' ? '你有一项日程提醒，可以查看卡片。' : 'You have a calendar reminder. Check the card.'
  } else if (input.kind === 'notification') {
    content = language === 'Chinese' ? '你有新的消息或任务反馈，可以查看卡片。' : 'You have a new message or task update. Check the card.'
  } else throw new Error('invalid_speech_request')
  const lease = await withDistributedLease({ name: `personal-speech:${userId}`, ttlMs: 30000, run: async () => {
    const clock = await get(userId, 'analysis-clock', 'speech')
    if (clock && Number(object(clock.payload).at) > Date.now() - 3000) throw new Error('speech_busy')
    await put(userId, 'analysis-clock', 'speech', { at: Date.now() })
    return synthesizeSpeech(content, input.promptKey ? 'Auto' : language)
  } })
  if (!lease.acquired) throw new Error('speech_busy')
  return lease.result
}
