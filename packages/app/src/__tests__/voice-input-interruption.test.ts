// @covers packages/app/src/features/voice/voiceInputInterruption.ts
// @covers packages/app/src/features/chat/hooks/useVoiceDraft.ts
// @covers packages/app/src/features/voice-chief/useVoiceChiefCall.ts

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const appRoot = join(__dirname, '..')

describe('voice input interruption', () => {
  afterEach(() => {
    vi.resetModules()
  })

  it('broadcasts voice-chief microphone ownership to active chat voice drafts', async () => {
    const mod = await import('../features/voice/voiceInputInterruption')
    const listener = vi.fn()
    const unsubscribe = mod.subscribeVoiceInputInterruption(listener)

    mod.notifyVoiceInputInterruption('voice-chief-call-starting')
    expect(listener).toHaveBeenCalledWith('voice-chief-call-starting')
    expect(mod.getVoiceInputInterruptionListenerCountForTest()).toBe(1)

    unsubscribe()
    mod.notifyVoiceInputInterruption('voice-chief-call-starting')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(mod.getVoiceInputInterruptionListenerCountForTest()).toBe(0)
  })

  it('wires voice-chief call startup to interrupt chat dictation without sending', () => {
    const voiceChiefHook = readFileSync(
      join(appRoot, 'features/voice-chief/useVoiceChiefCall.native.ts'),
      'utf8',
    )
    const voiceDraftHook = readFileSync(
      join(appRoot, 'features/chat/hooks/useVoiceDraft.native.ts'),
      'utf8',
    )

    expect(voiceChiefHook).toContain("notifyVoiceInputInterruption('voice-chief-call-starting')")
    expect(voiceDraftHook).toContain('subscribeVoiceInputInterruption')
    expect(voiceDraftHook).toContain('const interruptRecording = useCallback')
    expect(voiceDraftHook).toContain('await teardownWsPath({ stopRecorder: true, resetTranscript: false })')
    expect(voiceDraftHook).toContain('await recorder.stop()')
    expect(voiceDraftHook).toContain("setPhase('idle')")
    expect(voiceDraftHook).not.toContain('interruptRecording().then(handleSend')
    const desktopDraft = readFileSync(join(appRoot, 'features/chat/hooks/useVoiceDraft.web.ts'), 'utf8')
    expect(desktopDraft).toContain('subscribeVoiceInputInterruption(() => { void controller.cancel() })')
    expect(desktopDraft).toContain("document.addEventListener('visibilitychange', hide)")
    expect(desktopDraft).not.toContain('startFallbackRecording')
  })

  it('stops dictation when a conversation becomes inactive or unmounts', () => {
    const native = readFileSync(join(appRoot, 'features/chat/hooks/useVoiceDraft.native.ts'), 'utf8')
    const chat = readFileSync(join(appRoot, 'features/chat/screens/ChatScreen.tsx'), 'utf8')
    const room = readFileSync(join(appRoot, 'features/rooms/RoomConversationScreen.tsx'), 'utf8')

    expect(native).toContain('if (!active) void interruptRecording()')
    expect(native).toContain('useEffect(() => () => { void interruptRecording() }, [interruptRecording])')
    expect(chat).toContain('active: voiceActive,')
    expect(room).toContain('active: conversationActive,')
  })
})
