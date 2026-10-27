// @covers packages/app/src/features/voice-chief/VoiceChiefCallContext.tsx
// @covers packages/app/src/features/voice-chief/VoiceChiefFloatingHost.tsx
// @covers packages/app/src/features/voice-chief/VoiceChiefScreen.tsx
// @covers packages/app/src/features/voice-chief/useAppIsActive.ts

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const appRoot = join(__dirname, '..')

function read(relative: string) {
  return readFileSync(join(appRoot, relative), 'utf8')
}

describe('Voice Chief floating call surface', () => {
  it('keeps the live call outside the voice route so navigation does not hang up', () => {
    const context = read('features/voice-chief/VoiceChiefCallContext.tsx')
    const layout = read('../app/(main)/_layout.tsx')
    const route = read('../app/(main)/voice-chief.tsx')

    expect(context).toContain('VoiceChiefCallProvider')
    expect(context).toContain('VoiceChiefCallRunner')
    expect(context).toContain('useVoiceChiefCall(params)')
    expect(context).toContain("type VoiceChiefMode = 'full' | 'floating'")
    expect(layout).toContain('<VoiceChiefCallProvider>')
    expect(layout).toContain('<VoiceChiefFloatingHost />')
    expect(route).toContain('<VoiceChiefScreen')
  })

  it('minimizes from the full-screen call without ending audio resources', () => {
    const screen = read('features/voice-chief/VoiceChiefScreen.tsx')

    expect(screen).toContain("accessibilityLabel={t('voice_chief_minimize')}")
    expect(screen).toContain('setFloatingCall()')
    expect(screen).toContain('dismissCall()')
    expect(screen).toContain('startRequestedRef.current = true')
    expect(screen).toContain(
      'startCall({ projectHint, incomingCallId, initialPrompt, reason })',
    )
  })

  it('keeps the mobile collapsed call as a draggable circular sound-wave overlay', () => {
    const host = read('features/voice-chief/VoiceChiefFloatingHost.tsx')

    expect(host).toContain('VOICE_CHIEF_COLLAPSED_SIZE')
    expect(host).toContain('PanResponder.create')
    expect(host).toContain('snapVoiceChiefOverlayPosition')
    expect(host).toContain("router.navigate('/(main)/voice-chief')")
    expect(host).toContain('restoreCall()')
    expect(host).toContain('styles.waveCircle')
    expect(host).toContain('styles.waveBar')
    expect(host).toContain('buttonPulse')
    expect(host).toContain('meter.interpolate')
    expect(host).toContain('Animated.loop')
    expect(host).toContain('useNativeDriver: false')
    expect(host).not.toContain('useNativeDriver: true')
    expect(host).not.toContain('call.toggleMute()')
    expect(host).not.toContain('call.end().finally(() => controller.clearCall())')
    expect(host).toContain("!call || mode !== 'floating'")
  })

  it('exposes a PCM meter for dynamic floating wave amplitude', () => {
    const hook = read('features/voice-chief/useVoiceChiefCall.native.ts')
    const context = read('features/voice-chief/VoiceChiefCallContext.tsx')

    expect(hook).toContain('estimatePcm16Level')
    expect(hook).toContain('shouldPublishMeterLevel()')
    expect(hook).toContain('now - lastMeterUpdateAtRef.current < 120')
    expect(hook).toContain('if (!appIsActiveRef.current) return false')
    expect(hook).toContain('meterLevel')
    expect(context).toContain('publishMeter ? call.meterLevel : 0')
  })

  it('stops all call-only visual animation work while iOS is locked', () => {
    const activity = read('features/voice-chief/useAppIsActive.ts')
    const screen = read('features/voice-chief/VoiceChiefScreen.tsx')
    const host = read('features/voice-chief/VoiceChiefFloatingHost.tsx')

    expect(activity).toContain("AppState.currentState === 'active'")
    expect(activity).toContain("AppState.addEventListener('change'")
    expect(screen).toContain('if (!appIsActive || reduceMotionEnabled) return')
    expect(host).toContain(
      "const animateVisuals = floatingVisible && overlayMode === 'collapsed' && appIsActive",
    )
    expect(host).toContain('if (!animateVisuals)')
    expect(host).toContain('meter.stopAnimation()')
  })

})
