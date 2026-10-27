import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useChatStore, type ChatMessage } from '../stores/chat'
import { chatMessageToEnvelope, envelopeToChatMessage } from '../stores/chat'

describe('chat store v2 behavior', () => {
  it('preserves actionable ACP permission options in canonical approval messages', () => {
    const permission = {
      id: 'permission-1',
      toolCallId: 'tool-1',
      options: [
        { id: 'allow', name: 'Allow once', kind: 'allow_once' as const },
        { id: 'reject', name: 'Reject once', kind: 'reject_once' as const },
      ],
    }
    const message = envelopeToChatMessage({
      id: 'approval', sessionId: 'session', role: 'agent', ts: 1,
      payload: JSON.stringify({
        v: 1, type: 'approval_pending', title: 'Edit file', content: 'Permission required',
        source: 'acp', permission,
      }),
    })
    expect(message.approval?.permission).toEqual(permission)
    expect(message.approval?.actionHint).toBeUndefined()
  })

  it('projects canonical delivery state without changing the message identity', () => {
    const envelope = {
      id: 'client-message-1',
      sessionId: 'session-1',
      role: 'user' as const,
      ts: 1,
      payload: JSON.stringify({ v: 1, type: 'user', content: 'same prompt' }),
    }

    expect(envelopeToChatMessage(envelope, 'queued')).toMatchObject({
      id: 'client-message-1',
      deliveryState: 'queued',
      status: 'sending',
      queueMessageId: 'client-message-1',
    })
    expect(envelopeToChatMessage(envelope, 'executing')).toMatchObject({
      id: 'client-message-1',
      deliveryState: 'executing',
      status: 'sent',
    })
  })
  beforeEach(() => {
    useChatStore.getState().clear()
  })

  it('upsertMessage updates existing message by id', () => {
    const store = useChatStore.getState()
    store.setSessionId('s1')
    store.setMessages([{ id: 'msg-1', role: 'agent', ts: 100, content: 'hel' }])

    useChatStore.getState().upsertMessage({
      id: 'msg-1',
      role: 'agent',
      ts: 100,
      content: 'hello world',
    })

    const messages = useChatStore.getState().messages
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      id: 'msg-1',
      content: 'hello world',
    })
  })

  it('reorders a queued user at dispatch so replies remain in their own turns', () => {
    useChatStore.getState().setMessages([
      { id: 'a', role: 'user', ts: 100, content: 'A' },
      { id: 'b', role: 'user', ts: 110, content: 'B', deliveryState: 'queued' },
      { id: 'reply-a', role: 'agent', ts: 200, content: 'answer A' },
    ])
    useChatStore.getState().upsertMessage({
      id: 'b', role: 'user', ts: 210, content: 'B', deliveryState: 'executing',
    })
    useChatStore.getState().appendMessage({ id: 'reply-b', role: 'agent', ts: 300, content: 'answer B' })
    expect(useChatStore.getState().messages.map(message => message.id))
      .toEqual(['a', 'reply-a', 'b', 'reply-b'])
  })

  it('upsertMessage appends new message in sorted order', () => {
    const store = useChatStore.getState()
    store.setSessionId('s1')
    store.setMessages([
      { id: 'msg-1', role: 'user', ts: 100, content: 'hi' },
      { id: 'msg-3', role: 'agent', ts: 300, content: 'bye' },
    ])

    useChatStore.getState().upsertMessage({
      id: 'msg-2',
      role: 'agent',
      ts: 200,
      content: 'hello',
    })

    const messages = useChatStore.getState().messages
    expect(messages).toHaveLength(3)
    expect(messages.map((m) => m.id)).toEqual(['msg-1', 'msg-2', 'msg-3'])
  })

  it('upserts a live batch with one store notification and one final ordering pass', () => {
    useChatStore.getState().setMessages([
      { id: 'msg-1', role: 'agent', ts: 100, content: 'running' },
    ])
    const listener = vi.fn()
    const unsubscribe = useChatStore.subscribe(listener)

    useChatStore.getState().upsertMessages([
      { id: 'msg-2', role: 'agent', ts: 300, content: 'later' },
      { id: 'msg-1', role: 'agent', ts: 100, content: 'completed' },
      { id: 'msg-middle', role: 'agent', ts: 200, content: 'middle' },
    ])

    expect(listener).toHaveBeenCalledTimes(1)
    expect(useChatStore.getState().messages.map((message) => message.id)).toEqual([
      'msg-1',
      'msg-middle',
      'msg-2',
    ])
    expect(useChatStore.getState().messages[0].content).toBe('completed')
    unsubscribe()
  })

  it('keeps late native messages in source timestamp order', () => {
    const store = useChatStore.getState()
    store.setSessionId('s1')
    store.setMessages([{ id: 'user-new', role: 'user', ts: 300, content: 'hello' }])

    useChatStore.getState().appendMessage({
      id: 'agent-old',
      role: 'agent',
      ts: 200,
      content: 'older native reply imported later',
    })
    useChatStore.getState().addMessage({
      id: 'user-oldest',
      role: 'user',
      ts: 100,
      content: 'oldest message',
    })

    expect(useChatStore.getState().messages.map((message) => message.id)).toEqual([
      'user-oldest',
      'agent-old',
      'user-new',
    ])
  })

  it('converts legacy tool_use and tool_result payloads into tool messages', () => {
    expect(
      envelopeToChatMessage({
        id: 'tool-use',
        sessionId: 's1',
        role: 'agent',
        ts: 100,
        payload: JSON.stringify({
          v: 1,
          type: 'tool_use',
          name: 'shell_command',
          args: { command: 'pwd' },
        }),
      }),
    ).toMatchObject({
      id: 'tool-use',
      content: '',
      toolCalls: [{ name: 'shell_command', args: { command: 'pwd' } }],
    })

    expect(
      envelopeToChatMessage({
        id: 'tool-result',
        sessionId: 's1',
        role: 'agent',
        ts: 101,
        payload: JSON.stringify({
          v: 1,
          type: 'tool_result',
          name: 'shell_command',
          result: '/tmp',
        }),
      }),
    ).toMatchObject({
      id: 'tool-result',
      content: '',
      toolCalls: [{ name: 'shell_command', result: '/tmp' }],
    })
  })

  it('ignores historical thinking content while hydrating chat messages', () => {
    expect(
      envelopeToChatMessage({
        id: 'thinking-message',
        sessionId: 's1',
        role: 'agent',
        ts: 100,
        payload: JSON.stringify({
          v: 1,
          content: 'Visible answer',
          thinking: 'Codex API temporarily unavailable, retrying 2/5...',
        }),
      }),
    ).toEqual({
      id: 'thinking-message',
      role: 'agent',
      ts: 100,
      content: 'Visible answer',
      attachments: undefined,
      status: undefined,
    })
  })

  it('preserves safe tool detail metadata while hydrating tool payloads', () => {
    const hydrated = envelopeToChatMessage({
      id: 'tool-safe-meta',
      sessionId: 's1',
      role: 'agent',
      ts: 100,
      payload: JSON.stringify({
        v: 1,
        type: 'tool',
        name: 'command_execution',
        status: 'completed',
        durationMs: 1_250,
        resultOmitted: true,
        detailAvailable: true,
        detailRef: { runId: 'run-safe', sourceSeq: 7 },
        toolIndex: 0,
      }),
    })

    expect(hydrated).toMatchObject({
      id: 'tool-safe-meta',
      content: '',
      toolCalls: [
        {
          name: 'command_execution',
          status: 'completed',
          durationMs: 1_250,
          resultOmitted: true,
          detailAvailable: true,
          detailRef: { runId: 'run-safe', sourceSeq: 7 },
          toolIndex: 0,
        },
      ],
    })
  })

  it('hides previously saved Codex Apps page context while keeping real messages', () => {
    const payload = '<external_codex_apps_open_page>\n{"page_id":null}\n</external_codex_apps_open_page>'
    useChatStore.getState().setMessages([
      envelopeToChatMessage({ id: 'page-context', sessionId: 's1', role: 'user', ts: 100, payload }),
      envelopeToChatMessage({ id: 'request', sessionId: 's1', role: 'user', ts: 101, payload: '帮我创建分享链接。' }),
    ])
    expect(useChatStore.getState().messages.map((message) => message.content))
      .toEqual(['帮我创建分享链接。'])
  })

  it('hides previously saved Codex plugin context and retains the actual user request', () => {
    const payload = '<recommended_plugins>\n- Airtable (airtable@openai-curated-remote)\n</recommended_plugins>\n<environment_context><cwd>/tmp/demo</cwd><shell>zsh</shell><current_date>2026-09-06</current_date><timezone>Asia/Shanghai</timezone></environment_context>'
    useChatStore.getState().setMessages([
      envelopeToChatMessage({ id: 'plugins', sessionId: 's1', role: 'user', ts: 100, payload }),
      envelopeToChatMessage({ id: 'request', sessionId: 's1', role: 'user', ts: 101, payload: '帮我重启一下音频。' }),
    ])
    expect(useChatStore.getState().messages.map((message) => message.content))
      .toEqual(['帮我重启一下音频。'])
  })

  it('does not render standalone environment_context metadata but keeps ordinary mentions', () => {
    const metadata = envelopeToChatMessage({
      id: 'meta1',
      sessionId: 's1',
      role: 'user',
      ts: 100,
      payload:
        '<environment_context>\n<cwd>/data/code/demo</cwd>\n<shell>zsh</shell>\n<current_date>2026-05-27</current_date>\n<timezone>Asia/Shanghai</timezone>\n</environment_context>',
    })
    const mention = envelopeToChatMessage({
      id: 'u1',
      sessionId: 's1',
      role: 'user',
      ts: 101,
      payload: '普通问题：为什么有 <environment_context>？',
    })

    useChatStore.getState().setMessages([metadata, mention])

    const messages = useChatStore.getState().messages
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      id: 'u1',
      content: '普通问题：为什么有 <environment_context>？',
    })
  })

  it('does not render historical turn_aborted control XML as a normal message', () => {
    const metadata = envelopeToChatMessage({
      id: 'abort1',
      sessionId: 's1',
      role: 'agent',
      ts: 100,
      payload: '<turn_aborted> The user interrupted the previous turn on purpose. </turn_aborted>',
    })
    const mention = envelopeToChatMessage({
      id: 'u1',
      sessionId: 's1',
      role: 'user',
      ts: 101,
      payload: '普通问题：为什么有 <turn_aborted>？',
    })

    useChatStore.getState().setMessages([metadata, mention])

    const messages = useChatStore.getState().messages
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      id: 'u1',
      content: '普通问题：为什么有 <turn_aborted>？',
    })
  })

  it('hydrates approval pending payloads as action-card messages', () => {
    const hydrated = envelopeToChatMessage({
      id: 'approval1',
      sessionId: 's1',
      role: 'agent',
      ts: 100,
      payload: JSON.stringify({
        v: 1,
        type: 'approval_pending',
        title: '需要用户确认',
        content: 'Codex 请求执行命令：rm -rf dist',
        source: 'codex',
      }),
    })

    expect(hydrated).toMatchObject({
      id: 'approval1',
      role: 'agent',
      content: 'Codex 请求执行命令：rm -rf dist',
      approval: {
        type: 'approval_pending',
        title: '需要用户确认',
        content: 'Codex 请求执行命令：rm -rf dist',
        source: 'codex',
        actionHint: expect.stringContaining('回到运行 Codex 的电脑/终端'),
      },
    })
  })

  it('restoreRunPhase sets run phase from session activity snapshot', () => {
    const store = useChatStore.getState()

    store.restoreRunPhase({
      sessionId: 's1',
      runId: 'run-1',
      runPhase: 'streaming_text',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    expect(useChatStore.getState()).toMatchObject({
      isTyping: true,
      runPhase: 'streaming_text',
      currentRunId: 'run-1',
    })

    store.restoreRunPhase(null)
    expect(useChatStore.getState()).toMatchObject({
      isTyping: false,
      runPhase: 'idle',
      currentRunId: null,
    })
  })

  it('does not publish a new state for an unchanged live activity snapshot', () => {
    const activity = {
      sessionId: 's1',
      runId: 'run-stable',
      runPhase: 'thinking' as const,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    useChatStore.getState().restoreRunPhase(activity)
    const stableState = useChatStore.getState()
    useChatStore.getState().restoreRunPhase({ ...activity, updatedAt: new Date().toISOString() })
    expect(useChatStore.getState()).toBe(stableState)
  })

  it('restoreRunPhase ignores stale activity snapshots', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-10T10:10:00.000Z'))
    try {
      const store = useChatStore.getState()

      store.restoreRunPhase({
        sessionId: 's1',
        runId: 'run-stale',
        runPhase: 'tool_running',
        startedAt: '2026-04-10T10:00:00.000Z',
        updatedAt: '2026-04-10T10:00:00.000Z',
      })

      expect(useChatStore.getState()).toMatchObject({
        isTyping: false,
        runPhase: 'idle',
        currentRunId: null,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('enters running state immediately after a local send before server events arrive', () => {
    const store = useChatStore.getState()

    store.startPendingRun()
    expect(useChatStore.getState()).toMatchObject({
      isTyping: true,
      runPhase: 'thinking',
    })

    store.clearPendingRun()
    expect(useChatStore.getState()).toMatchObject({
      isTyping: false,
      runPhase: 'idle',
      currentRunId: null,
    })
  })

  it('restoreRunPhase(null) preserves pending run (non-blocking adapter gap)', () => {
    const store = useChatStore.getState()

    store.startPendingRun()
    expect(useChatStore.getState()).toMatchObject({
      isTyping: true,
      runPhase: 'thinking',
      currentRunId: '__pending__',
    })

    // null activity during pending should NOT clear — the agent may not
    // have emitted any events yet (non-blocking adapters like Claude).
    store.restoreRunPhase(null)
    expect(useChatStore.getState()).toMatchObject({
      isTyping: true,
      runPhase: 'thinking',
      currentRunId: '__pending__',
    })
  })

  it('pending run is replaced by real activity then cleared by null activity', () => {
    const store = useChatStore.getState()

    store.startPendingRun()

    store.restoreRunPhase({
      sessionId: 's1',
      runId: 'run-fast',
      runPhase: 'streaming_text',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    expect(useChatStore.getState()).toMatchObject({
      currentRunId: 'run-fast',
      runPhase: 'streaming_text',
    })

    store.restoreRunPhase(null)
    expect(useChatStore.getState()).toMatchObject({
      isTyping: false,
      runPhase: 'idle',
      currentRunId: null,
    })
  })

  it('restoreRunPhase does not override a real tracked run', () => {
    const store = useChatStore.getState()

    // Simulate a real run being tracked via restoreRunPhase with a specific runId
    store.restoreRunPhase({
      sessionId: 's1',
      runId: 'run-real',
      runPhase: 'tool_running',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    expect(useChatStore.getState()).toMatchObject({
      isTyping: true,
      runPhase: 'tool_running',
      currentRunId: 'run-real',
    })

    // A startPendingRun should not override the real run
    store.startPendingRun()
    expect(useChatStore.getState()).toMatchObject({
      isTyping: true,
      runPhase: 'tool_running',
      currentRunId: 'run-real',
    })
  })

  it('keeps queued messages visible in the conversation flow', () => {
    const store = useChatStore.getState()
    store.setSessionId('s1')
    store.setMessages([
      { id: 'm1', role: 'agent', ts: 100, content: 'ready' },
      { id: 'user-q1', role: 'user', ts: 101, content: 'queued work', status: 'sending' },
    ])

    store.setQueue({
      sessionId: 's1',
      busy: true,
      pending: [
        {
          id: 'q1',
          sessionId: 's1',
          text: 'queued work',
          agentType: 'codex',
          workDir: '/tmp',
          clientMessageId: 'user-q1',
          createdAt: '2026-06-01T10:00:00.000Z',
          updatedAt: '2026-06-01T10:00:00.000Z',
        },
      ],
    })

    expect(useChatStore.getState().messages).toEqual([
      { id: 'm1', role: 'agent', ts: 100, content: 'ready' },
      {
        id: 'user-q1',
        role: 'user',
        ts: 101,
        content: 'queued work',
        status: 'sending',
        queueMessageId: 'q1',
      },
    ])
    expect(useChatStore.getState().queue?.pending.map((message) => message.id)).toEqual(['q1'])
  })

  it('hydrates a daemon-only queued message into the conversation flow', () => {
    const store = useChatStore.getState()
    store.setSessionId('s1')
    store.setQueue({
      sessionId: 's1',
      busy: true,
      pending: [
        {
          id: 'q1',
          sessionId: 's1',
          text: 'queued on another device',
          agentType: 'codex',
          workDir: '/tmp',
          clientMessageId: 'user-q1',
          createdAt: '2026-06-01T10:00:00.000Z',
          updatedAt: '2026-06-01T10:00:00.000Z',
        },
      ],
    })

    expect(useChatStore.getState().messages[0]).toMatchObject({
      id: 'user-q1',
      content: 'queued on another device',
      status: 'sending',
      queueMessageId: 'q1',
    })
  })

  it('updates a queued bubble in place after the daemon acknowledges an edit', () => {
    const store = useChatStore.getState()
    store.setSessionId('s1')
    store.setMessages([
      {
        id: 'user-q1',
        role: 'user',
        ts: 101,
        content: 'before edit',
        status: 'sending',
        queueMessageId: 'q1',
      },
    ])

    store.setQueue({
      sessionId: 's1',
      busy: true,
      pending: [
        {
          id: 'q1',
          sessionId: 's1',
          text: 'after edit',
          agentType: 'codex',
          workDir: '/tmp',
          clientMessageId: 'user-q1',
          attachments: [
            {
              path: '/tmp/.uploads/note.txt',
              name: 'note.txt',
              mimeType: 'text/plain',
              kind: 'file',
              byteSize: 4,
              sha256: 'a'.repeat(64),
            },
          ],
          createdAt: '2026-06-01T10:00:00.000Z',
          updatedAt: '2026-06-01T10:01:00.000Z',
        },
      ],
    })

    expect(useChatStore.getState().messages).toHaveLength(1)
    expect(useChatStore.getState().messages[0]).toMatchObject({
      id: 'user-q1',
      content: 'after edit',
      status: 'sending',
      queueMessageId: 'q1',
      attachments: [
        expect.objectContaining({
          path: '/tmp/.uploads/note.txt',
          sha256: 'a'.repeat(64),
        }),
      ],
    })
  })

  it('keeps a queued bubble visible while the daemon starts dispatching it', () => {
    const store = useChatStore.getState()
    store.setSessionId('s1')
    store.setMessages([
      {
        id: 'user-q1',
        role: 'user',
        ts: 101,
        content: 'next request',
        status: 'sending',
        queueMessageId: 'q1',
      },
    ])

    store.setQueue({ sessionId: 's1', busy: true, pending: [] })

    expect(useChatStore.getState().messages[0]).toMatchObject({
      id: 'user-q1',
      content: 'next request',
      status: 'sending',
    })
    expect(useChatStore.getState().messages[0].queueMessageId).toBeUndefined()
  })

  it('does not let a stale queue snapshot remove an already-started user message', () => {
    const store = useChatStore.getState()
    store.setSessionId('s1')
    store.setMessages([
      { id: 'm1', role: 'agent', ts: 100, content: 'first answer' },
      { id: 'user-q1', role: 'user', ts: 101, content: 'next request' },
      { id: 'm2', role: 'agent', ts: 102, content: 'second answer' },
    ])

    store.setQueue({
      sessionId: 's1',
      busy: true,
      pending: [
        {
          id: 'q1',
          sessionId: 's1',
          text: 'next request',
          agentType: 'codex',
          workDir: '/tmp',
          clientMessageId: 'user-q1',
          createdAt: '2026-08-23T09:31:19.000Z',
          updatedAt: '2026-08-23T09:31:19.000Z',
        },
      ],
    })

    expect(useChatStore.getState().messages.map((message) => message.id)).toEqual([
      'm1',
      'user-q1',
      'm2',
    ])
  })

  it('does not let a stale queue snapshot remove an acknowledged local user message', () => {
    const store = useChatStore.getState()
    store.setSessionId('s1')
    store.setMessages([
      { id: 'user-q1', role: 'user', ts: 101, content: 'accepted request', status: 'sent' },
    ])

    store.setQueue({
      sessionId: 's1',
      busy: true,
      pending: [
        {
          id: 'q1',
          sessionId: 's1',
          text: 'accepted request',
          agentType: 'codex',
          workDir: '/tmp',
          clientMessageId: 'user-q1',
          createdAt: '2026-08-23T09:31:19.000Z',
          updatedAt: '2026-08-23T09:31:19.000Z',
        },
      ],
    })

    expect(useChatStore.getState().messages.map((message) => message.id)).toEqual(['user-q1'])
  })

  it('serializes and hydrates user attachments via envelope payload', () => {
    const message: ChatMessage = {
      id: 'msg-attachment',
      role: 'user',
      ts: 123,
      content: '![shot.png](</Users/test/project/.uploads/shot.png>)\n\n帮我看看',
      attachments: [
        {
          path: '/Users/test/project/.uploads/shot.png',
          name: 'shot.png',
          mimeType: 'image/png',
          kind: 'image',
          previewData: 'abc123',
        },
      ],
    }

    const envelope = chatMessageToEnvelope(message, 's1')
    expect(envelope.payload).toContain('"type":"user"')
    expect(envelope.payload).toContain('/Users/test/project/.uploads/shot.png')

    const hydrated = envelopeToChatMessage(envelope)
    expect(hydrated).toMatchObject({
      id: 'msg-attachment',
      role: 'user',
      content: message.content,
      attachments: [
        {
          path: '/Users/test/project/.uploads/shot.png',
          name: 'shot.png',
          mimeType: 'image/png',
          kind: 'image',
        },
      ],
    })
  })

  it('keeps folder attachments when hydrating user payloads', () => {
    const message: ChatMessage = {
      id: 'msg-folder-attachment',
      role: 'user',
      ts: 124,
      content: '[zb-工作包](</home/zb-工作包>)',
      attachments: [
        {
          path: '/home/zb-工作包',
          name: 'zb-工作包',
          mimeType: 'inode/directory',
          kind: 'folder',
        },
      ],
    }

    const envelope = chatMessageToEnvelope(message, 's1')
    const hydrated = envelopeToChatMessage(envelope)

    expect(hydrated.attachments).toEqual([
      {
        path: '/home/zb-工作包',
        name: 'zb-工作包',
        mimeType: 'inode/directory',
        kind: 'folder',
      },
    ])
  })

  it('hydrates structured agent error payloads with error status', () => {
    const hydrated = envelopeToChatMessage({
      id: 'agent-error-1',
      sessionId: 's1',
      role: 'agent',
      ts: 123,
      payload: JSON.stringify({
        v: 1,
        type: 'error',
        content: 'Codex CLI exited unexpectedly',
      }),
    })

    expect(hydrated).toMatchObject({
      id: 'agent-error-1',
      role: 'agent',
      content: 'Codex CLI exited unexpectedly',
      status: 'error',
    })
  })

  it('hydrates structured agent image attachments', () => {
    const imagePath = '/Users/test/.codex/generated_images/thread/ig_abc.png'
    const hydrated = envelopeToChatMessage({
      id: 'agent-image-1',
      sessionId: 's1',
      role: 'agent',
      ts: 123,
      payload: JSON.stringify({
        v: 1,
        type: 'image',
        content: `![ig_abc.png](<${imagePath}>)`,
        attachments: [
          {
            path: imagePath,
            name: 'ig_abc.png',
            mimeType: 'image/png',
            kind: 'image',
          },
        ],
      }),
    })

    expect(hydrated).toMatchObject({
      id: 'agent-image-1',
      role: 'agent',
      content: `![ig_abc.png](<${imagePath}>)`,
      attachments: [
        {
          path: imagePath,
          name: 'ig_abc.png',
          mimeType: 'image/png',
          kind: 'image',
        },
      ],
    })
  })

  it('hydrates Codex markdown envelopes without collapsing blank lines or nested list indentation', () => {
    const markdown = [
      '# Codex Markdown 原样验证',
      '',
      '- **第一层重点**：包含 `inline code` 和普通说明',
      '  - 第二层 A：保留两个空格缩进',
      '  - 第二层 B：中间有 **bold**',
      '- 第一层第二项',
      '',
      '',
      '## 小结',
      '',
      '段落之间保留 Codex 原始空行。',
    ].join('\n')

    const hydrated = envelopeToChatMessage({
      id: 'agent-markdown-1',
      sessionId: 's1',
      role: 'agent',
      ts: 123,
      payload: markdown,
    })

    expect(hydrated.content).toBe(markdown)
    expect(chatMessageToEnvelope(hydrated, 's1').payload).toBe(markdown)
  })

  it('strips git directives when hydrating agent envelopes', () => {
    const hydrated = envelopeToChatMessage({
      id: 'agent-git-1',
      sessionId: 's1',
      role: 'agent',
      ts: 123,
      payload: JSON.stringify({
        v: 1,
        content: [
          '已提交并推送到 origin/main。',
          '',
          '::git-stage{cwd="/home/example/Documents/code/projects/shennian"}',
          '::git-commit{cwd="/home/example/Documents/code/projects/shennian"}',
        ].join('\n'),
      }),
    })

    expect(hydrated).toMatchObject({
      id: 'agent-git-1',
      role: 'agent',
      content: '已提交并推送到 origin/main。',
    })
  })
})
