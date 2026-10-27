// @covers open-source/packages/server/src/services/qwen-audio-realtime.ts

import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  buildQwenSessionUpdate,
  QwenAudioRealtimeClient,
  qwenAudioRealtimeUrl,
} from '../services/qwen-audio-realtime.js'

class FakeSocket extends EventEmitter {
  readyState = 1
  sent: string[] = []
  close = vi.fn(() => {
    this.readyState = 3
  })
  send(data: string) {
    this.sent.push(data)
  }
  server(event: Record<string, unknown>) {
    this.emit('message', Buffer.from(JSON.stringify(event)))
  }
}

describe('QwenAudioRealtimeClient', () => {
  it('builds the Beijing workspace URL and native function tools', () => {
    expect(qwenAudioRealtimeUrl({ workspaceId: 'workspace-1' })).toContain(
      'wss://workspace-1.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen-audio-3.0-realtime-plus',
    )
    const update = buildQwenSessionUpdate({
      instructions: 'system prompt',
      tools: [
        {
          name: 'create_project_conversation',
          description: 'send text',
          parameters: { type: 'object' },
        },
      ],
    })
    expect(update).toMatchObject({
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        input_audio_format: 'pcm',
        output_audio_format: 'pcm',
        turn_detection: {
          type: 'server_vad',
          silence_duration_ms: 450,
        },
        tools: [{ type: 'function', function: { name: 'create_project_conversation' } }],
      },
    })
  })

  it('streams PCM, exposes native function calls, and writes function output back', async () => {
    const socket = new FakeSocket()
    const onAudio = vi.fn()
    const onFunctionCall = vi.fn()
    const onInterrupted = vi.fn()
    const onInputSpeechStarted = vi.fn()
    const client = new QwenAudioRealtimeClient({
      apiKey: 'secret',
      instructions: 'prompt',
      tools: [
        {
          name: 'create_project_conversation',
          description: 'send',
          parameters: { type: 'object' },
        },
      ],
      createSocket: () => socket,
      callbacks: { onAudio, onFunctionCall, onInterrupted, onInputSpeechStarted },
    })

    const connecting = client.connect()
    socket.emit('open')
    expect(JSON.parse(socket.sent[0])).toMatchObject({ type: 'session.update' })
    socket.server({ type: 'session.updated' })
    await connecting

    client.sendAudio(Uint8Array.from([1, 2, 3, 4]))
    expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({
      type: 'input_audio_buffer.append',
      audio: Buffer.from([1, 2, 3, 4]).toString('base64'),
    })

    socket.server({ type: 'response.created', response: { id: 'resp-1' } })
    socket.server({
      type: 'response.audio.delta',
      response_id: 'resp-1',
      delta: Buffer.from([7, 8]).toString('base64'),
    })
    expect(onAudio).toHaveBeenCalledWith('resp-1', expect.any(Uint8Array))

    socket.server({ type: 'input_audio_buffer.speech_started' })
    expect(onInputSpeechStarted).toHaveBeenCalled()
    expect(onInterrupted).toHaveBeenCalledWith('resp-1')
    expect(socket.sent.map((item) => JSON.parse(item).type)).toContain('response.cancel')
    socket.server({ type: 'response.done', response: { id: 'resp-1', status: 'cancelled' } })

    socket.server({
      type: 'response.function_call_arguments.done',
      call_id: 'call-1',
      name: 'create_project_conversation',
      arguments: '{"projectId":"p1","message":"hello"}',
    })
    expect(onFunctionCall).toHaveBeenCalledWith({
      callId: 'call-1',
      name: 'create_project_conversation',
      argumentsJson: '{"projectId":"p1","message":"hello"}',
    })

    client.sendFunctionOutput('call-1', { status: 'delivered' })
    const sentTypes = socket.sent.slice(-2).map((item) => JSON.parse(item).type)
    expect(sentTypes).toEqual(['conversation.item.create', 'response.create'])
    expect(JSON.parse(socket.sent.at(-2)!)).toMatchObject({
      item: { type: 'function_call_output', call_id: 'call-1' },
    })
  })

  it('injects conversation replies as internal function events, not user messages', async () => {
    const socket = new FakeSocket()
    const client = new QwenAudioRealtimeClient({
      apiKey: 'secret',
      instructions: 'prompt',
      tools: [],
      createSocket: () => socket,
    })
    const connecting = client.connect()
    socket.emit('open')
    socket.server({ type: 'session.updated' })
    await connecting

    client.injectConversationMessage({
      projectId: 'p1',
      projectName: 'Shennian',
      conversationId: 's1',
      conversationTitle: '语音功能',
      message: '完成了',
    })

    const injected = socket.sent.slice(-3).map((item) => JSON.parse(item))
    expect(injected[0]).toMatchObject({
      type: 'conversation.item.create',
      item: { type: 'function_call', name: 'conversation_message' },
    })
    expect(injected[1]).toMatchObject({
      type: 'conversation.item.create',
      item: { type: 'function_call_output' },
    })
    expect(injected[2]).toMatchObject({ type: 'response.create' })
    expect(injected.some((event) => event.item?.role === 'user')).toBe(false)
  })

  it('injects a completed background delegate as an internal result event', async () => {
    const socket = new FakeSocket()
    const client = new QwenAudioRealtimeClient({
      apiKey: 'secret',
      instructions: 'prompt',
      tools: [],
      createSocket: () => socket,
    })
    const connecting = client.connect()
    socket.emit('open')
    socket.server({ type: 'session.updated' })
    await connecting

    client.injectDelegateResult({
      result: { status: 'ok', message: '统计完成，共 42 个文件。' },
    })

    const injected = socket.sent.slice(-3).map((item) => JSON.parse(item))
    expect(injected[0]).toMatchObject({
      type: 'conversation.item.create',
      item: { type: 'function_call', name: 'delegate_result' },
    })
    expect(injected[1]).toMatchObject({
      type: 'conversation.item.create',
      item: { type: 'function_call_output' },
    })
    expect(injected[2]).toMatchObject({ type: 'response.create' })
    expect(injected.some((event) => event.item?.role === 'user')).toBe(false)
  })

  it('writes progress into realtime context without creating an audio response', async () => {
    const socket = new FakeSocket()
    const client = new QwenAudioRealtimeClient({
      apiKey: 'secret',
      instructions: 'prompt',
      tools: [],
      createSocket: () => socket,
    })
    const connecting = client.connect()
    socket.emit('open')
    socket.server({ type: 'session.updated' })
    await connecting

    client.injectConversationMessage({
      projectId: 'p1',
      projectName: '神念',
      conversationId: 's1',
      conversationTitle: '语音架构',
      message: 'Codex 已完成修改，正在运行测试。',
      eventKind: 'progress',
      shouldSpeak: false,
    })

    const injected = socket.sent.slice(-2).map((item) => JSON.parse(item))
    expect(injected).toHaveLength(2)
    expect(injected[0]).toMatchObject({
      item: { type: 'function_call', arguments: expect.stringContaining('"shouldSpeak":false') },
    })
    expect(injected[1]).toMatchObject({
      item: {
        type: 'function_call_output',
        output: expect.stringContaining('"shouldSpeak":false'),
      },
    })
    expect(socket.sent.map((item) => JSON.parse(item).type)).not.toContain('response.create')
  })

  it('can send a function output without asking the model to speak again', async () => {
    const socket = new FakeSocket()
    const client = new QwenAudioRealtimeClient({
      apiKey: 'secret',
      instructions: 'prompt',
      tools: [],
      createSocket: () => socket,
    })
    const connecting = client.connect()
    socket.emit('open')
    socket.server({ type: 'session.updated' })
    await connecting

    client.sendFunctionOutput('call-hang-up', { status: 'hang_up' }, { createResponse: false })

    const outputEvent = JSON.parse(socket.sent.at(-1)!)
    expect(outputEvent).toMatchObject({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: 'call-hang-up' },
    })
    expect(socket.sent.slice(-2).map((item) => JSON.parse(item).type)).not.toContain(
      'response.create',
    )
  })

  it('suppresses queued model responses after terminal hang up starts', async () => {
    const socket = new FakeSocket()
    const client = new QwenAudioRealtimeClient({
      apiKey: 'secret',
      instructions: 'prompt',
      tools: [],
      createSocket: () => socket,
    })
    const connecting = client.connect()
    socket.emit('open')
    socket.server({ type: 'session.updated' })
    await connecting

    socket.server({ type: 'response.created', response: { id: 'resp-active' } })
    client.sendFunctionOutput('call-before-hangup', { status: 'queued' })
    client.beginTerminalHangUp()
    client.sendFunctionOutput('call-hang-up', { status: 'ended' }, { createResponse: false })

    socket.server({ type: 'response.done', response: { id: 'resp-active' } })

    expect(
      socket.sent.map((item) => JSON.parse(item).type).filter((type) => type === 'response.create'),
    ).toHaveLength(0)
    const outputEvents = socket.sent
      .map((item) => JSON.parse(item))
      .filter((event) => event.item?.type === 'function_call_output')
    expect(outputEvents).toHaveLength(2)
    expect(outputEvents.at(-1)).toMatchObject({
      item: { call_id: 'call-hang-up' },
    })
  })

  it('seeds an incoming call with a user text item before the first response', async () => {
    const socket = new FakeSocket()
    const client = new QwenAudioRealtimeClient({
      apiKey: 'secret',
      instructions: 'prompt',
      tools: [],
      createSocket: () => socket,
    })
    const connecting = client.connect()
    socket.emit('open')
    socket.server({ type: 'session.updated' })
    await connecting

    client.createResponseFromUserText('用户已经接听来电，请先说明原因。')

    const seeded = socket.sent.slice(-2).map((item) => JSON.parse(item))
    expect(seeded[0]).toMatchObject({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '用户已经接听来电，请先说明原因。' }],
      },
    })
    expect(seeded[1]).toMatchObject({ type: 'response.create' })
  })

  it('updates session instructions for soft memory compaction without creating a response', async () => {
    const socket = new FakeSocket()
    const client = new QwenAudioRealtimeClient({
      apiKey: 'secret',
      instructions: 'prompt',
      tools: [],
      createSocket: () => socket,
    })
    const connecting = client.connect()
    socket.emit('open')
    socket.server({ type: 'session.updated' })
    await connecting

    const before = socket.sent.length
    client.updateInstructions('prompt with compacted memory')

    const sent = socket.sent.slice(before).map((item) => JSON.parse(item))
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      type: 'session.update',
      session: { instructions: 'prompt with compacted memory' },
    })
    expect(sent[0].session.turn_detection).toBeUndefined()
    expect(sent[0].session.input_audio_format).toBeUndefined()
    expect(sent.map((event) => event.type)).not.toContain('response.create')
  })

  it('queues and coalesces response creation while a response is active', async () => {
    const socket = new FakeSocket()
    const client = new QwenAudioRealtimeClient({
      apiKey: 'secret',
      instructions: 'prompt',
      tools: [],
      createSocket: () => socket,
    })
    const connecting = client.connect()
    socket.emit('open')
    socket.server({ type: 'session.updated' })
    await connecting

    socket.server({ type: 'response.created', response: { id: 'resp-active' } })
    const beforeOutputs = socket.sent.length
    client.sendFunctionOutput('call-1', { status: 'delivered' })
    client.injectConversationMessage({
      projectId: 'p1',
      projectName: 'Shennian',
      conversationId: 's1',
      conversationTitle: '语音功能',
      message: 'done',
    })

    const whileActive = socket.sent.slice(beforeOutputs).map((item) => JSON.parse(item).type)
    expect(whileActive).toEqual([
      'conversation.item.create',
      'conversation.item.create',
      'conversation.item.create',
    ])

    socket.server({ type: 'response.done', response: { id: 'resp-active' } })
    expect(
      socket.sent.map((item) => JSON.parse(item).type).filter((type) => type === 'response.create'),
    ).toHaveLength(1)
  })

  it('ignores the harmless response.cancel race after audio finishes', async () => {
    const socket = new FakeSocket()
    const onError = vi.fn()
    const client = new QwenAudioRealtimeClient({
      apiKey: 'secret',
      instructions: 'prompt',
      tools: [],
      createSocket: () => socket,
      callbacks: { onError },
    })
    const connecting = client.connect()
    socket.emit('open')
    socket.server({ type: 'session.updated' })
    await connecting

    socket.server({ type: 'response.created', response: { id: 'resp-race' } })
    socket.server({ type: 'input_audio_buffer.speech_started' })
    socket.server({
      type: 'error',
      error: { code: 'invalid_value', message: 'Conversation has no active response.' },
    })

    expect(onError).not.toHaveBeenCalled()
  })

  it('ignores the harmless server VAD/manual response race', async () => {
    const socket = new FakeSocket()
    const onError = vi.fn()
    const client = new QwenAudioRealtimeClient({
      apiKey: 'secret',
      instructions: 'prompt',
      tools: [],
      createSocket: () => socket,
      callbacks: { onError },
    })
    const connecting = client.connect()
    socket.emit('open')
    socket.server({ type: 'session.updated' })
    await connecting

    socket.server({ type: 'response.created', response: { id: 'resp-manual' } })
    socket.server({
      type: 'error',
      error: {
        code: 'invalid_request_error',
        message:
          'Server VAD turn committed but no response was created because a manual response is already in progress.',
      },
    })

    expect(onError).not.toHaveBeenCalled()
    expect(socket.close).not.toHaveBeenCalled()
  })

  it('reports an unexpected upstream close as recoverable after the session is ready', async () => {
    const socket = new FakeSocket()
    const onError = vi.fn()
    const client = new QwenAudioRealtimeClient({
      apiKey: 'secret',
      instructions: 'prompt',
      tools: [],
      createSocket: () => socket,
      callbacks: { onError },
    })
    const connecting = client.connect()
    socket.emit('open')
    socket.server({ type: 'session.updated' })
    await connecting

    socket.emit('close', 1006, Buffer.from('network lost'))

    expect(onError).toHaveBeenCalledWith({
      code: 'upstream_closed',
      message: expect.stringContaining('1006 network lost'),
      recoverable: true,
    })
  })
})
