// @arch docs/features/voice-shennian.md
// @test packages/app/src/__tests__/voice-chief-audio.test.ts

import AVFoundation
import ExpoModulesCore
import OSLog
import UIKit

/// Full-duplex PCM runtime for Voice Chief:
/// - captures 16 kHz mono PCM16 microphone frames
/// - streams 24 kHz mono PCM16 model audio through AVAudioPlayerNode
public class ExpoPcmRecorderModule: Module {
  private var audioEngine = AVAudioEngine()
  private var playerNode = AVAudioPlayerNode()
  private var keepAliveNode = AVAudioPlayerNode()
  private var playerAttached = false
  private var keepAliveAttached = false
  private var keepAliveRunning = false
  private var playbackReady = false
  private var playbackGeneration: UInt64 = 0
  private var playbackFormat: AVAudioFormat?
  private var converter: AVAudioConverter?
  private var converterInputFormat: AVAudioFormat?
  private var targetFormat: AVAudioFormat?
  private var accumulator = Data()
  private var samplesPerFrame: Int = 640
  private var bytesPerFrame: Int { samplesPerFrame * 2 }
  private var recordingRunning = false
  private var inputBufferCount = 0
  private var emittedFrameCount = 0
  private var playbackChunkCount = 0
  private var audioSessionObserversInstalled = false
  private var idleTimerDisabledByVoiceCall = false
  private var recordingOptions: StartOptions?
  private var recordingStartGeneration: UInt64 = 0
  private var inputWatchdog: DispatchSourceTimer?
  private var lastInputBufferAt = Date.distantPast
  private var interruptionActive = false
  private var recoveryInProgress = false
  private var recoveryFailureCount = 0
  private let queue = DispatchQueue(label: "ai.shennian.expo-pcm-recorder")
  private let logger = Logger(subsystem: "net.shengnian.app", category: "VoiceChiefAudio")

  public func definition() -> ModuleDefinition {
    Name("ExpoPcmRecorder")

    Events("onFrame", "onError", "onPlaybackComplete")

    Function("isAvailable") { () -> Bool in true }

    AsyncFunction("requestPermissions") { () -> [String: Bool] in
      let granted = await Self.requestMicrophonePermission()
      return ["granted": granted]
    }

    AsyncFunction("start") { (options: StartOptions, promise: Promise) in
      self.queue.async {
        self.recordingStartGeneration &+= 1
        self.startRecordingWithRetry(
          options: options,
          promise: promise,
          generation: self.recordingStartGeneration,
          attempt: 0
        )
      }
    }

    AsyncFunction("stop") { (promise: Promise) in
      self.queue.async {
        self.recordingStartGeneration &+= 1
        self.stopRecording()
        promise.resolve()
      }
    }

    AsyncFunction("startPlayback") { (options: PlaybackOptions, promise: Promise) in
      self.queue.async {
        do {
          try self.preparePlayback(options: options)
          promise.resolve()
        } catch {
          self.logger.error("playback start failed: \(error.localizedDescription, privacy: .public)")
          promise.reject(error)
        }
      }
    }

    AsyncFunction("enqueuePlayback") { (payload: PlaybackChunk, promise: Promise) in
      self.queue.async {
        do {
          try self.enqueuePlayback(payload: payload)
          promise.resolve()
        } catch {
          promise.reject(error)
        }
      }
    }

    AsyncFunction("finishPlayback") { (responseId: String, promise: Promise) in
      self.queue.async {
        self.finishPlayback(responseId: responseId)
        promise.resolve()
      }
    }

    AsyncFunction("flushPlayback") { (promise: Promise) in
      self.queue.async {
        self.playbackGeneration &+= 1
        self.playerNode.stop()
        self.playerNode.reset()
        promise.resolve()
      }
    }

    AsyncFunction("stopPlayback") { (promise: Promise) in
      self.queue.async {
        self.stopPlayback()
        promise.resolve()
      }
    }

    AsyncFunction("setOutputRoute") { (route: String, promise: Promise) in
      self.queue.async {
        do {
          try self.setOutputRoute(route)
          promise.resolve()
        } catch {
          promise.reject(error)
        }
      }
    }

    OnDestroy {
      self.queue.sync {
        self.stopRecording()
        self.stopPlayback()
      }
      NotificationCenter.default.removeObserver(self)
    }
  }

  private static func requestMicrophonePermission() async -> Bool {
    if #available(iOS 17.0, *) {
      return await AVAudioApplication.requestRecordPermission()
    }
    return await withCheckedContinuation { continuation in
      AVAudioSession.sharedInstance().requestRecordPermission { granted in
        continuation.resume(returning: granted)
      }
    }
  }

  private func configureSession(voiceChat: Bool, speechPlayback: Bool = false) throws {
    installAudioSessionObserversIfNeeded()
    setIdleTimerDisabled(voiceChat)
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(
      .playAndRecord,
      mode: voiceChat ? .voiceChat : (speechPlayback ? .default : .measurement),
      options: [.defaultToSpeaker, .allowBluetooth, .allowBluetoothA2DP]
    )
    // Capture start/stop feedback must not be suppressed while the mic is active.
    try? session.setAllowHapticsAndSystemSoundsDuringRecording(true)
    try session.setActive(true, options: [.notifyOthersOnDeactivation])
    let outputs = session.currentRoute.outputs.map { $0.portType.rawValue }.joined(separator: ",")
    logger.info("audio session ready sampleRate=\(session.sampleRate) outputs=\(outputs, privacy: .public)")
  }

  private func installAudioSessionObserversIfNeeded() {
    if audioSessionObserversInstalled { return }
    audioSessionObserversInstalled = true
    let center = NotificationCenter.default
    center.addObserver(
      self,
      selector: #selector(handleAudioSessionInterruption(_:)),
      name: AVAudioSession.interruptionNotification,
      object: AVAudioSession.sharedInstance()
    )
    center.addObserver(
      self,
      selector: #selector(handleAudioRouteChange(_:)),
      name: AVAudioSession.routeChangeNotification,
      object: AVAudioSession.sharedInstance()
    )
    center.addObserver(
      self,
      selector: #selector(handleMediaServicesReset(_:)),
      name: AVAudioSession.mediaServicesWereResetNotification,
      object: AVAudioSession.sharedInstance()
    )
    center.addObserver(
      self,
      selector: #selector(handleApplicationDidEnterBackground(_:)),
      name: UIApplication.didEnterBackgroundNotification,
      object: nil
    )
    center.addObserver(
      self,
      selector: #selector(handleApplicationWillEnterForeground(_:)),
      name: UIApplication.willEnterForegroundNotification,
      object: nil
    )
  }

  private func setIdleTimerDisabled(_ disabled: Bool) {
    DispatchQueue.main.async {
      if disabled {
        UIApplication.shared.isIdleTimerDisabled = true
        self.idleTimerDisabledByVoiceCall = true
      } else if self.idleTimerDisabledByVoiceCall {
        UIApplication.shared.isIdleTimerDisabled = false
        self.idleTimerDisabledByVoiceCall = false
      }
    }
  }

  @objc private func handleAudioSessionInterruption(_ notification: Notification) {
    guard
      let rawType = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
      let type = AVAudioSession.InterruptionType(rawValue: rawType)
    else { return }
    logger.info("audio session interruption type=\(rawType)")
    if type == .began {
      queue.async { self.interruptionActive = true }
    } else {
      queue.async { self.interruptionActive = false }
      recoverAudioSession(reason: "interruption_ended")
    }
  }

  @objc private func handleAudioRouteChange(_ notification: Notification) {
    let rawReason = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt ?? 0
    logger.info("audio route changed reason=\(rawReason)")
    recoverAudioSessionIfStopped(reason: "route_changed", delay: 0.25)
  }

  @objc private func handleMediaServicesReset(_ notification: Notification) {
    logger.warning("audio media services reset")
    recoverAudioSession(reason: "media_services_reset", rebuildGraph: true)
  }

  @objc private func handleApplicationDidEnterBackground(_ notification: Notification) {
    logger.info("application entered background during voice call")
    // A running play-and-record session is already entitled to continue because the app
    // declares the audio background mode. Do not tear down a healthy input tap here:
    // iOS permits an active call to continue in the background, but may reject rebuilding
    // its recording graph after the app has been suspended. The input watchdog remains
    // responsible for recovery when microphone buffers actually stop.
    queue.async {
      guard self.recordingRunning || self.playbackReady else { return }
      self.logger.info(
        "background audio retained engineRunning=\(self.audioEngine.isRunning) inputAge=\(Date().timeIntervalSince(self.lastInputBufferAt))"
      )
      if !self.audioEngine.isRunning {
        self.recoverAudioSession(reason: "application_backgrounded_engine_stopped", delay: 0)
      }
    }
  }

  @objc private func handleApplicationWillEnterForeground(_ notification: Notification) {
    logger.info("application entering foreground during voice call")
    recoverAudioSessionIfStopped(reason: "application_foregrounded")
  }

  private func recoverAudioSession(
    reason: String,
    delay: TimeInterval = 0.1,
    rebuildGraph: Bool = false
  ) {
    queue.asyncAfter(deadline: .now() + delay) {
      guard self.recordingRunning || self.playbackReady else { return }
      guard !self.interruptionActive, !self.recoveryInProgress else { return }
      self.recoveryInProgress = true
      defer { self.recoveryInProgress = false }
      do {
        try self.configureSession(voiceChat: self.recordingOptions?.voiceChat ?? true, speechPlayback: self.playbackReady)
        if rebuildGraph {
          try self.rebuildAudioGraph()
        } else if self.recordingRunning, let options = self.recordingOptions {
          try self.restartRecordingPipeline(options: options)
        }
        try self.ensureEngineRunning()
        if self.playbackReady && !self.playerNode.isPlaying {
          self.playerNode.play()
        }
        if self.keepAliveRunning && !self.keepAliveNode.isPlaying {
          self.keepAliveNode.play()
        }
        self.recoveryFailureCount = 0
        self.logger.info("audio session recovered reason=\(reason, privacy: .public) engineRunning=\(self.audioEngine.isRunning)")
      } catch {
        self.recoveryFailureCount += 1
        self.logger.error("audio session recovery failed reason=\(reason, privacy: .public) attempt=\(self.recoveryFailureCount) message=\(error.localizedDescription, privacy: .public)")
        if self.recoveryFailureCount >= 3 {
          self.sendError(code: "audio_session_recovery_failed", message: error.localizedDescription)
        }
      }
    }
  }

  private func recoverAudioSessionIfStopped(reason: String, delay: TimeInterval = 0.1) {
    queue.asyncAfter(deadline: .now() + delay) {
      guard self.recordingRunning || self.playbackReady else { return }
      if self.audioEngine.isRunning {
        self.logger.info("audio graph retained reason=\(reason, privacy: .public)")
      } else {
        self.recoverAudioSession(reason: reason, delay: 0)
      }
    }
  }

  private func ensureEngineRunning() throws {
    if audioEngine.isRunning { return }
    audioEngine.prepare()
    try audioEngine.start()
  }

  private func startRecordingWithRetry(
    options: StartOptions,
    promise: Promise,
    generation: UInt64,
    attempt: Int
  ) {
    guard generation == recordingStartGeneration else {
      promise.reject(PcmRecorderError.startCancelled)
      return
    }
    do {
      try startRecording(options: options)
      promise.resolve()
    } catch {
      let retryDelays: [TimeInterval] = [0.12, 0.25, 0.5, 0.9, 1.4]
      guard attempt < retryDelays.count else {
        logger.error("recording start failed after retries: \(error.localizedDescription, privacy: .public)")
        promise.reject(error)
        return
      }
      let delay = retryDelays[attempt]
      logger.warning(
        "recording start waiting for stable audio input attempt=\(attempt + 1) delay=\(delay) message=\(error.localizedDescription, privacy: .public)"
      )
      queue.asyncAfter(deadline: .now() + delay) {
        self.startRecordingWithRetry(
          options: options,
          promise: promise,
          generation: generation,
          attempt: attempt + 1
        )
      }
    }
  }

  private func startRecording(options: StartOptions) throws {
    if recordingRunning { return }
    try configureSession(voiceChat: options.voiceChat)

    let sampleRate = Double(options.sampleRate > 0 ? options.sampleRate : 16_000)
    let frameMs = options.frameDurationMs > 0 ? options.frameDurationMs : 40
    samplesPerFrame = max(1, Int(sampleRate) * frameMs / 1000)
    accumulator.removeAll(keepingCapacity: true)
    inputBufferCount = 0
    emittedFrameCount = 0
    recordingOptions = options
    recordingRunning = true
    lastInputBufferAt = Date()

    do {
      try installRecordingPipeline(options: options, sampleRate: sampleRate)
      try ensureEngineRunning()
      if playbackReady, let playbackFormat {
        startSilentKeepAlive(format: playbackFormat)
      }
      startInputWatchdog()
      logger.info("recording started frameSamples=\(self.samplesPerFrame)")
    } catch {
      recordingRunning = false
      recordingOptions = nil
      audioEngine.inputNode.removeTap(onBus: 0)
      converter = nil
      converterInputFormat = nil
      targetFormat = nil
      throw error
    }
  }

  private func installRecordingPipeline(options: StartOptions, sampleRate: Double? = nil) throws {
    let targetRate = sampleRate ?? Double(options.sampleRate > 0 ? options.sampleRate : 16_000)
    guard
      let target = AVAudioFormat(
        commonFormat: .pcmFormatFloat32,
        sampleRate: targetRate,
        channels: 1,
        interleaved: false
      )
    else { throw PcmRecorderError.unsupportedFormat }
    targetFormat = target

    let inputNode = audioEngine.inputNode
    let initialInputFormat = inputNode.outputFormat(forBus: 0)
    let initialOutputFormat = audioEngine.outputNode.inputFormat(forBus: 0)
    logger.info(
      "recording hardware format inputRate=\(initialInputFormat.sampleRate) inputChannels=\(initialInputFormat.channelCount) outputRate=\(initialOutputFormat.sampleRate) outputChannels=\(initialOutputFormat.channelCount)"
    )
    guard
      Self.isUsableHardwareFormat(initialInputFormat),
      Self.isUsableHardwareFormat(initialOutputFormat)
    else { throw PcmRecorderError.inputFormatNotReady }

    do {
      if inputNode.isVoiceProcessingEnabled != options.voiceChat {
        try inputNode.setVoiceProcessingEnabled(options.voiceChat)
      }
      logger.info("voice processing enabled=\(inputNode.isVoiceProcessingEnabled)")
    } catch {
      logger.warning("voice processing unavailable: \(error.localizedDescription, privacy: .public)")
    }
    let pendingInputFormat = inputNode.outputFormat(forBus: 0)
    let pendingOutputFormat = audioEngine.outputNode.inputFormat(forBus: 0)
    guard
      Self.isUsableHardwareFormat(pendingInputFormat),
      Self.isUsableHardwareFormat(pendingOutputFormat)
    else { throw PcmRecorderError.inputFormatNotReady }
    logger.info("recording format pendingInputRate=\(pendingInputFormat.sampleRate) pendingInputChannels=\(pendingInputFormat.channelCount) targetRate=\(target.sampleRate)")
    converter = nil
    converterInputFormat = nil

    inputNode.removeTap(onBus: 0)
    // Let AVAudioEngine choose the tap format, then build the converter from the first
    // real microphone buffer. Audio-route transitions can briefly report an unusable
    // zero-channel format even though the input becomes valid moments later.
    inputNode.installTap(onBus: 0, bufferSize: 1024, format: nil) { [weak self] buffer, _ in
      self?.queue.async { self?.handleInputBuffer(buffer) }
    }
  }

  private static func isUsableHardwareFormat(_ format: AVAudioFormat) -> Bool {
    format.sampleRate > 0 && format.channelCount > 0
  }

  private func restartRecordingPipeline(options: StartOptions) throws {
    guard recordingRunning else { return }
    audioEngine.stop()
    audioEngine.inputNode.removeTap(onBus: 0)
    converter = nil
    converterInputFormat = nil
    targetFormat = nil
    accumulator.removeAll(keepingCapacity: true)
    try installRecordingPipeline(options: options)
    try ensureEngineRunning()
    lastInputBufferAt = Date()
    if playbackReady, let playbackFormat {
      if !playerNode.isPlaying { playerNode.play() }
      startSilentKeepAlive(format: playbackFormat)
    }
  }

  private func rebuildAudioGraph() throws {
    let shouldRecord = recordingRunning
    let options = recordingOptions
    let shouldPlay = playbackReady
    let format = playbackFormat

    playbackGeneration &+= 1
    audioEngine.stop()
    audioEngine.inputNode.removeTap(onBus: 0)
    audioEngine = AVAudioEngine()
    playerNode = AVAudioPlayerNode()
    keepAliveNode = AVAudioPlayerNode()
    playerAttached = false
    keepAliveAttached = false
    keepAliveRunning = false
    converter = nil
    converterInputFormat = nil
    targetFormat = nil
    accumulator.removeAll(keepingCapacity: true)

    if shouldPlay, let format {
      audioEngine.attach(playerNode)
      audioEngine.attach(keepAliveNode)
      playerAttached = true
      keepAliveAttached = true
      audioEngine.connect(playerNode, to: audioEngine.mainMixerNode, format: format)
      audioEngine.connect(keepAliveNode, to: audioEngine.mainMixerNode, format: format)
    }
    if shouldRecord, let options {
      try installRecordingPipeline(options: options)
    }
    try ensureEngineRunning()
    if shouldPlay, let format {
      playerNode.play()
      startSilentKeepAlive(format: format)
    }
    lastInputBufferAt = Date()
  }

  private func startInputWatchdog() {
    inputWatchdog?.cancel()
    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now() + 1.5, repeating: 1.0)
    timer.setEventHandler { [weak self] in
      guard let self else { return }
      guard self.recordingRunning, !self.interruptionActive, !self.recoveryInProgress else { return }
      let stalledFor = Date().timeIntervalSince(self.lastInputBufferAt)
      guard stalledFor >= 2.5 else { return }
      self.logger.warning("microphone input watchdog detected stall seconds=\(stalledFor)")
      self.recoverAudioSession(reason: "input_watchdog_stall", delay: 0)
    }
    inputWatchdog = timer
    timer.resume()
  }

  private func stopInputWatchdog() {
    inputWatchdog?.cancel()
    inputWatchdog = nil
  }

  private func stopRecording() {
    if recordingRunning {
      recordingRunning = false
      stopInputWatchdog()
      audioEngine.inputNode.removeTap(onBus: 0)
      converter = nil
      converterInputFormat = nil
      targetFormat = nil
      recordingOptions = nil
      accumulator.removeAll(keepingCapacity: false)
      logger.info("recording stopped inputBuffers=\(self.inputBufferCount) emittedFrames=\(self.emittedFrameCount)")
    }
    stopEngineIfIdle()
  }

  private func preparePlayback(options: PlaybackOptions) throws {
    let sampleRate = Double(options.sampleRate > 0 ? options.sampleRate : 24_000)
    // Ambient recording feedback is playback, not a VoIP conversation. Preserve
    // the recorder's scene; the call path still defaults to voiceChat when its
    // player is prepared before the microphone. Do not override headset routes.
    try configureSession(voiceChat: recordingOptions?.voiceChat ?? true, speechPlayback: true)
    playerNode.volume = 1.0
    audioEngine.mainMixerNode.outputVolume = 1.0
    playbackChunkCount = 0
    guard
      let format = AVAudioFormat(
        commonFormat: .pcmFormatFloat32,
        sampleRate: sampleRate,
        channels: 1,
        interleaved: false
      )
    else { throw PcmRecorderError.unsupportedFormat }
    playbackFormat = format
    if !playerAttached {
      audioEngine.attach(playerNode)
      playerAttached = true
    }
    if !keepAliveAttached {
      audioEngine.attach(keepAliveNode)
      keepAliveAttached = true
    }
    audioEngine.disconnectNodeOutput(playerNode)
    audioEngine.disconnectNodeOutput(keepAliveNode)
    audioEngine.connect(playerNode, to: audioEngine.mainMixerNode, format: format)
    audioEngine.connect(keepAliveNode, to: audioEngine.mainMixerNode, format: format)
    playbackReady = true
    if recordingRunning {
      try ensureEngineRunning()
      startSilentKeepAlive(format: format)
      logger.info("playback started sampleRate=\(sampleRate)")
    } else {
      logger.info("playback prepared sampleRate=\(sampleRate) awaitingRecorder=true")
    }
  }

  private func enqueuePlayback(payload: PlaybackChunk) throws {
    guard playbackReady, let format = playbackFormat else {
      throw PcmRecorderError.playbackNotReady
    }
    guard let data = Data(base64Encoded: payload.data), !data.isEmpty else { return }
    playbackChunkCount += 1
    #if DEBUG
    if playbackChunkCount == 1 || playbackChunkCount % 25 == 0 {
      logger.info("playback chunk queued chunks=\(self.playbackChunkCount) bytes=\(data.count) responseId=\(payload.responseId, privacy: .public)")
    }
    #endif
    let sampleCount = data.count / 2
    guard sampleCount > 0 else { return }
    let frameCount = AVAudioFrameCount(sampleCount)
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else {
      throw PcmRecorderError.bufferAllocationFailed
    }
    buffer.frameLength = frameCount
    data.withUnsafeBytes { raw in
      guard
        let source = raw.baseAddress?.assumingMemoryBound(to: Int16.self),
        let target = buffer.floatChannelData?[0]
      else { return }
      for index in 0..<sampleCount {
        target[index] = Float(Int16(littleEndian: source[index])) / 32768.0
      }
    }
    playerNode.scheduleBuffer(buffer)
    if !playerNode.isPlaying { playerNode.play() }
  }

  private func startSilentKeepAlive(format: AVAudioFormat) {
    guard !keepAliveRunning else {
      if !keepAliveNode.isPlaying { keepAliveNode.play() }
      return
    }
    let frameCapacity = AVAudioFrameCount(max(Int(format.sampleRate / 2), 1))
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCapacity) else { return }
    buffer.frameLength = frameCapacity
    keepAliveNode.scheduleBuffer(buffer, at: nil, options: .loops)
    keepAliveNode.play()
    keepAliveRunning = true
    logger.info("silent keepalive started sampleRate=\(format.sampleRate)")
  }

  private func finishPlayback(responseId: String) {
    guard playbackReady, let format = playbackFormat else {
      sendEvent("onPlaybackComplete", ["responseId": responseId])
      return
    }
    guard let sentinel = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1) else {
      sendEvent("onPlaybackComplete", ["responseId": responseId])
      return
    }
    sentinel.frameLength = 1
    sentinel.floatChannelData?[0][0] = 0
    let generation = playbackGeneration
    playerNode.scheduleBuffer(sentinel, completionCallbackType: .dataPlayedBack) { [weak self] _ in
      guard let self, self.playbackGeneration == generation, self.playbackReady else { return }
      self.sendEvent("onPlaybackComplete", ["responseId": responseId])
    }
    if !playerNode.isPlaying { playerNode.play() }
  }

  private func setOutputRoute(_ route: String) throws {
    let session = AVAudioSession.sharedInstance()
    switch route {
    case "speaker":
      try session.overrideOutputAudioPort(.speaker)
    case "earpiece":
      try session.overrideOutputAudioPort(.none)
    case "system":
      try session.overrideOutputAudioPort(.none)
    default:
      throw PcmRecorderError.unsupportedOutputRoute
    }
  }

  private func stopPlayback() {
    playbackGeneration &+= 1
    stopSilentKeepAlive()
    playerNode.stop()
    playerNode.reset()
    playbackReady = false
    playbackFormat = nil
    logger.info("playback stopped chunks=\(self.playbackChunkCount)")
    stopEngineIfIdle()
  }

  private func stopSilentKeepAlive() {
    if !keepAliveRunning { return }
    keepAliveRunning = false
    keepAliveNode.stop()
    keepAliveNode.reset()
    logger.info("silent keepalive stopped")
  }

  private func stopEngineIfIdle() {
    if recordingRunning || playbackReady { return }
    audioEngine.stop()
    audioEngine.reset()
    let session = AVAudioSession.sharedInstance()
    try? session.setActive(false, options: [.notifyOthersOnDeactivation])
    setIdleTimerDisabled(false)
  }

  private func handleInputBuffer(_ buffer: AVAudioPCMBuffer) {
    guard recordingRunning, let target = targetFormat else { return }
    lastInputBufferAt = Date()
    recoveryFailureCount = 0
    inputBufferCount += 1
    #if DEBUG
    if inputBufferCount == 1 || inputBufferCount % 25 == 0 {
      logger.info("microphone buffer inputBuffers=\(self.inputBufferCount) frames=\(buffer.frameLength) sampleRate=\(buffer.format.sampleRate)")
    }
    #endif
    guard let converter = converterForInputBuffer(buffer, target: target) else { return }
    let inputCapacity = buffer.frameLength
    let ratio = target.sampleRate / buffer.format.sampleRate
    let outputCapacity = AVAudioFrameCount(Double(inputCapacity) * ratio + 16)
    guard let output = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: outputCapacity) else {
      sendError(code: "buffer_allocation_failed", message: "cannot allocate output buffer")
      return
    }

    var error: NSError?
    var consumed = false
    let status = converter.convert(to: output, error: &error) { _, inputStatus in
      if consumed {
        inputStatus.pointee = .noDataNow
        return nil
      }
      consumed = true
      inputStatus.pointee = .haveData
      return buffer
    }
    if status == .error {
      sendError(code: "conversion_failed", message: error?.localizedDescription ?? "convert failed")
      return
    }
    guard output.frameLength > 0, let channelData = output.floatChannelData else { return }
    appendPcm16Samples(channelData[0], count: Int(output.frameLength))
    while accumulator.count >= bytesPerFrame {
      let frame = accumulator.subdata(in: 0..<bytesPerFrame)
      accumulator.removeSubrange(0..<bytesPerFrame)
      emittedFrameCount += 1
      #if DEBUG
      if emittedFrameCount == 1 || emittedFrameCount % 25 == 0 {
        logger.info("microphone PCM emitted frames=\(self.emittedFrameCount) bytes=\(frame.count)")
      }
      #endif
      sendEvent("onFrame", [
        "data": frame.base64EncodedString(),
        "samples": samplesPerFrame,
      ])
    }
  }

  private func converterForInputBuffer(
    _ buffer: AVAudioPCMBuffer,
    target: AVAudioFormat
  ) -> AVAudioConverter? {
    let input = buffer.format
    guard input.sampleRate > 0, input.channelCount > 0 else {
      logger.warning(
        "microphone buffer has invalid format sampleRate=\(input.sampleRate) channels=\(input.channelCount)"
      )
      return nil
    }
    if
      let converter,
      let converterInputFormat,
      converterInputFormat.sampleRate == input.sampleRate,
      converterInputFormat.channelCount == input.channelCount,
      converterInputFormat.commonFormat == input.commonFormat,
      converterInputFormat.isInterleaved == input.isInterleaved
    {
      return converter
    }
    guard let next = AVAudioConverter(from: input, to: target) else {
      logger.error(
        "microphone converter unavailable inputRate=\(input.sampleRate) inputChannels=\(input.channelCount) targetRate=\(target.sampleRate)"
      )
      return nil
    }
    converter = next
    converterInputFormat = input
    logger.info(
      "microphone converter ready inputRate=\(input.sampleRate) inputChannels=\(input.channelCount) targetRate=\(target.sampleRate)"
    )
    return next
  }

  private func appendPcm16Samples(_ samples: UnsafePointer<Float>, count: Int) {
    var data = Data(count: count * 2)
    data.withUnsafeMutableBytes { rawBuffer in
      guard let bytes = rawBuffer.bindMemory(to: UInt8.self).baseAddress else { return }
      for index in 0..<count {
        let sample = max(-1.0, min(1.0, samples[index]))
        let scaled = sample < 0 ? sample * 32768.0 : sample * 32767.0
        let intSample = Int16(scaled.rounded())
        let littleEndian = UInt16(bitPattern: intSample).littleEndian
        bytes[index * 2] = UInt8(littleEndian & 0xff)
        bytes[index * 2 + 1] = UInt8((littleEndian >> 8) & 0xff)
      }
    }
    accumulator.append(data)
  }

  private func sendError(code: String, message: String) {
    logger.error("PCM error code=\(code, privacy: .public) message=\(message, privacy: .public)")
    sendEvent("onError", ["code": code, "message": message])
  }
}

private enum PcmRecorderError: Error, LocalizedError {
  case unsupportedFormat
  case inputFormatNotReady
  case playbackNotReady
  case bufferAllocationFailed
  case unsupportedOutputRoute
  case startCancelled

  var errorDescription: String? {
    switch self {
    case .unsupportedFormat: return "Cannot build target PCM format"
    case .inputFormatNotReady: return "Audio input or output format is not ready"
    case .playbackNotReady: return "PCM playback is not ready"
    case .bufferAllocationFailed: return "Cannot allocate PCM playback buffer"
    case .unsupportedOutputRoute: return "Unsupported PCM output route"
    case .startCancelled: return "PCM recording start was cancelled"
    }
  }
}

internal struct StartOptions: Record {
  @Field var sampleRate: Int = 16_000
  @Field var frameDurationMs: Int = 40
  @Field var voiceChat: Bool = false
}

internal struct PlaybackOptions: Record {
  @Field var sampleRate: Int = 24_000
}

internal struct PlaybackChunk: Record {
  @Field var data: String = ""
  @Field var responseId: String = ""
}
