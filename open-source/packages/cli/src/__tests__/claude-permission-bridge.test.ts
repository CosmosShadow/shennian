// @covers src/agents/claude-permission-bridge.ts

import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { ClaudePermissionBridge, type ClaudePermissionDecision } from '../agents/claude-permission-bridge.js'

const bridges: ClaudePermissionBridge[] = []
afterEach(async () => { await Promise.all(bridges.splice(0).map((bridge) => bridge.stop())) })

function ask(socketPath: string, line: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath)
    let received = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => { received += chunk })
    socket.on('end', () => resolve(received.trim()))
    socket.on('error', reject)
    socket.once('connect', () => socket.write(`${line}\n`))
  })
}

describe('Claude permission bridge', () => {
  it('relays a tool request to the parent decision and answers on the same socket', async () => {
    const seen: unknown[] = []
    const bridge = new ClaudePermissionBridge(async (toolName, input): Promise<ClaudePermissionDecision> => {
      seen.push([toolName, input])
      return { behavior: 'allow', updatedInput: { ok: true } }
    })
    bridges.push(bridge)
    const socketPath = await bridge.start()
    const answer = await ask(socketPath, JSON.stringify({ toolName: 'Bash', input: { command: 'ls' } }))
    expect(JSON.parse(answer)).toEqual({ behavior: 'allow', updatedInput: { ok: true } })
    expect(seen).toEqual([['Bash', { command: 'ls' }]])
  })

  it('denies a malformed request without consulting the parent', async () => {
    let called = false
    const bridge = new ClaudePermissionBridge(async () => { called = true; return { behavior: 'allow' } })
    bridges.push(bridge)
    const answer = await ask(await bridge.start(), 'not json')
    expect(JSON.parse(answer)).toMatchObject({ behavior: 'deny', message: 'shennian_permission_request_malformed' })
    expect(called).toBe(false)
  })

  it('keeps the socket path short and closes it on stop', async () => {
    const bridge = new ClaudePermissionBridge(async () => ({ behavior: 'deny' }))
    const socketPath = await bridge.start()
    expect(Buffer.byteLength(socketPath)).toBeLessThan(104)
    await bridge.stop()
    await expect(ask(socketPath, '{}')).rejects.toThrow()
  })
})
