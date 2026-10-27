// @arch docs/features/personal-modules.md
// @test src/__tests__/recognition-storage.test.ts
import * as FileSystem from 'expo-file-system/legacy'
import { encode, decode } from './audioArchive'
import type { PersonalModuleStore } from './localStore'
import type { RecognitionJob, RecognitionStorage } from './durableRecognition'
import { localDay } from './types'
const KIND = 'recognition-audio'
/** Separate ASR journal contains only human windows, never our TTS playback.
 * Unlike the raw archive it may be removed once its transcript is committed.
 */
export function recognitionStorage(store: PersonalModuleStore): RecognitionStorage {
  const safe = (value: string) => {
    if (!/^[\w-]{1,100}$/.test(value)) throw new Error('recording_invalid_id')
    return value
  }
  const directory = () => {
    if (!FileSystem.documentDirectory) throw new Error('recording_storage_unavailable')
    return `${FileSystem.documentDirectory}personal-recognition/${safe(store.userId)}/`
  }
  const file = (job: RecognitionJob) => `${directory()}${safe(job.key)}.pcm`
  return {
    async recover() {
      const jobs = await store.values<RecognitionJob>(KIND)
      for (const job of jobs) {
        const info = await FileSystem.getInfoAsync(file(job))
        if (!info.exists || !('size' in info) || !info.size) {
          if (job.size) throw new Error('recording_local_file_missing')
          await store.removeValue(KIND, job.key)
          continue
        }
        // A killed process may leave the last journal unsealed. Recover bytes
        // actually on disk, not stale metadata, without reopening the mic.
        job.size = info.size - info.size % 2
        job.sealed = true
        await store.saveValue(KIND, job.key, job)
      }
      return jobs.filter(job => job.size > 0).sort((a, b) => a.startAt - b.startAt)
    },
    async create(job) {
      await FileSystem.makeDirectoryAsync(directory(), { intermediates: true })
      await store.saveValue(KIND, job.key, job)
    },
    async append(job, frame) {
      await FileSystem.writeAsStringAsync(file(job), encode(frame), {
        encoding: FileSystem.EncodingType.Base64, append: job.size > 0,
      })
    },
    async seal(job) { await store.saveValue(KIND, job.key, { ...job, sealed: true }) },
    async read(job, offset, length) {
      return decode(await FileSystem.readAsStringAsync(file(job), {
        encoding: FileSystem.EncodingType.Base64, position: offset, length,
      }))
    },
    async complete(job, transcript) {
      if (transcript) await store.saveTranscript(transcript, job.key)
      else await store.removeValue(KIND, job.key)
      // Committing the transcript/outbox precedes deleting any recoverable audio.
      // Cleanup failure must not replay an acknowledged job.
      await FileSystem.deleteAsync(file(job), { idempotent: true }).catch(() => {})
    },
    deleted: job => store.isDayDeleted(job.day ?? localDay(new Date(job.startAt))),
  }
}
