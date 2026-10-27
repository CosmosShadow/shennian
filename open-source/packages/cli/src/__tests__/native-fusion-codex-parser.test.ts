// @covers open-source/packages/cli/src/native-fusion/parsers.ts
// @covers open-source/packages/cli/src/native-fusion/codex-files.ts

import fs from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { parseCodexRolloutChunk } from '../native-fusion/parsers.js'
import { cleanupNativeParserTest, writeTempFile } from './native-fusion-parser-harness.js'

describe('native-fusion Codex parser edge cases', () => {
  afterEach(cleanupNativeParserTest)
  it('does not import codex injected AGENTS.md project instructions as user chat text', () => {
    const projectInstructions = [
      '# AGENTS.md instructions for /Users/example/Documents/code/projects/shennian',
      '',
      '<INSTRUCTIONS>',
      '# Shennian（神念）',
      '',
      '随时随地，掌控你的 AI Agent。',
      '</INSTRUCTIONS>',
      '<environment_context>',
      '  <cwd>/Users/example/Documents/code/projects/shennian</cwd>',
      '  <shell>zsh</shell>',
      '  <current_date>2026-05-29</current_date>',
      '  <timezone>Asia/Shanghai</timezone>',
      '</environment_context>',
    ].join('\n')
    const filePath = writeTempFile(
      'rollout-agents-instructions.jsonl',
      [
        JSON.stringify({
          timestamp: '2026-05-29T10:00:00.000Z',
          type: 'session_meta',
          payload: {
            id: 'thread-agents-instructions-1',
            cwd: '/tmp/demo',
            model_provider: 'OpenAI',
          },
        }),
        JSON.stringify({
          timestamp: '2026-05-29T10:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: projectInstructions }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-05-29T10:00:02.000Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: projectInstructions },
        }),
        JSON.stringify({
          timestamp: '2026-05-29T10:00:03.000Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: '真实用户问题' },
        }),
        '',
      ].join('\n'),
    )

    const parsed = parseCodexRolloutChunk(filePath, 0)
    expect(parsed.events.map((event) => event.payload)).toEqual(['真实用户问题'])
  })

  it('filters recommended_plugins plus AGENTS and environment context as one injected payload', () => {
    const injected = [
      '<recommended_plugins>',
      '- Example (example@plugin)',
      '</recommended_plugins>',
      '# AGENTS.md instructions for /tmp/project',
      '<INSTRUCTIONS>',
      'project instructions',
      '</INSTRUCTIONS>',
      '<environment_context>',
      '<cwd>/tmp/project</cwd>',
      '<shell>zsh</shell>',
      '</environment_context>',
    ].join('\n')
    const filePath = writeTempFile(
      'rollout-recommended-plugins-context.jsonl',
      [
        JSON.stringify({
          timestamp: '2026-09-01T10:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'thread-context', cwd: '/tmp/project' },
        }),
        JSON.stringify({
          timestamp: '2026-09-01T10:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: injected }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-09-01T10:00:02.000Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: '真正的问题' },
        }),
        '',
      ].join('\n'),
    )

    expect(parseCodexRolloutChunk(filePath, 0).events.map((event) => event.payload)).toEqual([
      '真正的问题',
    ])
  })

  it('does not import codex turn_aborted control XML as chat text', () => {
    const aborted =
      '<turn_aborted> The user interrupted the previous turn on purpose. </turn_aborted>'
    const filePath = writeTempFile(
      'rollout-turn-aborted.xml.jsonl',
      [
        JSON.stringify({
          timestamp: '2026-05-28T10:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'thread-turn-aborted-1', cwd: '/tmp/demo', model_provider: 'OpenAI' },
        }),
        JSON.stringify({
          timestamp: '2026-05-28T10:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'agent_message', message: aborted },
        }),
        JSON.stringify({
          timestamp: '2026-05-28T10:00:02.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: aborted }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-05-28T10:00:03.000Z',
          type: 'event_msg',
          payload: { type: 'agent_message', message: 'normal reply after abort' },
        }),
        '',
      ].join('\n'),
    )

    const parsed = parseCodexRolloutChunk(filePath, 0)
    expect(parsed.events.map((event) => event.payload)).toEqual(['normal reply after abort'])
  })

  it('marks a Codex turn_aborted without a message as an aborted terminal', () => {
    const filePath = writeTempFile(
      'rollout-turn-aborted-terminal.jsonl',
      [
        JSON.stringify({
          timestamp: '2026-09-03T08:10:00.000Z',
          type: 'session_meta',
          payload: {
            id: 'thread-turn-aborted-terminal',
            cwd: '/tmp/demo',
            model_provider: 'OpenAI',
          },
        }),
        JSON.stringify({
          timestamp: '2026-09-03T08:10:01.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'partial reply before stop' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-09-03T08:10:02.000Z',
          type: 'event_msg',
          payload: { type: 'turn_aborted' },
        }),
        '',
      ].join('\n'),
    )

    const parsed = parseCodexRolloutChunk(filePath, 0)
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]).toMatchObject({
      role: 'agent',
      payload: 'partial reply before stop',
      terminal: true,
      terminalState: 'aborted',
    })
  })

  it('imports codex approval requests as structured pending confirmation payloads', () => {
    const filePath = writeTempFile(
      'rollout-approval-request.jsonl',
      [
        JSON.stringify({
          timestamp: '2026-05-28T10:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'thread-approval-1', cwd: '/tmp/demo', model_provider: 'OpenAI' },
        }),
        JSON.stringify({
          timestamp: '2026-05-28T10:00:01.000Z',
          type: 'event_msg',
          payload: {
            type: 'approval_request',
            command: 'rm -rf dist',
            reason: 'Codex needs permission before running this command.',
          },
        }),
        '',
      ].join('\n'),
    )

    const parsed = parseCodexRolloutChunk(filePath, 0)
    expect(parsed.events).toHaveLength(1)
    expect(JSON.parse(parsed.events[0]!.payload)).toEqual(
      expect.objectContaining({
        v: 1,
        type: 'approval_pending',
        title: '需要用户确认',
        content: 'Codex needs permission before running this command.',
        source: 'codex',
      }),
    )
  })

  it('keeps codex user text that merely mentions environment_context', () => {
    const text = '请解释这个标签：<environment_context>，它为什么会出现在日志里？'
    const filePath = writeTempFile(
      'rollout-environment-context-mention.jsonl',
      [
        JSON.stringify({
          timestamp: '2026-05-27T10:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'thread-env-mention-1', cwd: '/tmp/demo', model_provider: 'OpenAI' },
        }),
        JSON.stringify({
          timestamp: '2026-05-27T10:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: text },
        }),
        '',
      ].join('\n'),
    )

    const parsed = parseCodexRolloutChunk(filePath, 0)
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]).toMatchObject({
      role: 'user',
      payload: text,
    })
  })

  it('does not duplicate codex event_msg and response_item message chat records', () => {
    const filePath = writeTempFile(
      'rollout-response-dedupe.jsonl',
      [
        JSON.stringify({
          timestamp: '2026-04-23T10:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'thread-response-dedupe-1', cwd: '/tmp/demo', model_provider: 'OpenAI' },
        }),
        JSON.stringify({
          timestamp: '2026-04-23T10:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'agent_message', message: 'same assistant text' },
        }),
        JSON.stringify({
          timestamp: '2026-04-23T10:00:02.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'same assistant text' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-04-23T10:00:03.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'same user text' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-04-23T10:00:04.000Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: 'same user text' },
        }),
        '',
      ].join('\n'),
    )

    const parsed = parseCodexRolloutChunk(filePath, 0)
    expect(parsed.events).toHaveLength(2)
    expect(parsed.events.map((event) => event.payload)).toEqual([
      'same assistant text',
      'same user text',
    ])
    expect(parsed.events[0]!.sourceEventKey).toContain('agent_message')
    expect(parsed.events[1]!.sourceEventKey).toContain('user_message')
  })

  it('marks the last codex agent message as terminal for task_complete and turn_complete', () => {
    for (const terminalType of ['task_complete', 'turn_complete']) {
      const filePath = writeTempFile(
        `rollout-${terminalType}.jsonl`,
        [
          JSON.stringify({
            timestamp: '2026-04-23T10:00:00.000Z',
            type: 'session_meta',
            payload: { id: `thread-${terminalType}-1`, cwd: '/tmp/demo', model_provider: 'OpenAI' },
          }),
          JSON.stringify({
            timestamp: '2026-04-23T10:00:01.000Z',
            type: 'response_item',
            payload: {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: `final for ${terminalType}` }],
            },
          }),
          JSON.stringify({
            timestamp: '2026-04-23T10:00:02.000Z',
            type: 'event_msg',
            payload: { type: terminalType },
          }),
          '',
        ].join('\n'),
      )

      const parsed = parseCodexRolloutChunk(filePath, 0)
      expect(parsed.events).toHaveLength(1)
      expect(parsed.events[0]).toMatchObject({
        role: 'agent',
        payload: `final for ${terminalType}`,
        terminal: true,
      })
    }
  })

  it('keeps all input_text when codex response_item message also contains input_image', () => {
    const imagePath = '/Users/example/.codex/generated_images/thread-response-user-image-1/input.png'
    const filePath = writeTempFile(
      'rollout-response-user-image.jsonl',
      [
        JSON.stringify({
          timestamp: '2026-04-23T10:00:00.000Z',
          type: 'session_meta',
          payload: {
            id: 'thread-response-user-image-1',
            cwd: '/tmp/demo',
            model_provider: 'OpenAI',
          },
        }),
        JSON.stringify({
          timestamp: '2026-04-23T10:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: '第一段文本' },
              { type: 'input_image', path: imagePath },
              { type: 'input_text', text: '第二段文本' },
            ],
          },
        }),
        '',
      ].join('\n'),
    )

    const parsed = parseCodexRolloutChunk(filePath, 0)
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]!.payload).toBe(
      JSON.stringify({
        v: 1,
        type: 'user',
        content: '第一段文本\n\n第二段文本',
        attachments: [
          {
            path: imagePath,
            name: 'input.png',
            mimeType: 'image/png',
            kind: 'image',
          },
        ],
      }),
    )
  })

  it('strips Codex app context wrapper from response_item user messages and dedupes event_msg echo', () => {
    const imagePath = '/Users/example/Downloads/IMG_7304.PNG'
    const realRequest = '这个输入框和内容的左右好像没有对齐啊。'
    const wrappedRequest = [
      'In app browser:',
      '- The user has the in-app browser open.',
      '- Current URL:',
      'https://shennian.net/share/BIQtiWr7MUXHeA',
      '',
      'My request for Codex:',
      realRequest,
      '<image> </image>',
    ].join('\n')
    const filePath = writeTempFile(
      'rollout-codex-app-context-wrapper.jsonl',
      [
        JSON.stringify({
          timestamp: '2026-04-23T10:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'thread-wrapper-1', cwd: '/tmp/demo', model_provider: 'OpenAI' },
        }),
        JSON.stringify({
          timestamp: '2026-04-23T10:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: wrappedRequest },
              { type: 'input_image', path: imagePath },
            ],
          },
        }),
        JSON.stringify({
          timestamp: '2026-04-23T10:00:02.000Z',
          type: 'event_msg',
          payload: {
            type: 'user_message',
            message: wrappedRequest,
            text_elements: [{ type: 'text', text: realRequest }],
            local_images: [{ path: imagePath }],
          },
        }),
        '',
      ].join('\n'),
    )

    const parsed = parseCodexRolloutChunk(filePath, 0)
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]).toMatchObject({
      role: 'user',
      title: realRequest,
    })
    expect(parsed.events[0]!.payload).toBe(
      JSON.stringify({
        v: 1,
        type: 'user',
        content: realRequest,
        attachments: [
          {
            path: imagePath,
            name: 'IMG_7304.PNG',
            mimeType: 'image/png',
            kind: 'image',
          },
        ],
      }),
    )
    expect(parsed.events[0]!.payload).not.toContain('In app browser')
    expect(parsed.events[0]!.payload).not.toContain('<image>')
  })

  it('parses appended codex agent messages when session_meta exceeds 8KB', () => {
    const hugeInstructions = 'x'.repeat(12 * 1024)
    const filePath = writeTempFile(
      'rollout-long-meta.jsonl',
      [
        JSON.stringify({
          timestamp: '2026-04-23T10:00:00.000Z',
          type: 'session_meta',
          payload: {
            id: 'thread-long-meta-1',
            cwd: '/tmp/demo',
            model_provider: 'OpenAI',
            base_instructions: { text: hugeInstructions },
          },
        }),
        JSON.stringify({
          timestamp: '2026-04-23T10:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: 'hello long meta' },
        }),
        '',
      ].join('\n'),
    )

    const first = parseCodexRolloutChunk(filePath, 0)
    expect(first.events).toHaveLength(1)

    fs.appendFileSync(
      filePath,
      `${JSON.stringify({
        timestamp: '2026-04-23T10:00:03.000Z',
        type: 'event_msg',
        payload: { type: 'agent_message', message: 'reply after long meta' },
      })}\n`,
    )

    const second = parseCodexRolloutChunk(filePath, first.nextOffset)
    expect(second.events).toHaveLength(1)
    expect(second.events[0]).toMatchObject({
      sourceSessionKey: 'thread-long-meta-1',
      role: 'agent',
      payload: 'reply after long meta',
      modelId: null,
      workDir: '/tmp/demo',
    })
  })

  it('strips git directives from codex rollout agent messages', () => {
    const filePath = writeTempFile(
      'rollout-git.jsonl',
      [
        JSON.stringify({
          timestamp: '2026-04-23T10:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'thread-git-1', cwd: '/tmp/demo', model_provider: 'OpenAI' },
        }),
        JSON.stringify({
          timestamp: '2026-04-23T10:00:02.000Z',
          type: 'event_msg',
          payload: {
            type: 'agent_message',
            message: [
              '修复完成。',
              '',
              '::git-stage{cwd="/Users/example/Documents/code/projects/shennian"}',
              '::git-commit{cwd="/Users/example/Documents/code/projects/shennian"}',
            ].join('\n'),
          },
        }),
        '',
      ].join('\n'),
    )

    const parsed = parseCodexRolloutChunk(filePath, 0)
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]).toMatchObject({
      role: 'agent',
      payload: '修复完成。',
    })
  })

  it('imports codex generated images from saved_path without syncing base64 result', () => {
    const generatedPath = '/Users/example/.codex/generated_images/thread-image-1/ig_abc.png'
    const filePath = writeTempFile(
      'rollout-image.jsonl',
      [
        JSON.stringify({
          timestamp: '2026-04-23T10:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'thread-image-1', cwd: '/tmp/demo', model_provider: 'OpenAI' },
        }),
        JSON.stringify({
          timestamp: '2026-04-23T10:00:02.000Z',
          type: 'event_msg',
          payload: {
            type: 'image_generation_end',
            call_id: 'ig_abc',
            status: 'completed',
            result: 'iVBORw0KGgoAAAANSUhEUgAA'.repeat(10),
            saved_path: generatedPath,
          },
        }),
        JSON.stringify({
          timestamp: '2026-04-23T10:00:03.000Z',
          type: 'response_item',
          payload: {
            type: 'image_generation_call',
            id: 'ig_abc',
            status: 'completed',
            result: 'iVBORw0KGgoAAAANSUhEUgAA'.repeat(10),
          },
        }),
        JSON.stringify({
          timestamp: '2026-04-23T10:00:04.000Z',
          type: 'event_msg',
          payload: { type: 'agent_message', message: '' },
        }),
        '',
      ].join('\n'),
    )

    const parsed = parseCodexRolloutChunk(filePath, 0)
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]).toMatchObject({
      agentType: 'codex',
      sourceSessionKey: 'thread-image-1',
      role: 'agent',
      workDir: '/tmp/demo',
    })
    expect(JSON.parse(parsed.events[0]!.payload)).toEqual({
      v: 1,
      type: 'image',
      content: `![ig_abc.png](<${generatedPath}>)`,
      attachments: [
        {
          path: generatedPath,
          name: 'ig_abc.png',
          mimeType: 'image/png',
          kind: 'image',
        },
      ],
    })
    expect(parsed.events[0]!.payload).not.toContain('iVBORw0')
    expect(parsed.events[0]!.sourceEventKey).toContain('image_generation_end')
  })

  it('parses codex user_message local_images into structured user attachments', () => {
    const imagePath = '/Users/example/.codex/generated_images/thread-user-1/ig_user.png'
    const filePath = writeTempFile(
      'rollout-user-image.jsonl',
      [
        JSON.stringify({
          timestamp: '2026-04-23T10:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'thread-user-1', cwd: '/tmp/demo', model_provider: 'OpenAI' },
        }),
        JSON.stringify({
          timestamp: '2026-04-23T10:00:01.000Z',
          type: 'event_msg',
          payload: {
            type: 'user_message',
            message: [
              'Files mentioned by the user:',
              '',
              `ig_user.png: ${imagePath}`,
              '',
              'My request for Codex:',
              '这是一条用户真实输入',
            ].join('\n'),
            text_elements: [{ type: 'text', text: '这是一条用户真实输入' }],
            local_images: [{ path: imagePath }],
          },
        }),
        '',
      ].join('\n'),
    )

    const parsed = parseCodexRolloutChunk(filePath, 0)
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]).toMatchObject({
      role: 'user',
      sourceSessionKey: 'thread-user-1',
      title: '这是一条用户真实输入',
    })
    expect(parsed.events[0]!.payload).toBe(
      JSON.stringify({
        v: 1,
        type: 'user',
        content: '这是一条用户真实输入',
        attachments: [
          {
            path: imagePath,
            name: 'ig_user.png',
            mimeType: 'image/png',
            kind: 'image',
          },
        ],
      }),
    )
  })
})
