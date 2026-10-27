// @arch docs/features/listening.md
// @test src/__tests__/recording-speakers.test.ts
import { authApi } from '../../config/api'
import { useAuthStore } from '../../config/auth'
import { encode } from './audioArchive'
import type { PersonalModuleStore } from './localStore'
import type { RecognitionJob, RecognitionStorage } from './durableRecognition'
import type { Transcript } from './types'
/** Automatically enrich new capture windows; legacy unmarked journals stay unchanged. Original transcript remains intact. */
export async function enrichRecordingSpeakers(store: PersonalModuleStore, storage: RecognitionStorage, job: RecognitionJob, transcript: Transcript): Promise<Transcript> {
  const valid = () => useAuthStore.getState().user?.id === store.userId
  if (!job.separateSpeakers || !valid() || await storage.deleted(job)) return transcript
  if (!job.sealed || !job.size || job.size > 65 * 32000) return { ...transcript, speakerStatus: 'unavailable' }
  const pcm = await storage.read(job, 0, job.size)
  if (!valid() || await storage.deleted(job)) return transcript
  if (pcm.length !== job.size) throw new Error('recording_local_file_missing')
  // 48KB is divisible by three, so independent base64 chunks concatenate
  // without interior padding or a multi-megabyte intermediate binary string.
  const chunks: string[] = []
  for (let offset = 0; offset < pcm.length; offset += 48000) chunks.push(encode(pcm.subarray(offset, offset + 48000)))
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 100000)
  const detach = useAuthStore.subscribe(state => {
    if (state.user?.id !== store.userId) controller.abort()
  })
  try {
    const result = await authApi<Pick<Transcript, 'speakerStatus' | 'speakerSentences'>>('/personal-modules/recording/speakers', {
      method: 'POST', signal: controller.signal, body: JSON.stringify({ key: job.key, sessionKey: job.sessionKey,
        startAt: transcript.startAt, timezone: transcript.timezone, pcmBase64: chunks.join('') }),
    }, { timeoutMs: 105000 })
    if (result.speakerStatus !== 'done' || !result.speakerSentences?.length)
      return { ...transcript, speakerStatus: 'unavailable' }
    return { ...transcript, speakerStatus: 'done', speakerSentences: result.speakerSentences }
  } finally { clearTimeout(timer); detach() }
}
