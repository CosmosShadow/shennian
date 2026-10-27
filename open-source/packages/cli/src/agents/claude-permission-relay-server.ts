// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/claude-permission-bridge.test.ts
//
// Standalone MCP stdio server Claude Code spawns via `--permission-prompt-tool`.
// It never decides anything itself: every call is relayed, one line of JSON at
// a time, over the Unix socket at SHENNIAN_CLAUDE_PERMISSION_SOCKET, to the
// ClaudeAdapter that spawned this Claude run, and the reply is passed straight
// back. Keep this file dependency-free — it has to run as its own `node`
// process using only what tsc emits, with no bundling step.

import net from 'node:net'
import { createInterface } from 'node:readline'
import {
  CLAUDE_PERMISSION_MCP_SERVER_NAME,
  CLAUDE_PERMISSION_SOCKET_ENV,
  CLAUDE_PERMISSION_TOOL_NAME,
  CLAUDE_USER_INPUT_TOOL_NAME,
} from './claude-permission-protocol.js'

const RELAY_TIMEOUT_MS = 5 * 60_000

type JsonRpcMessage = { jsonrpc?: '2.0'; id?: number | string; method?: string; params?: Record<string, unknown> }

function send(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
}

function relayToDaemon(toolName: unknown, input: unknown): Promise<{ behavior: 'allow' | 'deny'; updatedInput?: unknown; message?: string }> {
  const socketPath = process.env[CLAUDE_PERMISSION_SOCKET_ENV]
  if (!socketPath) return Promise.resolve({ behavior: 'deny', message: 'shennian_permission_socket_missing' })

  return new Promise((resolve) => {
    let settled = false
    const finish = (result: { behavior: 'allow' | 'deny'; updatedInput?: unknown; message?: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => finish({ behavior: 'deny', message: 'shennian_permission_timeout' }), RELAY_TIMEOUT_MS)
    timer.unref?.()

    const socket = net.connect(socketPath)
    socket.on('error', () => finish({ behavior: 'deny', message: 'shennian_permission_relay_unreachable' }))
    socket.on('connect', () => socket.write(`${JSON.stringify({ toolName, input })}\n`))
    const rl = createInterface({ input: socket })
    rl.on('line', (line) => {
      try {
        const parsed = JSON.parse(line) as { behavior?: string; updatedInput?: unknown; message?: string }
        finish({
          behavior: parsed.behavior === 'allow' ? 'allow' : 'deny',
          updatedInput: parsed.updatedInput,
          message: parsed.message,
        })
      } catch {
        finish({ behavior: 'deny', message: 'shennian_permission_relay_malformed_response' })
      } finally {
        socket.end()
      }
    })
  })
}

function handleMessage(msg: JsonRpcMessage): void {
  if (msg.method === 'initialize') {
    send({
      id: msg.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: CLAUDE_PERMISSION_MCP_SERVER_NAME, version: '1.0.0' },
      },
    })
    return
  }
  if (msg.method === 'notifications/initialized' || msg.id == null && msg.method?.startsWith('notifications/')) return
  if (msg.method === 'tools/list') {
    send({
      id: msg.id,
      result: {
        tools: [{
          name: CLAUDE_PERMISSION_TOOL_NAME,
          description: 'Relays a Claude Code permission request to the Shennian app for the user to approve.',
          inputSchema: {
            type: 'object',
            properties: { tool_name: { type: 'string' }, input: { type: 'object' } },
            required: ['tool_name', 'input'],
          },
        }, {
          name: CLAUDE_USER_INPUT_TOOL_NAME,
          description: 'Ask the user questions and wait for real answers in the Shennian app. Use this instead of AskUserQuestion. This tool does not grant permissions.',
          inputSchema: { type: 'object', properties: { questions: { type: 'array', minItems: 1, maxItems: 8, items: {
            type: 'object', properties: { id: { type: 'string' }, question: { type: 'string' }, isOther: { type: 'boolean' }, isSecret: { type: 'boolean' }, options: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, description: { type: 'string' } }, required: ['label'] } } }, required: ['id', 'question'],
          } } }, required: ['questions'] },
        }],
      },
    })
    return
  }
  if (msg.method === 'tools/call') {
    const args = (msg.params?.arguments ?? {}) as { tool_name?: unknown; input?: unknown }
    if (msg.params?.name === CLAUDE_USER_INPUT_TOOL_NAME) {
      void relayToDaemon('__shennian_user_input__', args).then(result => {
        send({ id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(result.behavior === 'allow' ? result.updatedInput : { error: result.message ?? 'user_input_unavailable' }) }], isError: result.behavior !== 'allow' } })
      })
      return
    }
    if (msg.params?.name !== CLAUDE_PERMISSION_TOOL_NAME) { send({ id: msg.id, error: { code: -32602, message: 'Unknown tool' } }); return }
    void relayToDaemon(args.tool_name, args.input).then((result) => {
      send({ id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } })
    })
    return
  }
  if (msg.id != null) send({ id: msg.id, error: { code: -32601, message: `Unhandled method: ${msg.method}` } })
}

const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  if (!line.trim()) return
  try {
    handleMessage(JSON.parse(line) as JsonRpcMessage)
  } catch {
    // Malformed line from the host; nothing to recover.
  }
})
