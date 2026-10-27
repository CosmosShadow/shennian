// @arch docs/architecture/app/modular-features.md#聊天-feature
// @covers packages/app/src/features/chat/utils/screen.ts
// @covers packages/app/src/features/chat/utils/sendParams.ts
// @covers packages/app/src/utils/models.ts
// @covers packages/app/src/features/chat/utils/reasoningEffortLabel.ts
// @covers packages/app/src/features/chat/components/QueuedMessagePanel.tsx
// @covers packages/app/src/components/BottomSheet.tsx

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CODEX_DESKTOP_SEND_UNAVAILABLE } from '@shennian/wire'
import { getReasoningEffortDisplayLabel } from '../features/chat/utils/reasoningEffortLabel'
import { resolveModelId, resolveReasoningEffort, supportsReasoningEffort } from '../utils/models'
import { buildChatSendParams } from '../features/chat/utils/sendParams'
import {
  withoutPendingCardMessages,
  buildLatestSessionPreview,
  buildSessionPreview,
  ChatSendRejectedError,
  classifyChatSendError,
  ensureChatSendAccepted,
  getControllablePendingForPanel,
  hasAcceptedPendingRun,
  hasAgentMessageSince,
  isExternalOwnerQueueAccepted,
  isEphemeralDesktopSendFailure,
  mergePendingCards,
  shouldRestoreComposerAfterSendError,
  shouldDisableChatVoiceInput,
  shouldKeepPendingRunAfterAck,
  shouldShowChatStopButton,
  shouldShowBottomWorkingIndicator,
} from '../features/chat/utils/screen'

const read = (relative: string) => readFileSync(resolve(__dirname, relative), 'utf8')

describe('chat screen utils', () => {
  it('opens pending-message text without overlapping its delete or send actions', () => {
    const panel = read('../features/chat/components/QueuedMessagePanel.tsx')

    expect(panel).toContain("accessibilityLabel={t('queue_view_full_message')}")
    expect(panel).toContain('setDetailMessageId(message.id)')
    expect(panel).toContain("accessibilityLabel={t('queue_delete_with_summary'")
    expect(panel).toContain('onPress={() => onPromote(message.id)}')
    expect(panel).toContain('<BottomSheet')
    expect(panel).toContain('closeButtonStyle="icon"')
    expect(panel).toContain('preferDialogOnWeb')
    expect(panel).toContain('selectable')
    expect(panel).toContain("{detailMessage?.text ?? ''}")
    expect(panel).toContain('numberOfLines={1}')
  })

  it('moves modal focus inside and restores it to the selected pending summary', () => {
    const panel = read('../features/chat/components/QueuedMessagePanel.tsx')
    const sheet = read('../components/BottomSheet.tsx')

    expect(panel).toContain('returnFocusRef.current = rowBodyRefs.current.get(message.id)')
    expect(panel).toContain('returnFocusRef={returnFocusRef}')
    expect(sheet).toContain('initialFocusRef: closeButtonRef')
    expect(sheet).toContain('returnFocusRef,')
    expect(sheet).toContain('AccessibilityInfo.setAccessibilityFocus')
  })

  it('shows pending users only in cards and restores their bubble after dispatch', () => {
    const messages = [
      { id: 'history', role: 'user' },
      { id: 'pending', role: 'user' },
      { id: 'answer', role: 'agent' },
    ]
    const pending = [{ id: 'queue-id', clientMessageId: 'pending' }] as Parameters<typeof withoutPendingCardMessages>[1]
    expect(withoutPendingCardMessages(messages, pending)).toEqual([messages[0], messages[2]])
    expect(withoutPendingCardMessages(messages, [])).toEqual(messages)
  })

  it('hands an optimistic pending card to the daemon card without hiding or duplicating it', () => {
    const card = (id: string, createdAt: string, extra: Record<string, unknown> = {}) =>
      ({ id, clientMessageId: extra.clientMessageId, createdAt, text: id, ...extra }) as
        Parameters<typeof mergePendingCards>[0][number]
    const optimistic = card('user-1', '2026-09-13T00:00:02.000Z', { clientMessageId: 'user-1', canDelete: false })
    const daemon = card('queue-1', '2026-09-13T00:00:02.000Z', { clientMessageId: 'user-1' })

    expect(mergePendingCards([], [], [optimistic])).toEqual([optimistic])
    expect(mergePendingCards([], [daemon], [optimistic])).toEqual([daemon])
    expect(mergePendingCards([], [], [])).toEqual([])
    const earlier = card('queue-0', '2026-09-13T00:00:01.000Z')
    expect(mergePendingCards([], [earlier], [optimistic])).toEqual([earlier, optimistic])
    const local = card('user-1', '2026-09-13T00:00:02.000Z', { clientMessageId: 'user-1' })
    expect(mergePendingCards([local], [daemon], [optimistic])).toEqual([local])
  })

  it('shows pending controls only while the daemon reports an active turn', () => {
    const identity = {
      protocolVersion: 2 as const,
      dataEpoch: 2 as const,
      daemonInstallationId: 'daemon-1',
    }
    const message = {
      ...identity,
      id: 'queue-1',
      sessionId: 'session-1',
      text: 'next task',
      agentType: 'codex' as const,
      workDir: '/tmp',
      createdAt: '2026-09-13T00:00:00.000Z',
      updatedAt: '2026-09-13T00:00:00.000Z',
    }
    expect(getControllablePendingForPanel({
      ...identity,
      sessionId: 'session-1',
      busy: false,
      pending: [message],
      controllablePending: [message],
    }, 'session-1')).toEqual([])
    expect(getControllablePendingForPanel({
      ...identity,
      sessionId: 'session-1',
      busy: true,
      pending: [message],
      controllablePending: [message],
    }, 'session-1')).toEqual([message])
    expect(getControllablePendingForPanel({
      ...identity,
      sessionId: 'session-1',
      busy: true,
      pending: [message],
      controllablePending: [message],
    }, 'session-1', new Set(['queue-1']))).toEqual([])
  })

  it('keeps an externally owned provider queue item visible until native claim', () => {
    const identity = {
      protocolVersion: 2 as const,
      dataEpoch: 2 as const,
      daemonInstallationId: 'daemon-1',
    }
    const message = {
      ...identity,
      id: 'queue-1',
      sessionId: 'session-1',
      text: 'next task',
      agentType: 'codex' as const,
      workDir: '/tmp',
      createdAt: '2026-09-13T00:00:00.000Z',
      updatedAt: '2026-09-13T00:00:00.000Z',
      pendingState: 'provider_queued' as const,
      canDelete: false,
      canPromote: false,
    }
    expect(getControllablePendingForPanel({
      ...identity,
      sessionId: 'session-1',
      busy: false,
      pending: [message],
      controllablePending: [],
      visiblePending: [message],
    }, 'session-1', new Set(['queue-1']))).toEqual([message])
  })

  it('recognizes only the stopped Desktop thread as an ephemeral send failure', () => {
    expect(isEphemeralDesktopSendFailure(
      new ChatSendRejectedError(CODEX_DESKTOP_SEND_UNAVAILABLE),
    )).toBe(true)
    expect(isEphemeralDesktopSendFailure(new ChatSendRejectedError('other'))).toBe(false)
    expect(isEphemeralDesktopSendFailure(new Error(CODEX_DESKTOP_SEND_UNAVAILABLE))).toBe(false)
  })
  it('keeps voice input enabled while attachments are uploading', () => {
    expect(
      shouldDisableChatVoiceInput({
        sessionId: 'sess-1',
        readOnlySession: false,
        machineOffline: false,
        relayState: 'connected',
        isSending: false,
      }),
    ).toBe(false)
  })

  it('disables voice input for session or relay states that cannot record safely', () => {
    expect(
      shouldDisableChatVoiceInput({
        sessionId: null,
        readOnlySession: false,
        machineOffline: false,
        relayState: 'connected',
        isSending: false,
      }),
    ).toBe(true)
    expect(
      shouldDisableChatVoiceInput({
        sessionId: 'sess-1',
        readOnlySession: true,
        machineOffline: false,
        relayState: 'connected',
        isSending: false,
      }),
    ).toBe(true)
    expect(
      shouldDisableChatVoiceInput({
        sessionId: 'sess-1',
        readOnlySession: false,
        machineOffline: true,
        relayState: 'connected',
        isSending: false,
      }),
    ).toBe(true)
    expect(
      shouldDisableChatVoiceInput({
        sessionId: 'sess-1',
        readOnlySession: false,
        machineOffline: false,
        relayState: 'disconnected',
        isSending: false,
      }),
    ).toBe(true)
  })

  it('hides Stop when a running turn is owned by Codex Desktop', () => {
    expect(shouldShowChatStopButton({ isTyping: true, canSend: false, canStop: false })).toBe(false)
    expect(shouldShowChatStopButton({ isTyping: true, canSend: false, canStop: true })).toBe(true)
    expect(shouldShowChatStopButton({ isTyping: true, canSend: false })).toBe(true)
    expect(shouldShowChatStopButton({ isTyping: false, canSend: false, canStop: true })).toBe(false)
  })

  it('keeps the optimistic running state after an ACK unless the send already ended', () => {
    expect(shouldKeepPendingRunAfterAck('committed')).toBe(true)
    expect(shouldKeepPendingRunAfterAck('executing')).toBe(true)
    expect(shouldKeepPendingRunAfterAck('queued')).toBe(true)
    expect(shouldKeepPendingRunAfterAck('completed')).toBe(false)
    expect(shouldKeepPendingRunAfterAck('failed')).toBe(false)
    expect(shouldKeepPendingRunAfterAck('cancelled')).toBe(false)
  })

  it('classifies network and cli reachability errors', () => {
    expect(classifyChatSendError('disconnected', new Error('websocket disconnected')).type).toBe(
      'network',
    )
    expect(classifyChatSendError('connected', new Error('daemon unreachable')).type).toBe(
      'cli_unreachable',
    )
    expect(classifyChatSendError('connected', new Error('bad request')).type).toBe('agent_error')
  })

  it('builds a compact session preview from the last non-empty message', () => {
    expect(
      buildSessionPreview({
        id: '1',
        role: 'user',
        ts: 1,
        content: 'hello\nworld',
      }),
    ).toBe('hello world')
    expect(buildSessionPreview(undefined)).toBeNull()
  })

  it('keeps the latest readable reply when an internal item trails it', () => {
    expect(
      buildLatestSessionPreview([
        { id: 'user', role: 'user', ts: 1, content: '搞定了吗？' },
        { id: 'agent', role: 'agent', ts: 2, content: '搞定了。' },
        { id: 'internal', role: 'agent', ts: 3, content: '' },
      ]),
    ).toBe('搞定了。')
  })

  it('prefers attachment message text and summarizes image-only messages', () => {
    const attachments = [
      { path: '/tmp/a.png', name: 'a.png', mimeType: 'image/png', kind: 'image' as const },
      { path: '/tmp/b.png', name: 'b.png', mimeType: 'image/png', kind: 'image' as const },
    ]
    expect(
      buildSessionPreview({
        id: 'image-with-text',
        role: 'user',
        ts: 1,
        content: '![a.png](</tmp/a.png>)\n![b.png](</tmp/b.png>)\n\n帮我看看',
        attachments,
      }),
    ).toBe('帮我看看')
    expect(
      buildSessionPreview({
        id: 'image-only',
        role: 'user',
        ts: 1,
        content: '![a.png](</tmp/a.png>)\n![b.png](</tmp/b.png>)',
        attachments,
      }),
    ).toBe('[2 Images]')
  })

  it('treats relay responses with ok:false as send failures', () => {
    expect(() => ensureChatSendAccepted({ ok: true })).not.toThrow()
    expect(() => ensureChatSendAccepted({ ok: false, error: 'daemon unreachable' })).toThrow(
      'daemon unreachable',
    )
  })

  it('treats an external owner queue response as a definitive accepted send', () => {
    expect(
      isExternalOwnerQueueAccepted({
        queued: true,
        deliveryMode: 'external_owner_queue',
      }),
    ).toBe(true)
    expect(isExternalOwnerQueueAccepted({ queued: true })).toBe(false)
    expect(isExternalOwnerQueueAccepted(null)).toBe(false)
  })

  it('recognizes when a pending run has been replaced by a real run', () => {
    expect(hasAcceptedPendingRun('__pending__')).toBe(false)
    expect(hasAcceptedPendingRun(null)).toBe(false)
    expect(hasAcceptedPendingRun('run-real')).toBe(true)
    expect(hasAcceptedPendingRun('run-existing', 'run-existing')).toBe(false)
    expect(hasAcceptedPendingRun('run-next', 'run-existing')).toBe(true)
  })

  it('does not restore the composer when only the send ACK is uncertain', () => {
    expect(shouldRestoreComposerAfterSendError(new Error('Request req_1 timed out'))).toBe(false)
    expect(shouldRestoreComposerAfterSendError(new Error('Client disconnected'))).toBe(false)
    expect(shouldRestoreComposerAfterSendError(new Error('read ECONNRESET'))).toBe(false)
    expect(shouldRestoreComposerAfterSendError(new Error('Failed to start codex'))).toBe(true)
    expect(
      shouldRestoreComposerAfterSendError(new ChatSendRejectedError('network unavailable')),
    ).toBe(true)
  })

  it('recognizes agent output that proves a user send was accepted', () => {
    expect(
      hasAgentMessageSince(
        [
          { id: 'user-1', role: 'user', ts: 100, content: 'hello' },
          { id: 'agent-1', role: 'agent', ts: 120, content: 'working' },
        ],
        100,
      ),
    ).toBe(true)
    expect(
      hasAgentMessageSince(
        [
          { id: 'agent-0', role: 'agent', ts: 90, content: 'older' },
          { id: 'user-1', role: 'user', ts: 100, content: 'hello' },
        ],
        100,
      ),
    ).toBe(false)
  })

  it('treats a same-timestamp agent event as acceptance for the pending send', () => {
    expect(
      hasAgentMessageSince(
        [
          { id: 'user-1', role: 'user', ts: 100, content: 'hello' },
          { id: 'agent-1', role: 'agent', ts: 100, content: 'working' },
        ],
        100,
      ),
    ).toBe(true)
  })

  it('truncates very long session previews for optimistic list updates', () => {
    expect(
      buildSessionPreview({
        id: '1',
        role: 'user',
        ts: 1,
        content:
          '01234567890123456789012345678901234567890123456789012345678901234567890123456789more',
      }),
    ).toBe('01234567890123456789012345678901234567890123456789012345678901234567890123456789…')
  })

  it('keeps the bottom working indicator visible while streaming has started but no agent message is visible yet', () => {
    expect(
      shouldShowBottomWorkingIndicator('streaming_text', [
        { id: 'user-1', role: 'user', ts: 100, content: 'hello' },
      ]),
    ).toBe(true)

    expect(
      shouldShowBottomWorkingIndicator('streaming_text', [
        { id: 'user-1', role: 'user', ts: 100, content: 'hello' },
        { id: 'agent-1', role: 'agent', ts: 101, content: 'hi' },
      ]),
    ).toBe(false)
  })

  it('renders reasoning effort labels in English regardless of app locale', () => {
    expect(getReasoningEffortDisplayLabel('medium', [{ id: 'medium', name: '中' }])).toBe('Medium')
    expect(getReasoningEffortDisplayLabel('high', [{ id: 'high', name: '高' }])).toBe('High')
    expect(getReasoningEffortDisplayLabel('xhigh', [{ id: 'xhigh', name: '超高' }])).toBe(
      'Extra high',
    )
    expect(getReasoningEffortDisplayLabel('custom', [{ id: 'custom', name: 'Custom' }])).toBe(
      'Custom',
    )
  })

  it('resolves reasoning effort only for Claude and Codex models with metadata', () => {
    const model = {
      id: 'gpt-5.5',
      name: 'GPT-5.5',
      supportedReasoningEfforts: [
        { id: 'low', name: 'Low' },
        { id: 'medium', name: 'Medium' },
        { id: 'high', name: 'High' },
      ],
      defaultReasoningEffort: 'medium',
    }

    expect(supportsReasoningEffort('codex', model)).toBe(true)
    expect(resolveReasoningEffort('codex', model)).toBe('medium')
    expect(resolveReasoningEffort('codex', model, 'high')).toBe('high')
    expect(resolveReasoningEffort('codex', model, 'max')).toBe('medium')
    expect(resolveReasoningEffort('claude', model)).toBe('medium')
    expect(supportsReasoningEffort('gemini', model)).toBe(false)
    expect(resolveReasoningEffort('custom:test', model, 'high')).toBeUndefined()
  })

  it('does not default Codex reasoning effort to the most expensive tier', () => {
    const model = {
      id: 'gpt-5.6-sol',
      name: 'GPT-5.6 Sol',
      supportedReasoningEfforts: [
        { id: 'low', name: 'Low' },
        { id: 'medium', name: 'Medium' },
        { id: 'high', name: 'High' },
        { id: 'ultra', name: 'Ultra' },
      ],
    }

    expect(resolveReasoningEffort('codex', model)).toBe('medium')
    expect(resolveReasoningEffort('codex', model, 'low')).toBe('low')
  })

  it('keeps Codex away from ultra even if model metadata marks it as default', () => {
    const model = {
      id: 'gpt-5.6-terra',
      name: 'GPT-5.6 Terra',
      supportedReasoningEfforts: [
        { id: 'low', name: 'Low' },
        { id: 'medium', name: 'Medium' },
        { id: 'high', name: 'High' },
        { id: 'ultra', name: 'Ultra' },
      ],
      defaultReasoningEffort: 'ultra',
    }

    expect(resolveReasoningEffort('codex', model)).toBe('medium')
    expect(resolveReasoningEffort('codex', model, 'ultra')).toBe('ultra')
  })

  it('keeps latest GPT-5.6 Codex model selections instead of falling back to default', () => {
    const models = [
      { id: 'gpt-5.5', name: 'GPT-5.5', isDefault: true },
      { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
      { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
      { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna' },
    ]

    expect(resolveModelId(models, 'gpt-5.6-sol')).toBe('gpt-5.6-sol')
    expect(resolveModelId(models, 'gpt-5.6-terra')).toBe('gpt-5.6-terra')
    expect(resolveModelId(models, 'gpt-5.6-luna')).toBe('gpt-5.6-luna')
    expect(resolveModelId(models, 'gpt-5.6-missing')).toBe('gpt-5.5')
  })

  it('builds chat send params with optional reasoning effort', () => {
    expect(
      buildChatSendParams({
        protocolVersion: 2,
        dataEpoch: 2,
        daemonInstallationId: 'daemon-1',
        sessionId: 'sess-1',
        text: 'hello',
        agentType: 'codex',
        workDir: '/repo',
        modelId: 'gpt-5.5',
        systemPrompt: 'Be concise.',
        reasoningEffort: 'xhigh',
        clientMessageId: 'user-1',
        queueMessageId: 'user-1',
      }),
    ).toMatchObject({
      sessionId: 'sess-1',
      modelId: 'gpt-5.5',
      systemPrompt: 'Be concise.',
      reasoningEffort: 'xhigh',
      queueMessageId: 'user-1',
    })

    expect(
      buildChatSendParams({
        protocolVersion: 2,
        dataEpoch: 2,
        daemonInstallationId: 'daemon-1',
        sessionId: 'sess-2',
        text: 'hello',
        agentType: 'gemini',
        workDir: '/repo',
        modelId: 'gemini-2.5-pro',
      }),
    ).not.toHaveProperty('reasoningEffort')

    expect(
      buildChatSendParams({
        protocolVersion: 2,
        dataEpoch: 2,
        daemonInstallationId: 'daemon-1',
        sessionId: 'sess-manager',
        text: 'continue',
        agentType: 'codex',
        sessionMode: 'manager',
        workDir: '/repo',
        agentSessionId: 'native-manager-session',
      }),
    ).toMatchObject({
      sessionId: 'sess-manager',
      sessionMode: 'manager',
      agentSessionId: 'native-manager-session',
    })
  })
})
