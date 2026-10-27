import { describe, it, expect } from 'vitest'
import { convertMessages, type PiMessage } from '../routes/agent-proxy.js'

const FAKE_B64 = 'iVBORw0KGgoAAAANSUhEUg=='
const FAKE_MIME = 'image/png'

describe('convertMessages', () => {
  it('converts a simple user text message', () => {
    const msgs: PiMessage[] = [
      { role: 'user', content: 'hello' },
    ]
    const result = convertMessages(undefined, msgs) as Array<Record<string, unknown>>
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ role: 'user', content: 'hello' })
  })

  it('prepends system prompt when provided', () => {
    const result = convertMessages('You are helpful.', []) as Array<Record<string, unknown>>
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ role: 'system', content: 'You are helpful.' })
  })

  it('converts assistant message with tool calls', () => {
    const msgs: PiMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text' as const, text: 'Let me read the image.' },
          { type: 'toolCall' as const, id: 'tc1', name: 'read_image', arguments: { path: '/tmp/test.png' } },
        ],
      },
    ]
    const result = convertMessages(undefined, msgs) as Array<Record<string, unknown>>
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      role: 'assistant',
      content: 'Let me read the image.',
      tool_calls: [
        { id: 'tc1', type: 'function', function: { name: 'read_image', arguments: '{"path":"/tmp/test.png"}' } },
      ],
    })
  })

  it('converts tool result with proper ImageContent into tool + user messages', () => {
    const msgs: PiMessage[] = [
      {
        role: 'toolResult',
        toolCallId: 'tc1',
        toolName: 'read_image',
        content: [{ type: 'image' as const, data: FAKE_B64, mimeType: FAKE_MIME }],
        isError: false,
      },
    ]
    const result = convertMessages(undefined, msgs) as Array<Record<string, unknown>>
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      role: 'tool',
      tool_call_id: 'tc1',
      content: '图片已读取，见下条消息',
    })
    expect(result[1]).toEqual({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${FAKE_MIME};base64,${FAKE_B64}` } },
      ],
    })
  })

  it('parses JSON-serialized ImageContent from pi-agent-core (the real bug)', () => {
    // pi-agent-core serializes ImageContent as JSON text inside a TextContent
    const serialized = JSON.stringify({
      content: [{ type: 'image', data: FAKE_B64, mimeType: FAKE_MIME }],
    })
    const msgs: PiMessage[] = [
      {
        role: 'toolResult',
        toolCallId: 'tc2',
        toolName: 'read_image',
        content: [{ type: 'text' as const, text: serialized }],
        isError: false,
      },
    ]
    const result = convertMessages(undefined, msgs) as Array<Record<string, unknown>>
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      role: 'tool',
      tool_call_id: 'tc2',
      content: '图片已读取，见下条消息',
    })
    expect(result[1]).toEqual({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${FAKE_MIME};base64,${FAKE_B64}` } },
      ],
    })
  })

  it('handles tool result with text only (no images)', () => {
    const msgs: PiMessage[] = [
      {
        role: 'toolResult',
        toolCallId: 'tc3',
        toolName: 'read_file',
        content: [{ type: 'text' as const, text: 'file contents here' }],
        isError: false,
      },
    ]
    const result = convertMessages(undefined, msgs) as Array<Record<string, unknown>>
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      role: 'tool',
      tool_call_id: 'tc3',
      content: 'file contents here',
    })
  })

  it('handles user message with inline images', () => {
    const msgs: PiMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text' as const, text: '这是什么?' },
          { type: 'image' as const, data: FAKE_B64, mimeType: FAKE_MIME },
        ],
      },
    ]
    const result = convertMessages(undefined, msgs) as Array<Record<string, unknown>>
    expect(result).toHaveLength(1)
    const content = result[0].content as Array<Record<string, unknown>>
    expect(content).toHaveLength(2)
    expect(content[0]).toEqual({ type: 'text', text: '这是什么?' })
    expect(content[1]).toEqual({ type: 'image_url', image_url: { url: `data:${FAKE_MIME};base64,${FAKE_B64}` } })
  })

  it('full round-trip: user → assistant(tool_call) → toolResult(image) → correct output', () => {
    const msgs: PiMessage[] = [
      { role: 'user', content: '@.uploads/test.png 这是什么?' },
      {
        role: 'assistant',
        content: [
          { type: 'text' as const, text: 'Let me take a look at the image.' },
          { type: 'toolCall' as const, id: 'call_abc', name: 'read_image', arguments: { path: '/Users/test/.uploads/test.png' } },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: 'call_abc',
        toolName: 'read_image',
        content: [{ type: 'text' as const, text: JSON.stringify({ content: [{ type: 'image', data: FAKE_B64, mimeType: FAKE_MIME }] }) }],
        isError: false,
      },
    ]
    const result = convertMessages('你是助手', msgs) as Array<Record<string, unknown>>

    // system + user + assistant + tool + injected user(image) = 5
    expect(result).toHaveLength(5)
    expect(result[0]).toMatchObject({ role: 'system' })
    expect(result[1]).toMatchObject({ role: 'user' })
    expect(result[2]).toMatchObject({ role: 'assistant', tool_calls: expect.any(Array) })
    expect(result[3]).toMatchObject({ role: 'tool', content: '图片已读取，见下条消息' })
    expect(result[4]).toMatchObject({
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: expect.stringContaining('base64') } }],
    })
  })

  it('does not parse non-image JSON as images', () => {
    const msgs: PiMessage[] = [
      {
        role: 'toolResult',
        toolCallId: 'tc4',
        toolName: 'bash',
        content: [{ type: 'text' as const, text: '{"status":"ok","exit_code":0}' }],
        isError: false,
      },
    ]
    const result = convertMessages(undefined, msgs) as Array<Record<string, unknown>>
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      role: 'tool',
      tool_call_id: 'tc4',
      content: '{"status":"ok","exit_code":0}',
    })
  })
})
