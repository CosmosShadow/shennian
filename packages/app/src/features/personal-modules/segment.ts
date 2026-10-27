// @arch docs/features/personal-modules.md
// @test src/__tests__/personal-modules.test.ts
import { getServerUrl } from '../../config/server'
import type { Transcript } from './types'
import { localDay, localZone } from './types'
export function recordingSegment(input: {
  token: string
  sessionKey: string
  key: string
  startAt: number
  save: (item: Transcript) => void
  partial: (text: string) => void
  failed: (reason: string) => void
  closed: () => void
  ready?: () => void
}) {
  const base = new URL(getServerUrl())
  const url = `${base.protocol === 'https:' ? 'wss:' : 'ws:'}//${base.host}${base.pathname.replace(/\/$/, '')}/api/voice/asr?token=${encodeURIComponent(input.token)}`
  const ws = new WebSocket(url)
  ws.binaryType = 'arraybuffer'
  let ready = false,
    ending = false,
    ended = false,
    revision = 0,
    endAt = input.startAt
  let pending: ArrayBuffer[] = [],
    bytes = 0
  const finals = new Map<number, string>()
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let lastResponseAt = Date.now()
  let timeout = setTimeout(() => fail('asr_connect_timeout'), 12000)
  function cleanup() {
    clearTimeout(timeout)
    if (heartbeat) clearInterval(heartbeat)
    heartbeat = null
    pending = []
    bytes = 0
    try { ws.close() } catch { /* Already disconnected. */ }
  }
  function fail(reason: string) {
    if (ended) return
    ended = true
    cleanup()
    input.failed(reason)
    input.closed()
  }
  function save(value: string) {
    if (!value.trim()) return
    input.save({
      key: input.key,
      sessionKey: input.sessionKey,
      revision: ++revision,
      startAt: new Date(input.startAt).toISOString(),
      endAt: new Date(Math.max(endAt, input.startAt)).toISOString(),
      day: localDay(new Date(input.startAt)),
      timezone: localZone(),
      text: value.trim(),
    })
  }
  function finalTranscript() {
    // Fun-ASR emits cumulative snapshots; other providers may emit sentence
    // deltas. Match the server's prefix replacement rather than duplicating
    // every previous sentence on each final event.
    return [...finals]
      .sort((a, b) => a[0] - b[0])
      .reduce((text, [, next]) => next.startsWith(text) ? next : text + next, '')
  }
  function stopWire() {
    try { ws.send(JSON.stringify({ type: 'stop' })) }
    catch { fail('asr_connection_failed'); return }
    clearTimeout(timeout)
    timeout = setTimeout(() => fail('asr_finish_timeout'), 15000)
  }
  ws.onopen = () => {
    if (ended) return
    try {
      ws.send(JSON.stringify({ type: 'start', sampleRate: 16000, encoding: 'pcm16le', lang: 'zh-CN' }))
    } catch { fail('asr_connection_failed') }
  }
  ws.onmessage = (event) => {
    if (ended || typeof event.data !== 'string') return
    try {
      const p = JSON.parse(event.data)
      if (!['ready', 'partial', 'final', 'end', 'error', 'pong'].includes(p.type)) return
      lastResponseAt = Date.now()
      if (p.type === 'ready') {
        if (ready) return
        ready = true
        clearTimeout(timeout)
        for (const frame of pending) ws.send(frame)
        pending = []
        bytes = 0
        heartbeat = setInterval(() => {
          if (Date.now() - lastResponseAt >= 15000) { fail('asr_response_timeout'); return }
          try { ws.send(JSON.stringify({ type: 'ping' })) }
          catch { fail('asr_connection_failed') }
        }, 5000)
        input.ready?.()
        if (ending) stopWire()
      } else if (p.type === 'partial') input.partial(String(p.text ?? ''))
      else if (p.type === 'final') {
        finals.set(Number(p.index), String(p.text ?? ''))
        save(finalTranscript())
      } else if (p.type === 'end') {
        save(String(p.transcript ?? '') || finalTranscript())
        ended = true
        cleanup()
        input.closed()
      } else if (p.type === 'error') fail(String(p.code ?? 'asr_error'))
    } catch {
      fail('asr_invalid_response')
    }
  }
  ws.onerror = () => fail('asr_connection_failed')
  ws.onclose = () => {
    if (!ended) fail('asr_closed_before_end')
  }
  return {
    send(frame: Uint8Array) {
      if (ending || ended) return
      endAt += frame.byteLength / 32
      const copy = new ArrayBuffer(frame.byteLength)
      new Uint8Array(copy).set(frame)
      if (ready && ws.readyState === WebSocket.OPEN) {
        try { ws.send(copy) } catch { fail('asr_connection_failed') }
      } else {
        bytes += copy.byteLength
        if (bytes > 384000) {
          fail('asr_buffer_limit')
          return
        }
        pending.push(copy)
      }
    },
    finish() {
      if (ending || ended) return
      ending = true
      if (ready) stopWire()
    },
    abort() {
      fail('recording_interrupted')
    },
  }
}
