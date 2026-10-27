import { enrichRecordingSpeakers } from './recordingSpeakers'
import { initializeLocation, startLocation, stopLocation, locationHeartbeat, setLocationEnabled } from './locationTracking'
import { createVoiceCaptureFeedback } from '../voice/voiceCaptureFeedback'
import { createCloudSpeechPlayer, type SpeechAudio } from './cloudSpeech'
import { createFeedbackPlayer } from './create-feedback-player'
import { createSharedRecordingSource } from '../chat/audio/shared-recording-source'
import { canSpeakFeedback, notificationSpeechKind } from './feedback'
import i18n from '../../config/i18n'
// @arch docs/features/personal-modules.md
// @test src/__tests__/personal-modules.test.ts
import { createRecordingSync } from './recordingSync'
import * as Crypto from 'expo-crypto'
import { AppState, Platform } from 'react-native'
import { useAuthStore } from '../../config/auth'
import { authApi } from '../../config/api'
import { createPcmRecorder } from '../chat/audio/create-pcm-recorder'
import { PersonalModuleStore } from './localStore'
import { EnergyGate } from './energyGate'
import { recordingSegment } from './segment'
import { DurableRecognition } from './durableRecognition'
import { recognitionStorage } from './recognitionStorage'
import { defaultListeningPreferences, type ListeningPreferences, localDay, type Prompt } from './types'
import { appendAudio, audioBatchMs, currentRecordingTarget, finishAudioBatch, recoverAudioBatches, startAudioBatch, syncAudioBatches, type Target } from './audioArchive'
export { useRecordingState } from './recordingState'
import { useRecordingState } from './recordingState'
const captureFeedback = createVoiceCaptureFeedback()
let local: PersonalModuleStore | null = null
let opening: { userId: string; promise: Promise<PersonalModuleStore> } | null = null
let requestedAccount: string | null = null
let sessionKey: string | null = null
let sharedSource: ReturnType<typeof createSharedRecordingSource> | null = null
let recorder: ReturnType<typeof createPcmRecorder> | null = null
let recognition: DurableRecognition | null = null
let recognitionClosing: Promise<void> = Promise.resolve()
let storeGeneration = 0
let detach: Array<() => void> = []
let gate = new EnergyGate()
let writeChain: Promise<unknown> = Promise.resolve()
let audioChain: Promise<void> = Promise.resolve()
type CapturedFrame = { frame: Uint8Array; at: number; suppress: boolean }
let audioFrames: CapturedFrame[] = []
let currentAudio: { key: string; sessionKey: string; startAt: string; bytes: number } | null = null
let audioTarget: Target | null = null
let audioQueued = 0
let audioFailed = false
let stoppingPromise: Promise<void> | null = null
let timer: ReturnType<typeof setInterval> | null = null
let analysisAt = 0
let listeningAt = 0
let listeningDirty = false
let listeningAnalyzing = false
let lastFeedbackAt = 0
let englishFeedbackEpoch = 0
let speaking = false
let suppressUntil = 0
let quietSince = Date.now()
let latestFrameAt = 0
type SpokenItem = { key: string; text: string; expiresAt: number; promptKey?: string; kind?: 'reminder' }
const spokenQueue: SpokenItem[] = []
const speechPlayer = createCloudSpeechPlayer(createFeedbackPlayer)
let speechEpoch = 0
let speechPreparing = false
let playingPromptKey: string | null = null
let preparedSpeech: { item: SpokenItem; audio: SpeechAudio } | null = null
function cancelFeedback() {
  speechEpoch++
  speechPreparing = false
  preparedSpeech = null
  playingPromptKey = null
  speaking = false
  suppressUntil = Date.now() + 500
  return speechPlayer.stop().catch(() => {})
}
const seenNotifications = new Set<string>()
export function offerRecordingNotification(
  key: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
) {
  if (!useRecordingState.getState().active) return
  const kind = notificationSpeechKind(data)
  if (kind === null) return
  const identity = key || `${title}:${body}`
  if (seenNotifications.has(identity)) return
  seenNotifications.add(identity)
  if (seenNotifications.size > 200)
    seenNotifications.delete(seenNotifications.values().next().value!)
  // Only calendar reminders may surface or speak during recording.
  const summary = i18n.t('personal_spoken_reminder')
  useRecordingState.setState({ notification: [title, body].filter(Boolean).join(' · ') })
  if (useRecordingState.getState().preferences.feedback === 'silent') return
  spokenQueue.push({ key: identity, text: summary, kind, expiresAt: Date.now() + 60000 })
  while (spokenQueue.length > 5) spokenQueue.shift()
}
export async function setRecordingReadAloud(value: boolean) {
  await (await moduleStore()).cache('read-aloud', value)
  useRecordingState.setState({ readAloud: value })
  if (!value) {
    spokenQueue.splice(0)
    await cancelFeedback()
  }
}
export function clearEnglishFeedback() {
  englishFeedbackEpoch++
  useRecordingState.setState({ prompt: null })
  if (preparedSpeech?.item.promptKey) preparedSpeech = null
  if (playingPromptKey) void cancelFeedback()
  for (let i = spokenQueue.length - 1; i >= 0; i--)
    if (spokenQueue[i]!.promptKey) spokenQueue.splice(i, 1)
}
function speakAtPause() {
  const state = useRecordingState.getState(), preferences = state.preferences
  if (preferences.feedback === 'silent' || !state.active || !state.readAloud) return
  for (let i = spokenQueue.length - 1; i >= 0; i--) if (spokenQueue[i]!.expiresAt < Date.now()) spokenQueue.splice(i, 1)
  if (preparedSpeech && preparedSpeech.item.expiresAt < Date.now()) preparedSpeech = null
  const notification = spokenQueue.findIndex(item => !item.promptKey)
  if (notification > 0) spokenQueue.unshift(spokenQueue.splice(notification, 1)[0]!)
  if (sharedSource?.borrowed || speaking || speechPreparing) return
  if (!preparedSpeech) {
    if (spokenQueue[0]?.promptKey && Date.now() - lastFeedbackAt < (preferences.feedback === 'active' ? 180000 : 600000)) return
    const item = spokenQueue.shift(), accountId = useAuthStore.getState().user?.id
    if (!item || !accountId) return
    const generation = speechEpoch, englishEpoch = englishFeedbackEpoch
    speechPreparing = true
    // Synthesis happens while capture/recognition continue; suppress only actual
    // playback, never the network wait. Do not send private notification bodies.
    void authApi<SpeechAudio>('/personal-modules/recording/speech', {
      method: 'POST', body: JSON.stringify({ promptKey: item.promptKey, kind: item.kind, language: i18n.language.startsWith('zh') ? 'zh' : 'en' }),
    }, { timeoutMs: 30000 }).then(audio => {
      if (generation !== speechEpoch || useAuthStore.getState().user?.id !== accountId || (item.promptKey && englishEpoch !== englishFeedbackEpoch)) return
      if (item.expiresAt > Date.now()) preparedSpeech = { item, audio }
    }).catch(() => {
      if (generation === speechEpoch && useAuthStore.getState().user?.id === accountId)
        useRecordingState.setState({ error: 'speech_unavailable' })
    }).finally(() => { if (generation === speechEpoch) speechPreparing = false })
    return
  }
  if (!canSpeakFeedback({ active: state.active, enabled: state.readAloud, speaking, userSpeaking: gate.active, quietSince, lastFrameAt: latestFrameAt, now: Date.now() })) return
  const { item, audio } = preparedSpeech
  preparedSpeech = null
  const generation = lifecycle, accountId = useAuthStore.getState().user?.id, playbackEpoch = speechEpoch
  const spokenStore = local, spokenSession = sessionKey
  let spokenAt: number | null = null
  recognition?.boundary()
  speaking = true
  playingPromptKey = item.promptKey ?? null
  gate.reset()
  const done = () => {
    if (generation !== lifecycle || playbackEpoch !== speechEpoch) return
    speaking = false
    playingPromptKey = null
    suppressUntil = Date.now() + 500
    quietSince = Date.now()
    gate.reset()
  }
  void speechPlayer.play(audio, () => {
    if (generation !== lifecycle || playbackEpoch !== speechEpoch || useAuthStore.getState().user?.id !== accountId) return
    done()
    if (spokenAt !== null && spokenStore && spokenSession) {
      const at = spokenAt
      write(() => spokenStore.saveTranscript({
        key: `${new Date(at).toISOString()}:${Crypto.randomUUID()}`,
        sessionKey: spokenSession, revision: 1, kind: 'recording-feedback', speaker: 'assistant',
        startAt: new Date(at).toISOString(), endAt: new Date().toISOString(),
        day: localDay(new Date(at)), timezone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
        text: audio.text || item.text,
      }))
    }
    if (item.promptKey) {
      lastFeedbackAt = Date.now()
      void authApi(`/personal-modules/english/prompts/${item.promptKey}/played`, { method: 'POST', body: '{}' }).catch(() => {})
    }
  }, () => {
    done()
    if (generation === lifecycle && playbackEpoch === speechEpoch)
      useRecordingState.setState({ error: 'speech_unavailable' })
  }, () => { spokenAt = Date.now() })
}

const changed = () => useRecordingState.setState((s) => ({ revision: s.revision + 1 }))
function write(work: () => Promise<unknown>) {
  writeChain = writeChain
    .then(work)
    .then(changed)
    .catch(() => {
      useRecordingState.setState({ error: 'local_save_failed' })
      void stopRecording()
    })
}
export async function moduleStore(): Promise<PersonalModuleStore> {
  const userId = useAuthStore.getState().user?.id
  if (!userId) throw new Error('not_authenticated')
  if (local?.userId === userId && recognition) return local
  if (opening?.userId === userId) return opening.promise
  const generation = storeGeneration
  const promise = (async () => {
    await recognitionClosing
    const opened = await PersonalModuleStore.open(userId)
    if (useAuthStore.getState().user?.id !== userId) throw new Error('account_changed')
    await initializeLocation(userId).catch(() => {})
    const previous = await opened.cached<{ key: string; startAt: string }>('active-session')
    await recoverAudioBatches(opened)
    if (previous) {
      await opened.queue(`/recording/sessions/${previous.key}`, 'PATCH', {
        endAt: new Date().toISOString(),
        state: 'interrupted',
      })
      await opened.cache('active-session', null)
    }
    const cachedPreferences = await opened.cached<ListeningPreferences>('listening-preferences')
    if (useAuthStore.getState().user?.id !== userId) throw new Error('account_changed')
    useRecordingState.setState({ readAloud: (await opened.cached<boolean>('read-aloud')) ?? true, preferences: cachedPreferences ?? { ...defaultListeningPreferences } })
    const nextRecognition = createRecognition(opened)
    await nextRecognition.initialize()
    if (generation !== storeGeneration || useAuthStore.getState().user?.id !== userId) {
      await nextRecognition.abort()
      throw new Error('account_changed')
    }
    local = opened
    recognition = nextRecognition
    return opened
  })()
  opening = { userId, promise }
  try {
    return await promise
  } finally {
    if (opening?.promise === promise) opening = null
  }
}
const syncRecordingData = createRecordingSync({
  store: moduleStore,
  account: () => useAuthStore.getState().user?.id,
  update: patch => useRecordingState.setState(patch),
  cloud: async store => {
    await writeChain
    await store.flush()
    let cursor: string | null = null
    do {
      const deleted: { days: string[]; nextCursor: string | null } = await authApi(
        `/personal-modules/recording/deleted-days${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      )
      if (useAuthStore.getState().user?.id !== store.userId) return
      for (const day of deleted.days) await store.applyDeletedDay(day)
      if (deleted.days.length) changed()
      cursor = deleted.nextCursor
    } while (cursor)
  },
  archive: async (store, pending) => {
    const target = await currentRecordingTarget()
    if (useAuthStore.getState().user?.id !== store.userId) return
    if (target) await store.cache('recording-target', target)
    useRecordingState.setState({ targetMachineId: target?.machineId ?? null })
    if (!pending.audio) { useRecordingState.setState({ targetChanged: false }); return }
    const status = await syncAudioBatches(store, target)
    if (useAuthStore.getState().user?.id !== store.userId) return
    useRecordingState.setState({ targetChanged: status === 'target_changed' })
    if (status === 'target_changed') throw new Error(target ? 'recording_target_changed' : 'primary_machine_required')
  },
  preferences: async store => {
    const preferences = await authApi<ListeningPreferences>('/personal-modules/recording/preferences')
    if (useAuthStore.getState().user?.id !== store.userId) return
    await store.cache('listening-preferences', preferences)
    useRecordingState.setState({ preferences, readAloud: preferences.feedback !== 'silent' })
  },
})
let englishSync: Promise<void> | null = null
export async function syncModules() {
  recognition?.tick()
  // Each channel has its own lock: a slow/offline computer cannot hold up text.
  const syncing = syncRecordingData()
  if (!englishSync) englishSync = syncEnglishFeedback().finally(() => { englishSync = null })
  await Promise.all([syncing, englishSync])
}
async function syncEnglishFeedback() {
  const state = useRecordingState.getState()
  if (!state.active || state.preferences.mode !== 'assist' || Date.now() - analysisAt <= 60000) return
  analysisAt = Date.now()
  const accountId = useAuthStore.getState().user?.id, generation = lifecycle
  try {
    const english = await authApi<{ enabled: boolean }>('/personal-modules/english/preferences')
    if (!english.enabled || accountId !== useAuthStore.getState().user?.id || generation !== lifecycle) return
    const promptEpoch = englishFeedbackEpoch
    const result = await authApi<{ prompt: Prompt | null }>('/personal-modules/english/analyze', { method: 'POST', body: '{}' })
    if (accountId !== useAuthStore.getState().user?.id || generation !== lifecycle || !useRecordingState.getState().active || useRecordingState.getState().preferences.mode !== 'assist' || promptEpoch !== englishFeedbackEpoch || !result.prompt) return
    useRecordingState.setState({ prompt: result.prompt })
    if (useRecordingState.getState().preferences.feedback !== 'silent') spokenQueue.push({ key: result.prompt.key, text: result.prompt.text, promptKey: result.prompt.key, expiresAt: Date.parse(result.prompt.expiresAt) })
  } catch {
    // Optional English analysis failure is not a recording-upload failure.
    if (accountId === useAuthStore.getState().user?.id && generation === lifecycle) useRecordingState.setState({ analysisError: true })
  }
}
export async function confirmRecordingOldTarget() {
  const store = await moduleStore()
  const current = await currentRecordingTarget()
  if (!current) throw new Error('primary_machine_required')
  await store.confirmOldAudioTarget(current.revision)
  useRecordingState.setState({ targetChanged: false })
  void syncModules()
}
function processLiveFrame(item: CapturedFrame) {
  // Energy is only a feedback/quietness signal, never an ASR upload gate.
  if (item.suppress) { quietSince = item.at; return }
  for (const event of gate.consume(item.frame, item.at))
    if (event.type === 'end') quietSince = item.at
  // Playback closes the preceding speech window. Resume a fresh human window
  // afterwards so one cumulative microphone row cannot span both sides of AI.
  recognition?.send(item.frame, item.at)
}
function persistAudio(store: PersonalModuleStore, frames: CapturedFrame[], batch: NonNullable<typeof currentAudio>) {
  audioQueued++
  audioChain = audioChain.then(async () => {
    if (audioFailed) return
    await appendAudio(store, batch, frames.map(item => item.frame))
  }).catch((error) => {
    audioFailed = true
    void store.markAudioFailed(batch.key)
    useRecordingState.setState({ error: error instanceof Error && /space|quota|full/i.test(error.message) ? 'storage_full' : 'local_save_failed' })
    void stopRecording()
  }).finally(() => { audioQueued-- })
  if (audioQueued > 100) {
    audioFailed = true
    void store.markAudioFailed(batch.key)
    useRecordingState.setState({ error: 'storage_full' })
    void stopRecording()
  }
}
function flushAudioFrames(store: PersonalModuleStore) {
  if (!currentAudio || !audioFrames.length) return
  const frames = audioFrames
  audioFrames = []
  persistAudio(store, frames, currentAudio)
}
function consumeAudioFrame(store: PersonalModuleStore, frame: Uint8Array, at: number) {
  const batch = currentAudio
  if (!batch || !audioTarget) return
  if (Date.now() - Date.parse(batch.startAt) >= audioBatchMs) {
    flushAudioFrames(store)
    const next = { key: Crypto.randomUUID(), sessionKey: batch.sessionKey, startAt: new Date().toISOString(), bytes: 0 }
    const target = audioTarget
    audioChain = audioChain.then(async () => {
      await finishAudioBatch(store, batch, next.startAt)
      await startAudioBatch(store, next.sessionKey, target, next.key, next.startAt)
    }).catch(() => { useRecordingState.setState({ error: 'local_save_failed' }); void stopRecording() })
    currentAudio = next
  }
  audioFrames.push({ frame: frame.slice(), at, suppress: speaking || at < suppressUntil })
  if (audioFrames.length >= 5) flushAudioFrames(store)
}
function createRecognition(store: PersonalModuleStore) {
  const storage = recognitionStorage(store)
  return new DurableRecognition({
    storage,
    enrich: (job, transcript) => enrichRecordingSpeakers(store, storage, job, transcript),
    key: () => Crypto.randomUUID(),
    valid: () => requestedAccount === store.userId && useAuthStore.getState().user?.id === store.userId,
    open: (job, events) => {
      const token = useAuthStore.getState().token
      if (!token || useAuthStore.getState().user?.id !== store.userId) throw new Error('account_changed')
      return recordingSegment({ token, sessionKey: job.sessionKey, key: job.key, startAt: job.startAt, ...events })
    },
    partial: (job, text) => {
      if (useAuthStore.getState().user?.id !== store.userId || job.sessionKey !== sessionKey || (job.day ?? localDay(new Date(job.startAt))) !== localDay(new Date())) return
      useRecordingState.setState({ liveTranscriptKey: job.key, partial: text.slice(-600), finalText: '' })
    },
    waiting: waiting => {
      if (useAuthStore.getState().user?.id !== store.userId) return
      useRecordingState.setState({ recognitionPending: waiting })
      listeningDirty = true
      changed()
    },
    fatal: error => {
      if (useAuthStore.getState().user?.id !== store.userId) return
      useRecordingState.setState({ error: error instanceof Error && /space|quota|full|backlog/i.test(error.message) ? 'storage_full' : 'local_save_failed' })
      void stopRecording()
    },
  })
}

let lifecycle = 0
export async function startRecording(expectedTarget?: Target) {
  const state = useRecordingState.getState()
  if (state.active || state.starting || state.stopping) return
  useRecordingState.setState({ starting: true, error: null, analysisProvider: 'none', analysisError: false, partial: '', finalText: '', liveTranscriptKey: null })
  const userId = useAuthStore.getState().user?.id
  const generation = ++lifecycle
  try {
    if (Platform.OS === 'web') throw new Error('native_recording_required')
    const store = await moduleStore()
    let target: Target | null = null
    try { target = await currentRecordingTarget(); if (target) await store.cache('recording-target', target) }
    catch { target = await store.cached<Target>('recording-target') }
    if (!target) throw new Error('primary_machine_required')
    if (expectedTarget && (target.machineId !== expectedTarget.machineId || target.revision !== expectedTarget.revision)) throw new Error('primary_machine_changed')
    useRecordingState.setState({ targetMachineId: target.machineId })
    recorder = createPcmRecorder({ sampleRate: 16000, frameDurationMs: 40, voiceChat: false })
    if (!(await recorder.requestPermission())) throw new Error('microphone_permission_denied')
    if (
      useAuthStore.getState().user?.id !== userId ||
      requestedAccount !== userId ||
      lifecycle !== generation
    )
      throw new Error('account_changed')
    const key = Crypto.randomUUID(),
      startAt = new Date().toISOString()
    await store.queue('/recording/sessions', 'POST', { key, startAt }, { kind: 'session', key })
    await store.cache('active-session', { key, startAt })
    sessionKey = key
    audioFailed = false
    audioTarget = target
    currentAudio = await startAudioBatch(store, key, target, Crypto.randomUUID(), startAt)
    gate = new EnergyGate()
    recognition!.begin(key)
    detach = [
      recorder.onFrame((frame) => {
        if (requestedAccount !== store.userId || useAuthStore.getState().user?.id !== store.userId) return
        const at = Date.now()
        if (sessionKey) void locationHeartbeat(store.userId, sessionKey)
        latestFrameAt = at
        consumeAudioFrame(store, frame, at)
        processLiveFrame({ frame, at, suppress: speaking || at < suppressUntil })
        if (!speaking && at >= suppressUntil) sharedSource?.publish(frame)
      }),
      recorder.onError(() => {
        useRecordingState.setState({ error: 'recording_interrupted' })
        void stopRecording()
      }),
    ]
    await recorder.start()
    if (
      useAuthStore.getState().user?.id !== userId ||
      requestedAccount !== userId ||
      lifecycle !== generation
    ) {
      await stopRecording()
      return
    }
    listeningAt = 0
    analysisAt = 0
    quietSince = Date.now()
    latestFrameAt = Date.now()
    sharedSource = createSharedRecordingSource()
    useRecordingState.setState({ active: true })
    captureFeedback.start()
    await startLocation(store.userId, key).catch(() => {})
    void syncModules()
  } catch (error) {
    await stopRecording()
    useRecordingState.setState({
      error: error instanceof Error ? /space|quota|full/i.test(error.message) ? 'storage_full' : error.message : 'recording_failed',
    })
  } finally {
    useRecordingState.setState({ starting: false })
  }
}
export function stopRecording(): Promise<void> {
  captureFeedback.end()
  if (stoppingPromise) return stoppingPromise
  stoppingPromise = finishRecording().finally(() => { stoppingPromise = null; useRecordingState.setState({ stopping: false }) })
  return stoppingPromise
}
async function finishRecording() {
  const stoppingRecognition = recognition
  lifecycle++
  sharedSource?.close()
  sharedSource = null
  const saved = local,
    sid = sessionKey
  useRecordingState.setState({ stopping: true })
  const stoppingLocation = stopLocation().catch(() => {})
  spokenQueue.splice(0)
  await cancelFeedback()
  useRecordingState.setState({ active: false, prompt: null })
  const current = recorder
  recorder = null
  try { await current?.stop() }
  catch { useRecordingState.setState({ error: 'recording_interrupted' }) }
  // Keep the frame listener until native stop settles: frames delivered during
  // the stop transition still belong to this batch and must join the short tail.
  detach.forEach((fn) => fn())
  detach = []
  await stoppingRecognition?.finish()
  if (saved) {
    flushAudioFrames(saved)
    await audioChain
    const batch = currentAudio
    currentAudio = null
    audioTarget = null
    if (batch) {
      try { await finishAudioBatch(saved, batch, new Date().toISOString()) }
      catch { useRecordingState.setState({ error: 'local_save_failed' }) }
      if (audioFailed) await saved.markAudioFailed(batch.key).catch(() => { useRecordingState.setState({ error: 'local_save_failed' }) })
    }
  }
  await stoppingLocation
  sessionKey = null
  gate.reset()
  if (saved && sid) {
    write(() =>
      saved.queue(`/recording/sessions/${sid}`, 'PATCH', {
        endAt: new Date().toISOString(),
        state: 'stopped',
      }),
    )
    await saved.cache('active-session', null)
  }
  void syncModules()
}
export function mountPersonalModules() {
  requestedAccount = useAuthStore.getState().user?.id ?? null
  if (requestedAccount) {
    void syncModules()
    timer = setInterval(() => {
      speakAtPause()
      void analyzeRecording()
      if (Date.now() % 15000 < 1000) void syncModules()
    }, 1000)
  }
  const foreground = AppState.addEventListener('change', (value) => {
    if (value === 'active') void syncModules()
  })
  return () => {
    requestedAccount = null
    listeningDirty = false
    lastFeedbackAt = 0
    seenNotifications.clear()
    if (timer) clearInterval(timer)
    timer = null
    storeGeneration++
    const stopping = stopRecording()
    const previousRecognition = recognition
    recognition = null
    recognitionClosing = Promise.all([stopping, previousRecognition?.abort()]).then(() => {})
    foreground.remove()
    useRecordingState.setState({ preferences: { ...defaultListeningPreferences }, recognitionPending: false, analysisError: false, analysisProvider: 'none', partial: '', finalText: '', liveTranscriptKey: null, prompt: null, pending: 0, error: null, syncError: null, archiveError: null, assistanceAvailable: null, targetChanged: false, targetMachineId: null })
  }
}

export async function setListeningPreferences(preferences: ListeningPreferences) {
  const store = await moduleStore()
  const next = await authApi<ListeningPreferences>('/personal-modules/recording/preferences', { method: 'PATCH', body: JSON.stringify(preferences) })
  if (useAuthStore.getState().user?.id !== store.userId) return
  await store.cache('listening-preferences', next)
  await store.cache('read-aloud', next.feedback !== 'silent')
  useRecordingState.setState({ preferences: next, readAloud: next.feedback !== 'silent', analysisError: false, analysisProvider: 'none' })
  if (next.mode !== 'assist' || next.feedback === 'silent') {
    clearEnglishFeedback()
    spokenQueue.splice(0)
    await cancelFeedback()
  }
}
async function analyzeRecording() {
  const state = useRecordingState.getState()
  if (!state.active || state.preferences.mode !== 'assist' || !listeningDirty || listeningAnalyzing || Date.now() - listeningAt < 12000) return
  const accountId = useAuthStore.getState().user?.id, generation = lifecycle
  if (!accountId) return
  listeningAnalyzing = true
  listeningAt = Date.now()
  listeningDirty = false
  try {
    const store = await moduleStore()
    await writeChain
    await store.flush()
    const context = state.preferences.agentContext && state.targetMachineId
      ? await import('./listeningContext').then(m => m.readListeningContext(accountId, state.targetMachineId!)).catch(() => null) : null
    if (accountId !== useAuthStore.getState().user?.id || generation !== lifecycle) return
    const result = await authApi<{ status: string; count: number; decision?: { provider: string } }>('/personal-modules/recording/analyze', { method: 'POST', body: JSON.stringify({ sessionKey, context }) })
    if (accountId !== useAuthStore.getState().user?.id || generation !== lifecycle) return
    if (['cooldown', 'busy', 'settings_changed'].includes(result.status)) listeningDirty = true
    useRecordingState.setState({ analysisError: false, ...(result.decision ? { analysisProvider: result.decision.provider === 'decision-model-preview' ? 'decision' as const : 'fallback' as const } : {}) })
    changed()
  } catch {
    if (accountId === useAuthStore.getState().user?.id && generation === lifecycle) {
      listeningDirty = true
      useRecordingState.setState({ analysisError: true, analysisProvider: 'none' })
    }
  } finally { listeningAnalyzing = false }
}

export async function setRecordingLocation(enabled: boolean) {
  const account = useAuthStore.getState().user?.id
  if (!account) return
  await moduleStore()
  await setLocationEnabled(account, enabled, useRecordingState.getState().active ? sessionKey ?? undefined : undefined)
}
