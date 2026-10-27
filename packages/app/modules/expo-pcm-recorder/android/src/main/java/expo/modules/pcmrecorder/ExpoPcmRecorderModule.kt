package expo.modules.pcmrecorder

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Base64
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.atomic.AtomicLong
import kotlin.concurrent.thread

internal class StartOptions : Record {
  @Field var sampleRate: Int = 16_000
  @Field var frameDurationMs: Int = 40
  @Field var voiceChat: Boolean = false
}

internal class PlaybackOptions : Record {
  @Field var sampleRate: Int = 24_000
}

internal class PlaybackChunk : Record {
  @Field var data: String = ""
  @Field var responseId: String = ""
}

private sealed class PlaybackCommand {
  data class Audio(val bytes: ByteArray) : PlaybackCommand()
  data class Finish(val responseId: String) : PlaybackCommand()
  data object Flush : PlaybackCommand()
  data object Stop : PlaybackCommand()
}

class VoiceChiefForegroundService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onCreate() {
    super.onCreate()
    val manager = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = manager.newWakeLock(
      PowerManager.PARTIAL_WAKE_LOCK,
      "Shennian:VoiceChiefCall",
    ).also { lock ->
      lock.setReferenceCounted(false)
      lock.acquire()
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    ensureChannel()
    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.sym_call_incoming)
      .setContentTitle("神念通话中")
      .setContentText("正在保持语音电话连接")
      .setCategory(Notification.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setOngoing(true)
      .setSilent(true)
      .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      ServiceCompat.startForeground(
        this,
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE,
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    try {
      wakeLock?.takeIf { it.isHeld }?.release()
    } finally {
      wakeLock = null
      super.onDestroy()
    }
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    manager.createNotificationChannel(NotificationChannel(
      CHANNEL_ID,
      "神念语音通话",
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = "保持神念语音电话在锁屏和息屏时继续运行"
      setSound(null, null)
    })
  }

  companion object {
    private const val CHANNEL_ID = "voice_chief_active_call"
    private const val NOTIFICATION_ID = 4202

    fun start(context: Context) {
      val intent = Intent(context.applicationContext, VoiceChiefForegroundService::class.java)
      ContextCompat.startForegroundService(context.applicationContext, intent)
    }

    fun stop(context: Context) {
      context.applicationContext.stopService(
        Intent(context.applicationContext, VoiceChiefForegroundService::class.java),
      )
    }
  }
}

class ExpoPcmRecorderModule : Module() {
  private var audioRecord: AudioRecord? = null
  private var recordingThread: Thread? = null
  @Volatile private var recordingRunning = false
  @Volatile private var recordingVoiceChat = false
  private var samplesPerFrame = 640

  private var audioTrack: AudioTrack? = null
  private var playbackThread: Thread? = null
  private val playbackQueue = LinkedBlockingQueue<PlaybackCommand>()
  @Volatile private var playbackRunning = false
  private var audioManager: AudioManager? = null
  private var focusRequest: AudioFocusRequest? = null
  private var foregroundServiceStarted = false
  private val playbackGeneration = AtomicLong(0)
  private val submittedPlaybackFrames = AtomicLong(0)

  override fun definition() = ModuleDefinition {
    Name("ExpoPcmRecorder")

    Events("onFrame", "onError", "onPlaybackComplete")

    Function("isAvailable") {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
    }

    AsyncFunction("requestPermissions") {
      val context = appContext.reactContext
        ?: return@AsyncFunction mapOf("granted" to false)
      val granted = ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.RECORD_AUDIO,
      ) == PackageManager.PERMISSION_GRANTED
      mapOf("granted" to granted)
    }

    AsyncFunction("start") { options: StartOptions ->
      startRecording(options)
    }

    AsyncFunction("stop") {
      stopRecording()
    }

    AsyncFunction("startPlayback") { options: PlaybackOptions ->
      startPlayback(options)
    }

    AsyncFunction("enqueuePlayback") { payload: PlaybackChunk ->
      if (!playbackRunning) throw Exception("PCM playback is not ready")
      val bytes = Base64.decode(payload.data, Base64.DEFAULT)
      if (bytes.isNotEmpty()) playbackQueue.put(PlaybackCommand.Audio(bytes))
    }

    AsyncFunction("finishPlayback") { responseId: String ->
      if (playbackRunning) playbackQueue.put(PlaybackCommand.Finish(responseId))
    }

    AsyncFunction("flushPlayback") {
      flushPlayback()
    }

    AsyncFunction("stopPlayback") {
      stopPlayback()
    }

    AsyncFunction("setOutputRoute") { route: String ->
      setOutputRoute(route)
    }

    OnDestroy {
      stopRecording()
      stopPlayback()
    }
  }

  private fun startRecording(options: StartOptions) {
    if (recordingRunning) return
    val context = appContext.reactContext ?: throw Exception("react context unavailable")
    val hasPermission = ContextCompat.checkSelfPermission(
      context,
      Manifest.permission.RECORD_AUDIO,
    ) == PackageManager.PERMISSION_GRANTED
    if (!hasPermission) throw Exception("RECORD_AUDIO not granted")

    configureVoiceAudio(context, options.voiceChat)
    val sampleRate = if (options.sampleRate > 0) options.sampleRate else 16_000
    val frameMs = if (options.frameDurationMs > 0) options.frameDurationMs else 40
    samplesPerFrame = maxOf(1, sampleRate * frameMs / 1000)
    val minBuffer = AudioRecord.getMinBufferSize(
      sampleRate,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
    )
    if (minBuffer <= 0) throw Exception("getMinBufferSize failed")
    val recorder = AudioRecord(
      if (options.voiceChat) MediaRecorder.AudioSource.VOICE_COMMUNICATION else MediaRecorder.AudioSource.VOICE_RECOGNITION,
      sampleRate,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
      maxOf(minBuffer, samplesPerFrame * 2 * 4),
    )
    if (recorder.state != AudioRecord.STATE_INITIALIZED) {
      recorder.release()
      throw Exception("AudioRecord failed to initialise")
    }

    audioRecord = recorder
    recordingVoiceChat = options.voiceChat
    recordingRunning = true
    recorder.startRecording()
    recordingThread = thread(name = "expo-pcm-recorder", isDaemon = true) {
      val bytesPerFrame = samplesPerFrame * 2
      val frame = ByteArray(bytesPerFrame)
      var offset = 0
      try {
        while (recordingRunning) {
          val read = recorder.read(frame, offset, bytesPerFrame - offset)
          if (read < 0) {
            emitError("read_error", "AudioRecord.read returned $read")
            break
          }
          if (read == 0) continue
          offset += read
          if (offset >= bytesPerFrame) {
            sendEvent("onFrame", mapOf(
              "data" to Base64.encodeToString(frame, Base64.NO_WRAP),
              "samples" to samplesPerFrame,
            ))
            offset = 0
          }
        }
      } catch (error: Throwable) {
        if (recordingRunning) emitError("recording_thread_crashed", error.message ?: error.javaClass.simpleName)
      }
    }
  }

  private fun startPlayback(options: PlaybackOptions) {
    if (playbackRunning) return
    val context = appContext.reactContext ?: throw Exception("react context unavailable")
    // Feedback accompanying non-call recording uses media loudness, while
    // Voice Chief retains communication routing and its call-volume stream.
    val voiceChat = !recordingRunning || recordingVoiceChat
    configureVoiceAudio(context, voiceChat)
    val sampleRate = if (options.sampleRate > 0) options.sampleRate else 24_000
    val minBuffer = AudioTrack.getMinBufferSize(
      sampleRate,
      AudioFormat.CHANNEL_OUT_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
    )
    if (minBuffer <= 0) throw Exception("AudioTrack.getMinBufferSize failed")
    val attributes = AudioAttributes.Builder()
      .setUsage(if (voiceChat) AudioAttributes.USAGE_VOICE_COMMUNICATION else AudioAttributes.USAGE_MEDIA)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
      .build()
    val format = AudioFormat.Builder()
      .setSampleRate(sampleRate)
      .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
      .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
      .build()
    val track = AudioTrack(attributes, format, maxOf(minBuffer, sampleRate), AudioTrack.MODE_STREAM, AudioManager.AUDIO_SESSION_ID_GENERATE)
    if (track.state != AudioTrack.STATE_INITIALIZED) {
      track.release()
      throw Exception("AudioTrack failed to initialise")
    }
    audioTrack = track
    playbackQueue.clear()
    playbackGeneration.incrementAndGet()
    submittedPlaybackFrames.set(0)
    playbackRunning = true
    track.play()
    playbackThread = thread(name = "expo-pcm-playback", isDaemon = true) {
      try {
        playbackLoop(track)
      } catch (error: Throwable) {
        if (playbackRunning) emitError("playback_thread_crashed", error.message ?: error.javaClass.simpleName)
      }
    }
  }

  private fun playbackLoop(track: AudioTrack) {
    while (playbackRunning) {
      when (val command = playbackQueue.take()) {
        is PlaybackCommand.Audio -> {
          var offset = 0
          while (playbackRunning && offset < command.bytes.size) {
            val written = track.write(command.bytes, offset, command.bytes.size - offset, AudioTrack.WRITE_BLOCKING)
            if (written < 0) throw Exception("AudioTrack.write returned $written")
            offset += written
            submittedPlaybackFrames.addAndGet((written / 2).toLong())
          }
        }
        is PlaybackCommand.Finish -> {
          val generation = playbackGeneration.get()
          val targetFrames = submittedPlaybackFrames.get()
          thread(name = "expo-pcm-playback-complete", isDaemon = true) {
            val deadline = System.currentTimeMillis() + 60_000
            while (playbackRunning && playbackGeneration.get() == generation && System.currentTimeMillis() < deadline) {
              val playedFrames = track.playbackHeadPosition.toLong() and 0xffffffffL
              if (playedFrames >= targetFrames) {
                sendEvent("onPlaybackComplete", mapOf("responseId" to command.responseId))
                return@thread
              }
              Thread.sleep(10)
            }
          }
        }
        PlaybackCommand.Flush -> {
          track.pause()
          track.flush()
          if (playbackRunning) track.play()
        }
        PlaybackCommand.Stop -> return
      }
    }
  }

  private fun flushPlayback() {
    if (!playbackRunning) return
    playbackGeneration.incrementAndGet()
    playbackQueue.clear()
    val track = audioTrack ?: return
    try {
      track.pause()
      track.flush()
      submittedPlaybackFrames.set(0)
      if (playbackRunning) track.play()
    } catch (error: IllegalStateException) {
      emitError("playback_flush_failed", error.message ?: "AudioTrack flush failed")
    }
  }

  private fun stopRecording() {
    recordingRunning = false
    val recorder = audioRecord
    audioRecord = null
    try { recorder?.stop() } catch (_: IllegalStateException) { }
    try { recordingThread?.join(500) } catch (_: InterruptedException) { Thread.currentThread().interrupt() }
    recordingThread = null
    recorder?.release()
    abandonFocusIfIdle()
  }

  private fun stopPlayback() {
    if (!playbackRunning && audioTrack == null) return
    playbackRunning = false
    playbackGeneration.incrementAndGet()
    playbackQueue.clear()
    playbackQueue.offer(PlaybackCommand.Stop)
    val track = audioTrack
    audioTrack = null
    try { track?.pause() } catch (_: IllegalStateException) { }
    try { track?.flush() } catch (_: IllegalStateException) { }
    try { track?.stop() } catch (_: IllegalStateException) { }
    try { playbackThread?.join(500) } catch (_: InterruptedException) { Thread.currentThread().interrupt() }
    playbackThread = null
    track?.release()
    abandonFocusIfIdle()
  }

  private fun configureVoiceAudio(context: Context, voiceChat: Boolean) {
    val manager = (context.getSystemService(Context.AUDIO_SERVICE) as AudioManager).also { audioManager = it }
    if (voiceChat) {
      startVoiceForegroundService(context)
      manager.mode = AudioManager.MODE_IN_COMMUNICATION
    } else {
      manager.mode = AudioManager.MODE_NORMAL
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
        .setAudioAttributes(AudioAttributes.Builder()
          .setUsage(if (voiceChat) AudioAttributes.USAGE_VOICE_COMMUNICATION else AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build())
        .setOnAudioFocusChangeListener { change ->
          if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) flushPlayback()
        }
        .build()
      focusRequest = request
      manager.requestAudioFocus(request)
    } else {
      @Suppress("DEPRECATION")
      manager.requestAudioFocus(null, if (voiceChat) AudioManager.STREAM_VOICE_CALL else AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
    }
  }

  private fun setOutputRoute(route: String) {
    val manager = audioManager ?: return
    when (route) {
      "speaker" -> {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          val speaker = manager.availableCommunicationDevices.firstOrNull {
            it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
          }
          if (speaker != null) manager.setCommunicationDevice(speaker)
          else {
            @Suppress("DEPRECATION")
            manager.isSpeakerphoneOn = true
          }
        } else {
          @Suppress("DEPRECATION")
          manager.isSpeakerphoneOn = true
        }
      }
      "earpiece" -> {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          val earpiece = manager.availableCommunicationDevices.firstOrNull {
            it.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
          }
          if (earpiece != null) manager.setCommunicationDevice(earpiece)
          else manager.clearCommunicationDevice()
        }
        @Suppress("DEPRECATION")
        manager.isSpeakerphoneOn = false
      }
      "system" -> {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) manager.clearCommunicationDevice()
        @Suppress("DEPRECATION")
        manager.isSpeakerphoneOn = false
      }
      else -> throw Exception("Unsupported output route: $route")
    }
  }

  private fun abandonFocusIfIdle() {
    if (recordingRunning || playbackRunning) return
    val manager = audioManager ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) focusRequest?.let(manager::abandonAudioFocusRequest)
    else @Suppress("DEPRECATION") manager.abandonAudioFocus(null)
    manager.mode = AudioManager.MODE_NORMAL
    focusRequest = null
    audioManager = null
    stopVoiceForegroundService()
  }

  private fun startVoiceForegroundService(context: Context) {
    if (foregroundServiceStarted) return
    try {
      VoiceChiefForegroundService.start(context)
      foregroundServiceStarted = true
    } catch (error: Throwable) {
      emitError("foreground_service_start_failed", error.message ?: error.javaClass.simpleName)
    }
  }

  private fun stopVoiceForegroundService() {
    if (!foregroundServiceStarted) return
    val context = appContext.reactContext ?: return
    VoiceChiefForegroundService.stop(context)
    foregroundServiceStarted = false
  }

  private fun emitError(code: String, message: String) {
    sendEvent("onError", mapOf("code" to code, "message" to message))
  }
}
