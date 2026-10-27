import { Readable, Writable } from 'node:stream'
import { setTimeout } from 'node:timers'
import fs from 'node:fs'
import * as acp from '@agentclientprotocol/sdk'

let nextSession = 1
const mode = process.argv[2] ?? 'default'
if (process.env.ACP_FIXTURE_START_FILE) fs.appendFileSync(process.env.ACP_FIXTURE_START_FILE, 'start\n')
if (process.env.ACP_FIXTURE_ENV_FILE) {
  fs.appendFileSync(process.env.ACP_FIXTURE_ENV_FILE, `${process.env.SHENNIAN_MANAGED_ROOM_CONTEXT ?? ''}\n`)
}

const app = acp.agent({ name: 'Shennian ACP test agent' })
  .onRequest(acp.methods.agent.initialize, async ({ params }) => {
    if (mode === 'delay-initialize') {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    if (process.env.ACP_FIXTURE_CAPABILITIES_FILE) {
      fs.writeFileSync(process.env.ACP_FIXTURE_CAPABILITIES_FILE, JSON.stringify(params.clientCapabilities))
    }
    return {
      protocolVersion: params.protocolVersion,
      agentCapabilities: {
        loadSession: mode === 'no-resume' || mode === 'no-history' ? false : true,
        sessionCapabilities: mode === 'no-history'
          ? {}
          : mode === 'no-resume'
          ? { list: {}, close: {}, delete: {} }
          : { resume: {}, list: {}, close: {}, delete: {} },
      },
      authMethods: [],
      agentInfo: { name: 'test-agent', version: '1.0.0' },
    }
  })
  .onRequest(acp.methods.agent.session.new, () => ({
    sessionId: `acp-session-${nextSession++}`,
    modes: {
      currentModeId: 'ask',
      availableModes: [
        { id: 'ask', name: 'Ask' },
        { id: 'code', name: 'Code' },
      ],
    },
    configOptions: [{
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue: 'default',
      options: [
        { value: 'default', name: 'Default' },
        { value: 'fast', name: 'Fast' },
      ],
    }],
  }))
  .onRequest(acp.methods.agent.session.setMode, () => ({}))
  .onRequest(acp.methods.agent.session.setConfigOption, () => ({}))
  .onRequest(acp.methods.agent.session.resume, () => {
    if (mode === 'resume-error') throw new Error('session not found')
    return {}
  })
  .onRequest(acp.methods.agent.session.load, async ({ params, client }) => {
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: { sessionUpdate: 'user_message_chunk', messageId: 'old-user', content: { type: 'text', text: 'older ' } },
    })
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: { sessionUpdate: 'user_message_chunk', messageId: 'old-user', content: { type: 'text', text: 'question' } },
    })
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: { sessionUpdate: 'agent_message_chunk', messageId: 'old-agent', content: { type: 'text', text: 'older answer' } },
    })
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: { sessionUpdate: 'tool_call_update', toolCallId: 'old-tool', title: 'Read file', status: 'completed' },
    })
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: { sessionUpdate: 'tool_call', toolCallId: 'old-tool', title: 'Read file', status: 'completed' },
    })
    return {}
  })
  .onRequest(acp.methods.agent.session.list, ({ params }) => params.cursor ? ({
    sessions: [{ sessionId: 'external-2', cwd: process.cwd(), title: 'Second', updatedAt: '2026-09-09T00:00:00Z' }],
  }) : ({
    sessions: [{ sessionId: 'external-1', cwd: process.cwd(), title: 'First' }], nextCursor: 'page-2',
  }))
  .onRequest(acp.methods.agent.session.close, () => ({}))
  .onRequest(acp.methods.agent.session.delete, () => ({}))
  .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
    if (mode === 'crash-prompt') process.exit(17)
    if (mode === 'stall-prompt') return await new Promise(() => {})
    if (mode === 'relay-hello') {
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'hello' },
        },
      })
      return { stopReason: 'end_turn' }
    }
    if (process.env.ACP_FIXTURE_PROMPT_FILE) {
      fs.appendFileSync(process.env.ACP_FIXTURE_PROMPT_FILE, `${JSON.stringify(params.prompt)}\n`)
    }
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'thinking' },
      },
    })
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-1',
        title: 'Edit file',
        rawInput: { path: '/tmp/example.txt' },
      },
    })
    if (mode === 'duplicate-tools') {
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tool-1',
          title: 'Edit file',
          rawInput: { path: '/tmp/example.txt' },
        },
      })
    }
    const permission = await client.request(acp.methods.client.session.requestPermission, {
      sessionId: params.sessionId,
      toolCall: { toolCallId: 'tool-1', title: 'Edit file' },
      options: [
        { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject', name: 'Reject once', kind: 'reject_once' },
      ],
    })
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-1',
        title: 'Edit file',
        status: permission.outcome.outcome === 'selected' && permission.outcome.optionId === 'allow'
          ? 'completed'
          : 'failed',
        rawOutput: { permission: permission.outcome },
      },
    })
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'done' },
      },
    })
    return { stopReason: 'end_turn' }
  })
  .onNotification(acp.methods.agent.session.cancel, () => {})

app.connect(acp.ndJsonStream(
  Writable.toWeb(process.stdout),
  Readable.toWeb(process.stdin),
))
/* global process */
