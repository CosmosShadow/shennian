// @covers packages/app/src/features/voice-chief/VoiceChiefScreen.tsx

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Voice Chief navigation', () => {
  it('replaces to the project list after hangup and does not render a duplicate collapse affordance', () => {
    const source = readFileSync(
      join(__dirname, '../features/voice-chief/VoiceChiefScreen.tsx'),
      'utf8',
    )

    expect(source).toContain('const router = useRouter()')
    expect(source).toContain("router.replace('/(main)')")
    expect(source).toContain('finally {')
    expect(source).toContain('dismissCall()')
    expect(source).toContain('const startRequestedRef = useRef(false)')
    expect(source).toContain('startRequestedRef.current || hangingUpRef.current')
    expect(source).toContain('startRequestedRef.current = true')
    expect(source).not.toContain('router.back()')
    expect(source).not.toContain('useGoBack')
    expect(source).not.toContain('chevron-down')
    expect(source).not.toContain('chevron-down-outline')
  })

  it('keeps the call surface minimal while preserving readable and accessible state', () => {
    const screen = readFileSync(
      join(__dirname, '../features/voice-chief/VoiceChiefScreen.tsx'),
      'utf8',
    )
    const hook = readFileSync(
      join(__dirname, '../features/voice-chief/useVoiceChiefCall.native.ts'),
      'utf8',
    )

    expect(screen).toContain('CallStateOrb')
    expect(screen).toContain('Animated.loop')
    expect(screen).toContain('voice_chief_status_')
    expect(screen).toContain(
      'call?.subtitles ? styles.heroWithSubtitles : styles.heroWithoutSubtitles',
    )
    expect(screen).toContain('heroWithSubtitles')
    expect(screen).toContain('compact={call?.subtitles}')
    expect(screen).toContain('orbStageCompact')
    expect(screen).toContain('statusText={statusText}')
    expect(screen).toContain('accessibilityLabel={statusText}')
    expect(screen).toContain('normalizeVoiceChiefTranscriptDisplay(item.text)')
    expect(screen).not.toContain('styles.statusCompact')
    expect(screen).toContain('styles.status,')
    expect(screen).toContain('showsVerticalScrollIndicator={false}')
    expect(screen).toContain('styles.transcriptSurface')
    expect(screen).toContain('styles.transcriptLine')
    expect(screen).toContain('scrollToEnd({ animated: !reduceMotionEnabled })')
    expect(screen).toContain('...(reduceMotionEnabled ? {} : { transform: [{ scale: outerScale }] })')
    expect(screen).not.toContain('transform: reduceMotionEnabled ? undefined')
    expect(screen).not.toContain('styles.panel')
    expect(screen).not.toContain('styles.transcriptRow')
    expect(screen).toContain('flexGrow: 1')
    expect(screen).not.toContain('name="flash"')
    expect(screen).not.toContain('orbHalo')
    expect(screen).not.toContain('rotate')
    expect(screen).not.toContain('voice_chief_prompt')
    expect(screen).not.toContain('voice_chief_projects_loaded')
    expect(screen).not.toContain('voice_chief_operation_status')
    expect(screen).not.toContain('voice_chief_debug_tools')
    expect(screen).not.toContain('voice_chief_completion_notify_toggle')
    expect(screen).not.toContain('setTaskCompletionNotify')
    expect(hook).not.toContain('taskCompletionNotifyRef')
    expect(hook).not.toContain("type: 'set_task_completion_notify'")
    expect(screen).not.toContain('Switch')
    expect(hook).not.toContain('debugTools: true')
    expect(hook).not.toContain('setDebugTools')
  })
})
