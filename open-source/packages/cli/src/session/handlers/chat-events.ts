// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/session-manager-agent-events-include-sessionid.test.ts

import { buildApprovalPendingPayload, type AgentType, type SessionRunPhase } from '@shennian/wire'
import { createHash } from 'node:crypto'
import { noteCoordinationEvent } from '../../project-coordination/runtime.js'
import type { AgentAdapter, AgentEvent } from '../../agents/adapter.js'
import { AgentEventTerminalGate } from '../../agents/event-terminal-gate.js'
import { recordAcpAgentModels } from '../../agents/model-registry.js'
import { reportLog } from '../../log-reporter.js'
import { registerInternalNativeSource } from '../../native-fusion/source-visibility.js'
import { requestSessionIndexPublish } from '../index-publisher.js'
import { noteRunActivity } from '../run-stall.js'
import { appendMessage, recordSession, upsertMessage } from '../store.js'
import { writeToolDetail } from '../tool-detail-store.js'
import type { ActiveSession, SessionManagerRuntime } from '../types.js'
import { refreshMachineAgents } from './agents.js'
import { roomReplyFailureNotice } from '../room-reply-notice.js'
import { commitStewardFallback, tryStewardFailover } from './steward.js'
import { clearStewardSwitched, resetStewardChain } from '../../steward/failover.js'

function extractSummary(text: string): string {
  const newline = text.indexOf('\n')
  const end = newline > 0 ? Math.min(newline, 80) : Math.min(text.length, 80)
  return text.slice(0, end)
}

function stableAttentionId(kind: 'approval' | 'terminal', runId: string, seq?: number): string {
  return `${kind}:${createHash('sha256')
    .update(`${runId}\0${seq ?? ''}`)
    .digest('hex')}`
}

function buildRelayAgentPayload(
  event: AgentEvent,
  sessionId: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  if (event.state === 'tool-call' || event.state === 'tool-result') {
    const detailRef = { runId: event.runId, sourceSeq: event.seq }
    return {
      state: event.state,
      runId: event.runId,
      seq: event.seq,
      sessionId,
      detailRef,
      status: event.state === 'tool-call' ? 'running' : 'completed',
      detailAvailable: true,
      ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
      ...(event.name ? { name: event.name } : {}),
      ...(event.source ? { source: event.source } : {}),
      ...(event.agentSessionId ? { agentSessionId: event.agentSessionId } : {}),
      ...extra,
    }
  }
  return { ...event, sessionId, ...extra }
}

const SESSION_ACTIVITY_HEARTBEAT_INTERVAL_MS = 30_000

function runPhaseFromAgentEvent(event: AgentEvent): SessionRunPhase | null {
  if (event.state === 'heartbeat') return event.runPhase ?? null
  if (event.state === 'tool-call' || event.state === 'tool-result') return 'tool_running'
  if (event.state === 'approval-pending') return event.runPhase ?? 'waiting_approval'
  if (event.state === 'notify' && event.runPhase) return event.runPhase
  if (event.state === 'delta') return event.thinking ? 'thinking' : 'streaming_text'
  if (event.state === 'init' || event.state === 'start') return 'thinking'
  return null
}

export function getNativeSourceAgentType(agentType: AgentType, modelId?: string | null): string {
  if (agentType !== 'manager') return agentType
  return modelId === 'claude' ? 'claude' : 'codex'
}

/** A steward whose AI is unavailable continues on the next AI tool; otherwise the last output/notice shows. */
function failoverOrFallback(
  runtime: SessionManagerRuntime,
  sessionId: string,
  active: ActiveSession,
  event: { state: string; runId: string; message?: string },
): void {
  if (event.state !== 'error') {
    commitStewardFallback(runtime, sessionId, active, event)
    return
  }
  void tryStewardFailover(runtime, sessionId, active, event)
    .catch(() => false)
    .then((switched) => { if (!switched) commitStewardFallback(runtime, sessionId, active, event) })
}

export function bindAdapterEvents(
  runtime: SessionManagerRuntime,
  sessionId: string,
  agentType: AgentType,
  adapter: AgentAdapter,
): void {
  let emittedAgentSessionId: string | null = null
  const terminalGate = new AgentEventTerminalGate()

  function sendAgentEvent(event: AgentEvent, extra: Record<string, unknown> = {}) {
    runtime.client.sendAgentEvent({
      type: 'event',
      event: 'agent',
      payload: buildRelayAgentPayload(event, sessionId, extra),
      seq: event.seq,
      id: `agent-evt-${event.runId}-${event.seq}`,
    })
  }

  // An ACP provider only reveals its model list inside a live session. Keep the
  // newest list in the machine cache so a new conversation can offer it before
  // the first message. Best-effort: it must never fail the turn.
  if (agentType.startsWith('acp:')) {
    adapter.on('sessionOptions', () => {
      try {
        const models = adapter.getSessionOptions?.().models ?? []
        if (!recordAcpAgentModels(agentType, models)) return
        const agents = runtime.getAgentSnapshot?.()
        if (!agents) return
        runtime.client.sendEvent({
          type: 'event',
          event: 'machine.agents',
          payload: { agentList: agents.map((agent) => agent.type), agents },
        })
      } catch {
        // Cache and republish failures are non-fatal.
      }
    })
  }

  function stopActivityHeartbeat(activeSession: ActiveSession | undefined) {
    if (!activeSession?.heartbeatTimer) return
    clearInterval(activeSession.heartbeatTimer)
    activeSession.heartbeatTimer = null
  }

  function sendActivityHeartbeat(activeSession: ActiveSession) {
    if (!activeSession.currentRunId || !activeSession.currentRunPhase) return
    const seq = activeSession.heartbeatSeq++
    runtime.client.sendAgentEvent({
      type: 'event',
      event: 'agent',
      payload: {
        state: 'heartbeat',
        sessionId,
        runId: activeSession.currentRunId,
        seq,
        runPhase: activeSession.currentRunPhase,
      },
      seq,
      id: `agent-heartbeat-${activeSession.currentRunId}-${seq}-${Date.now()}`,
    })
  }

  function ensureActivityHeartbeat(activeSession: ActiveSession | undefined) {
    if (!activeSession || activeSession.heartbeatTimer) return
    activeSession.heartbeatTimer = setInterval(() => {
      sendActivityHeartbeat(activeSession)
    }, SESSION_ACTIVITY_HEARTBEAT_INTERVAL_MS)
    activeSession.heartbeatTimer.unref?.()
  }

  function flushTextBuffer(activeSession: ActiveSession | undefined) {
    const textBuffer = activeSession?.pendingTextEvent
    if (!activeSession || !textBuffer || !textBuffer.text) return
    appendMessage(sessionId, {
      id: `agent-${textBuffer.runId}-${textBuffer.seq}`,
      sessionId,
      role: 'agent',
      ts: Date.now(),
      payload: textBuffer.text,
    })
    requestSessionIndexPublish(runtime.client)
    sendAgentEvent({
      state: 'delta',
      runId: textBuffer.runId,
      seq: textBuffer.seq,
      text: textBuffer.text,
      thinking: textBuffer.thinking || undefined,
    })
    if (activeSession.sessionScope === 'steward') activeSession.stewardLastText = textBuffer.text
    activeSession.pendingTextEvent = null
  }

  adapter.on('agentEvent', (event: AgentEvent) => {
    // Normalize every Adapter at the shared session boundary. A provider may
    // race process-close, abort, retry, or buffered output callbacks, but only
    // the first terminal and no later event for that run is user-visible.
    if (!terminalGate.accept(event)) return
    let noReplyFailure = false
    if (event.errorCode === 'acp_auth_required') {
      void refreshMachineAgents(runtime).catch(() => {})
    }
    const activeSession = runtime.sessions.get(sessionId)
    const runPhase = runPhaseFromAgentEvent(event)
    const isTerminalEvent =
      event.state === 'final' || event.state === 'error' || event.state === 'aborted'
    if (activeSession) noteRunActivity(sessionId, activeSession, isTerminalEvent)
    if (activeSession) {
      activeSession.nextEventSeq = event.seq + 1
      if (!isTerminalEvent && activeSession.currentRunId !== event.runId && activeSession.sessionScope === 'steward') {
        // A new turn starts with a clean slate: only this turn's `say` counts.
        activeSession.stewardSay = { count: 0 }
        activeSession.stewardLastText = ''
        clearStewardSwitched(sessionId)
      }
      if (!isTerminalEvent) activeSession.currentRunId = event.runId
      if (!isTerminalEvent && runPhase) {
        activeSession.currentRunPhase = runPhase
        ensureActivityHeartbeat(activeSession)
      }
      if (event.agentSessionId) activeSession.agentSessionId = event.agentSessionId
      if (activeSession.journalRunId) {
        const patch = {
          agentSessionId: event.agentSessionId ?? activeSession.agentSessionId,
          providerRunId: event.runId || null,
          lastObservedEventSeq: event.seq,
          // The canonical terminal transaction below must commit before the
          // journal disappears. Keeping the prior phase here avoids skipping
          // an uncommitted terminal after a crash in that narrow window.
          ...(!isTerminalEvent ? {
            phase: runPhase === 'waiting_approval' ? 'waiting_approval' as const : 'running' as const,
          } : {}),
        }
        runtime.runJournal?.update(sessionId, activeSession.journalRunId, patch)
      }
    }
    runtime.managerRuntime?.noteAgentEvent(sessionId, event)

    // Reasoning is an implementation detail of the local Agent. Keep it on the
    // machine: it must not enter Relay persistence or become a chat message.
    if (event.state === 'delta' && event.thinking) return

    if (event.state !== 'delta') {
      reportLog({
        level: 'info',
        sessionId,
        wsEvent: `agent.${event.state}`,
        wsDirection: 'out',
        metadata: { runId: event.runId, seq: event.seq, agentType },
      })
    }
    let committedVisibleEvent = false
    if (event.state === 'tool-call' || event.state === 'tool-result') {
      const toolMessageId = event.toolCallId
        ? `agent-tool-${createHash('sha256').update(`${event.runId}\0${event.toolCallId}`).digest('hex')}`
        : `agent-${event.runId}-${event.seq}`
      writeToolDetail({
        sessionId,
        toolCallId: toolMessageId,
        detailRevision: event.seq,
        ts: Date.now(),
        name: event.name ?? 'tool',
        ...(event.args !== undefined ? { args: event.args } : {}),
        ...(event.result !== undefined ? { result: event.result } : {}),
        status: event.toolStatus ?? (event.state === 'tool-call' ? 'running' : 'completed'),
        ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
        detailRef: { runId: event.runId, sourceSeq: event.seq },
      })
      const persistToolMessage = event.toolCallId ? upsertMessage : appendMessage
      persistToolMessage(sessionId, {
        id: toolMessageId,
        sessionId,
        role: 'agent',
        ts: Date.now(),
        payload: JSON.stringify({
          v: 1,
          type: event.state === 'tool-call' ? 'tool_use' : 'tool_result',
          name: event.name,
          toolCallId: toolMessageId,
          status: event.toolStatus ?? (event.state === 'tool-call' ? 'running' : 'completed'),
          ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
          detailRef: { runId: event.runId, sourceSeq: event.seq },
          detailRevision: event.seq,
          detailAvailable: true,
          resultOmitted: event.state === 'tool-result',
        }),
      })
      committedVisibleEvent = true
    } else if (event.state === 'approval-pending') {
      appendMessage(sessionId, {
        id: `agent-${event.runId || 'run'}-${event.seq}`,
        sessionId,
        role: 'agent',
        ts: Date.now(),
        payload: buildApprovalPendingPayload({ ...event.approval, permission: event.permission }),
      })
      committedVisibleEvent = true
      if (activeSession) {
        recordSession({
          sessionId,
          agentType,
          workDir: activeSession.workDir,
          agentSessionId: activeSession.agentSessionId,
          attentionId: stableAttentionId('approval', event.runId, event.seq),
        })
      }
    } else if ((event.state === 'error' || event.state === 'aborted') && event.message) {
      appendMessage(sessionId, {
        id: `agent-${event.runId || 'run'}-${event.seq}`,
        sessionId,
        role: 'agent',
        ts: Date.now(),
        payload: event.message,
      })
      committedVisibleEvent = true
    }
    if (committedVisibleEvent) requestSessionIndexPublish(runtime.client)

    const runKey = `${sessionId}:${event.runId}`
    if (event.state === 'delta' && !event.thinking && event.text) {
      runtime.runTextAcc.set(runKey, (runtime.runTextAcc.get(runKey) ?? '') + event.text)
    }

    if (event.agentSessionId && event.agentSessionId !== emittedAgentSessionId) {
      if (activeSession?.nativeSessionVisibility === 'internal') {
        registerInternalNativeSource(sessionId, getNativeSourceAgentType(agentType, event.source) ?? agentType, event.agentSessionId)
      }
      emittedAgentSessionId = event.agentSessionId
      runtime.nativeFusion?.noteManagedSourceSession(
        sessionId,
        getNativeSourceAgentType(agentType, event.source),
        event.agentSessionId,
      )
      if (activeSession) {
        recordSession({
          sessionId,
          agentType,
          workDir: activeSession.workDir,
          agentSessionId: event.agentSessionId,
        })
      }
      runtime.client.sendEvent({
        type: 'event',
        event: 'session.update',
        payload: {
          session: {
            id: sessionId,
            agentType,
            agentSessionId: event.agentSessionId,
          },
        },
      })
    }

    if (event.state === 'delta') {
      const text = event.text ?? ''
      if (!text) return
      if (activeSession?.pendingTextEvent && activeSession.pendingTextEvent.runId !== event.runId) {
        flushTextBuffer(activeSession)
      }
      if (activeSession && !activeSession.pendingTextEvent) {
        activeSession.pendingTextEvent = {
          runId: event.runId,
          seq: event.seq,
          text: '',
          thinking: false,
        }
      }
      if (activeSession?.pendingTextEvent) {
        activeSession.pendingTextEvent.text += text
        activeSession.pendingTextEvent.seq = event.seq
      }
      return
    }

    let extra: Record<string, unknown> = {}
    if (event.state === 'final') {
      flushTextBuffer(activeSession)
      if (activeSession) {
        commitStewardFallback(runtime, sessionId, activeSession, event)
        resetStewardChain(sessionId)
      }
      const notice = activeSession ? roomReplyFailureNotice(activeSession) : null
      if (notice) {
        noReplyFailure = true
        appendMessage(sessionId, {
          id: `room-reply-notice-${event.runId}`,
          sessionId,
          role: 'agent',
          ts: Date.now(),
          payload: notice,
        })
        requestSessionIndexPublish(runtime.client)
      }
      const accumulated = runtime.runTextAcc.get(runKey) ?? ''
      if (accumulated) extra = { messageSummary: extractSummary(accumulated) }
      runtime.runTextAcc.delete(runKey)
    } else if (event.state === 'error' || event.state === 'aborted') {
      flushTextBuffer(activeSession)
      if (activeSession) failoverOrFallback(runtime, sessionId, activeSession, event)
      runtime.runTextAcc.delete(runKey)
    } else if (
      event.state === 'tool-call' ||
      event.state === 'tool-result' ||
      event.state === 'approval-pending'
    ) {
      flushTextBuffer(activeSession)
    }

    if (event.state === 'start' || event.state === 'approval-pending' || (event.state === 'notify' && event.runPhase) || isTerminalEvent) {
      try {
        noteCoordinationEvent(runtime, sessionId, isTerminalEvent ? event.state : runPhase ?? 'running',
          typeof extra.messageSummary === 'string' ? extra.messageSummary : event.message)
      } catch { console.error('[project.coordination] progress persistence failed') }
    }
    if (isTerminalEvent && activeSession?.currentRunId === event.runId) {
      // The Room grant deliberately outlives the Turn: it is replaced by the
      // next Turn's grant and revoked only on Session close, stop or Binding
      // change, so late tool output and background work never lose Room access.
      activeSession.currentRunId = null
      activeSession.currentRunPhase = null
      activeSession.nextEventSeq = 0
      stopActivityHeartbeat(activeSession)
      runtime.chatQueue?.noteTerminal(sessionId)
      recordSession({
        sessionId,
        agentType,
        workDir: activeSession.workDir,
        agentSessionId: activeSession.agentSessionId,
        status: event.state === 'final' && !noReplyFailure ? 'completed' : 'failed',
        attentionId: stableAttentionId('terminal', event.runId),
        lastActivityAt: new Date().toISOString(),
      })
      requestSessionIndexPublish(runtime.client)
      if (activeSession.journalRunId) {
        runtime.runJournal?.remove(sessionId, activeSession.journalRunId)
        runtime.recoveryBarrier?.end(sessionId)
        activeSession.journalRunId = null
      }
    }

    sendAgentEvent(event, extra)
  })

  adapter.on('error', (error: Error) => {
    console.error(
      `[chat.send] adapter error sessionId=${sessionId} agentType=${agentType}: ${error.message}`,
    )
    const failedSession = runtime.sessions.get(sessionId)
    if (failedSession) {
      failoverOrFallback(runtime, sessionId, failedSession, { state: 'error', runId: failedSession.currentRunId ?? '', message: error.message })
    }
    if (failedSession?.journalRunId) {
      runtime.runJournal?.update(sessionId, failedSession.journalRunId, { phase: 'terminal' })
      runtime.runJournal?.remove(sessionId, failedSession.journalRunId)
      runtime.recoveryBarrier?.end(sessionId)
      failedSession.journalRunId = null
    }
    runtime.sessions.delete(sessionId)
    runtime.chatQueue?.noteTerminal(sessionId)
    // The relay event below is transient: a phone that is not watching this instant never sees it.
    // Write the reason into the conversation too. While a queued message is still being handed
    // over, the queue reports that failure itself (once), so skip it here to avoid one row per retry.
    if (!runtime.chatQueue?.isDispatching?.(sessionId)) {
      appendMessage(sessionId, {
        id: `agent-error-${sessionId}-${Date.now()}`,
        sessionId,
        role: 'agent',
        ts: Date.now(),
        payload: error.message,
      })
      requestSessionIndexPublish(runtime.client)
    }
    runtime.client.sendEvent({
      type: 'event',
      event: 'agent',
      payload: { state: 'error', sessionId, message: error.message, runId: '', seq: 0 },
    })
  })
}
