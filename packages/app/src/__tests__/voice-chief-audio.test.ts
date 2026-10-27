// @covers packages/app/modules/expo-pcm-recorder/ios/ExpoPcmRecorderModule.swift

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const appRoot = join(__dirname, '../..')

describe('Voice Chief native PCM audio bridge', () => {
  it('converts iOS microphone input through Float32 before emitting PCM16 frames', () => {
    const swift = readFileSync(
      join(appRoot, 'modules/expo-pcm-recorder/ios/ExpoPcmRecorderModule.swift'),
      'utf8',
    )

    expect(swift).toContain('commonFormat: .pcmFormatFloat32')
    expect(swift).toContain('let littleEndian = UInt16(bitPattern: intSample).littleEndian')
    expect(swift).not.toContain('commonFormat: .pcmFormatInt16')
    expect(swift).toContain('category: "VoiceChiefAudio"')
    expect(swift).toContain('microphone PCM emitted')
    expect(swift).toContain('#if DEBUG')
    expect(swift).toContain('startRecordingWithRetry(')
    expect(swift).toContain('recording start waiting for stable audio input')
    expect(swift).toContain('inputNode.installTap(onBus: 0, bufferSize: 1024, format: nil)')
    expect(swift).toContain('converterForInputBuffer(buffer, target: target)')
    expect(swift).toContain('microphone converter ready')
    expect(swift).not.toContain(
      'let sourceConverter = AVAudioConverter(from: inputFormat, to: target)',
    )
  })

  it('prepares iOS playback before starting the shared full-duplex engine', () => {
    const swift = readFileSync(
      join(appRoot, 'modules/expo-pcm-recorder/ios/ExpoPcmRecorderModule.swift'),
      'utf8',
    )
    const hook = readFileSync(
      join(appRoot, 'src/features/voice-chief/useVoiceChiefCall.native.ts'),
      'utf8',
    )

    expect(hook.indexOf('await player.start(frame.outputSampleRate)')).toBeGreaterThan(0)
    expect(hook.indexOf('await player.start(frame.outputSampleRate)')).toBeLessThan(
      hook.indexOf('await recorder.start()'),
    )
    expect(swift).toContain('playback prepared')
    expect(swift).toContain('if recordingRunning')
    expect(swift).toContain('setVoiceProcessingEnabled(options.voiceChat)')
    expect(hook).toContain('[voice-chief]')
    expect(hook).toContain("logVoiceChief('model_audio'")
    expect(hook).toContain('socketHeartbeatTimerRef')
    expect(hook).toContain('clearInterval(socketHeartbeatTimerRef.current)')
    expect(hook).toContain('delayedHangupTimerRef')
    expect(hook).toContain('clearTimeout(delayedHangupTimerRef.current)')
    expect(hook).toContain('if (disposed || !isCurrentSocket())')
    expect(hook).not.toContain('argumentsJson: frame.call.argumentsJson')
  })

  it('waits for valid iOS hardware formats before enabling voice processing', () => {
    const swift = readFileSync(
      join(appRoot, 'modules/expo-pcm-recorder/ios/ExpoPcmRecorderModule.swift'),
      'utf8',
    )

    const formatGuard = swift.indexOf('Self.isUsableHardwareFormat(initialInputFormat)')
    const voiceProcessing = swift.indexOf('setVoiceProcessingEnabled(options.voiceChat)')

    expect(formatGuard).toBeGreaterThan(0)
    expect(formatGuard).toBeLessThan(voiceProcessing)
    expect(swift).toContain('Self.isUsableHardwareFormat(initialOutputFormat)')
    expect(swift).toContain('Self.isUsableHardwareFormat(pendingInputFormat)')
    expect(swift).toContain('Self.isUsableHardwareFormat(pendingOutputFormat)')
    expect(swift).toContain('format.sampleRate > 0 && format.channelCount > 0')
    expect(swift).toContain('PcmRecorderError.inputFormatNotReady')
  })

  it('keeps iOS voice calls alive across lock-screen audio session changes', () => {
    const swift = readFileSync(
      join(appRoot, 'modules/expo-pcm-recorder/ios/ExpoPcmRecorderModule.swift'),
      'utf8',
    )
    const appJson = readFileSync(join(appRoot, 'app.json'), 'utf8')

    expect(appJson).toContain('"audio"')
    expect(swift).toContain('import UIKit')
    expect(swift).toContain('UIApplication.shared.isIdleTimerDisabled = true')
    expect(swift).toContain('UIApplication.shared.isIdleTimerDisabled = false')
    expect(swift).toContain('AVAudioSession.interruptionNotification')
    expect(swift).toContain('AVAudioSession.routeChangeNotification')
    expect(swift).toContain('AVAudioSession.mediaServicesWereResetNotification')
    expect(swift).toContain('private var keepAliveNode = AVAudioPlayerNode()')
    expect(swift).toContain('startSilentKeepAlive(format: format)')
    expect(swift).toContain('keepAliveNode.scheduleBuffer(buffer, at: nil, options: .loops)')
    expect(swift).toContain('silent keepalive started')
    expect(swift).toContain('stopSilentKeepAlive()')
    expect(swift).toContain('recoverAudioSession(reason:')
    expect(swift).toContain('recoverAudioSessionIfStopped(reason: "route_changed"')
    expect(swift).toContain('audio graph retained reason=')
    expect(swift).not.toContain('recoverAudioSession(reason: "route_changed", delay: 0.25)')
    expect(swift).toContain('audio_session_recovery_failed')
    expect(swift).toContain('startInputWatchdog()')
    expect(swift).toContain('input_watchdog_stall')
    expect(swift).toContain('restartRecordingPipeline(options:')
    expect(swift).toContain('rebuildAudioGraph()')
    expect(swift).toContain('UIApplication.didEnterBackgroundNotification')
    expect(swift).toContain('background audio retained')
    expect(swift).toContain('application_backgrounded_engine_stopped')
    expect(swift).not.toContain('recoverAudioSession(reason: "application_backgrounded",')
    expect(swift).toContain('try session.setActive(true')
    expect(swift).not.toContain('CallKit')
    expect(swift).not.toContain('ShennianVoiceCall')
    expect(swift).not.toContain('.mixWithOthers')
    expect(swift).toContain('NotificationCenter.default.removeObserver(self)')
  })

  it('uses the system audio route by default so headphones remain selected', () => {
    const hook = readFileSync(
      join(appRoot, 'src/features/voice-chief/useVoiceChiefCall.native.ts'),
      'utf8',
    )
    const screen = readFileSync(
      join(appRoot, 'src/features/voice-chief/VoiceChiefScreen.tsx'),
      'utf8',
    )
    const android = readFileSync(
      join(
        appRoot,
        'modules/expo-pcm-recorder/android/src/main/java/expo/modules/pcmrecorder/ExpoPcmRecorderModule.kt',
      ),
      'utf8',
    )

    expect(hook).toContain("useState<PcmOutputRoute>('system')")
    expect(hook).toContain("useRef<PcmOutputRoute>('system')")
    expect(hook).toContain('await player.setOutputRoute(outputRouteRef.current)')
    expect(hook).not.toContain("await player.setOutputRoute('speaker')")
    expect(screen).toContain("call.outputRoute === 'speaker' ? 'system' : 'speaker'")
    expect(android).toContain('manager.clearCommunicationDevice()')
    expect(android).toContain('TYPE_BUILTIN_SPEAKER')
  })

  it('does not register VoIP system-call tokens', () => {
    const swift = readFileSync(
      join(appRoot, 'modules/expo-pcm-recorder/ios/ExpoPcmRecorderModule.swift'),
      'utf8',
    )
    const js = readFileSync(join(appRoot, 'modules/expo-pcm-recorder/src/index.ts'), 'utf8')
    const pushHook = readFileSync(join(appRoot, 'src/hooks/usePushNotifications.ts'), 'utf8')

    expect(swift).not.toContain('getVoipPushToken')
    expect(swift).not.toContain('ShennianIncomingCall')
    expect(js).not.toContain('getNativeVoipPushToken')
    expect(pushHook).not.toContain("'apns-voip'")
    expect(pushHook).not.toContain('tokenPreview')
  })

  it('handles model-initiated hang up frames by ending the current call', () => {
    const hook = readFileSync(
      join(appRoot, 'src/features/voice-chief/useVoiceChiefCall.native.ts'),
      'utf8',
    )
    const screen = readFileSync(
      join(appRoot, 'src/features/voice-chief/VoiceChiefScreen.tsx'),
      'utf8',
    )

    expect(hook).toContain("case 'hang_up'")
    expect(hook).toContain("logVoiceChief('server_hang_up'")
    expect(hook).not.toContain('createAudioPlayer(HANG_UP_SOUND')
    expect(hook).not.toContain('HANG_UP_SOUND')
    expect(hook).toContain('Vibration.vibrate(HANG_UP_VIBRATION_PATTERN)')
    expect(hook).toContain('void end({ feedback: true })')
    expect(hook).toContain('terminalCloseRef.current = true')
    expect(screen).toContain('await call?.end({ feedback: true })')
    expect(screen).toContain("call?.state !== 'ended'")
    expect(screen).toContain('dismissCall()')
    expect(screen).toContain("router.replace('/(main)')")
  })

  it('declares Android vibration permission for hang-up feedback', () => {
    const config = JSON.parse(readFileSync(join(appRoot, 'app.json'), 'utf8'))
    expect(config.expo.android.permissions).toContain('android.permission.VIBRATE')
  })

  it('keeps a voice call alive by reconnecting the websocket instead of surfacing disconnect errors', () => {
    const hook = readFileSync(
      join(appRoot, 'src/features/voice-chief/useVoiceChiefCall.native.ts'),
      'utf8',
    )
    const screen = readFileSync(
      join(appRoot, 'src/features/voice-chief/VoiceChiefScreen.tsx'),
      'utf8',
    )

    expect(hook).toContain("'reconnecting'")
    expect(hook).toContain('socket_reconnect_scheduled')
    expect(hook).toContain('setError(null)')
    expect(hook).toContain('reconnectDelayMs')
    expect(hook).toContain('reconnectAttempt: reconnectAttemptRef.current')
    expect(hook).toContain("timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone")
    expect(hook).toContain('terminalCloseRef.current || !isCurrentSocket()')
    expect(hook).toContain('!terminalCloseRef.current')
    expect(hook).toContain('scheduleReconnect(`close:${event.code}`)')
    expect(hook).toContain("socket.send(JSON.stringify({ type: 'ping' }))")
    expect(hook).toContain('VOICE_CHIEF_HEARTBEAT_MS')
    expect(hook).toContain('socketReadyForAudioRef.current')
    expect(hook).toContain('socketReadyForAudioRef.current = true')
    expect(hook).toContain(
      'socket?.readyState === WebSocket.OPEN &&\n        socketReadyForAudioRef.current',
    )
    expect(hook).toContain('else terminalCloseRef.current = true')
    expect(hook).not.toContain("setError((value) => value || 'voice_chief_connection_closed')")
    expect(screen).toContain("state === 'reconnecting'")
  })

  it('runs voice calls entirely inside the app without system-call bridging', () => {
    const hook = readFileSync(
      join(appRoot, 'src/features/voice-chief/useVoiceChiefCall.native.ts'),
      'utf8',
    )
    const nativeModule = readFileSync(
      join(appRoot, 'modules/expo-pcm-recorder/ios/ExpoPcmRecorderModule.swift'),
      'utf8',
    )

    expect(hook).toContain('connectSocket()')
    expect(hook).not.toContain('NativeSystemCall')
    expect(hook).not.toContain('systemCallAudioReadyPromise')
    expect(nativeModule).not.toContain('SystemCall')
    expect(nativeModule).not.toContain('CallKit')
  })

  it('keeps Android voice calls alive after the screen turns off with a microphone foreground service', () => {
    const android = readFileSync(
      join(
        appRoot,
        'modules/expo-pcm-recorder/android/src/main/java/expo/modules/pcmrecorder/ExpoPcmRecorderModule.kt',
      ),
      'utf8',
    )
    const manifest = readFileSync(
      join(appRoot, 'modules/expo-pcm-recorder/android/src/main/AndroidManifest.xml'),
      'utf8',
    )

    expect(android).toContain('class VoiceChiefForegroundService : Service()')
    expect(android).toContain('ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE')
    expect(android).toContain('PowerManager.PARTIAL_WAKE_LOCK')
    expect(android).toContain('startVoiceForegroundService(context)')
    expect(android).toContain('stopVoiceForegroundService()')
    expect(manifest).toContain('android.permission.FOREGROUND_SERVICE')
    expect(manifest).toContain('android.permission.FOREGROUND_SERVICE_MICROPHONE')
    expect(manifest).toContain('android:foregroundServiceType="microphone"')
  })
})
