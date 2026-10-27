// @arch open-source/docs/cli-runtime.md
// @covers src/agents/pi-rpc-client.ts

import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { PiRpcClient } from '../agents/pi-rpc-client.js'

function fakeProcess() {
  const process = new EventEmitter() as EventEmitter & {
    stdin: PassThrough
    stdout: PassThrough
  }
  process.stdin = new PassThrough()
  process.stdout = new PassThrough()
  return process
}

function nextWrittenJson(stream: PassThrough): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    stream.once('data', (chunk) => resolve(JSON.parse(chunk.toString('utf8').trim())))
  })
}

describe('PiRpcClient', () => {
  it('correlates responses by id even when they arrive out of order', async () => {
    const process = fakeProcess()
    const client = new PiRpcClient(process as never)
    const firstWritten = nextWrittenJson(process.stdin)
    const first = client.request('get_state')
    const firstCommand = await firstWritten
    const secondWritten = nextWrittenJson(process.stdin)
    const second = client.request('get_entries')
    const secondCommand = await secondWritten

    process.stdout.write(`${JSON.stringify({ type: 'response', id: secondCommand.id, success: true, data: { value: 2 } })}\n`)
    process.stdout.write(`${JSON.stringify({ type: 'response', id: firstCommand.id, success: true, data: { value: 1 } })}\n`)

    await expect(first).resolves.toMatchObject({ data: { value: 1 } })
    await expect(second).resolves.toMatchObject({ data: { value: 2 } })
    client.close()
  })

  it('splits only on LF and preserves Unicode line separators inside JSON strings', async () => {
    const process = fakeProcess()
    const client = new PiRpcClient(process as never)
    const events: Array<Record<string, unknown>> = []
    client.on('event', (event) => events.push(event))

    const record = JSON.stringify({ type: 'message_update', text: `left\u2028middle\u2029right` })
    const midpoint = Buffer.byteLength(record.slice(0, record.indexOf('middle')), 'utf8')
    const encoded = Buffer.from(`${record}\n`)
    process.stdout.write(encoded.subarray(0, midpoint))
    process.stdout.write(encoded.subarray(midpoint))

    expect(events).toEqual([{ type: 'message_update', text: `left\u2028middle\u2029right` }])
    client.close()
  })

  it('fails closed on malformed JSON and rejects pending requests', async () => {
    const process = fakeProcess()
    const client = new PiRpcClient(process as never)
    const protocolErrors: Error[] = []
    client.on('protocolError', (error) => protocolErrors.push(error))
    const written = nextWrittenJson(process.stdin)
    const pending = client.request('get_state')
    await written

    process.stdout.write('{not-json}\n')

    await expect(pending).rejects.toThrow('Invalid Pi RPC JSON record')
    expect(protocolErrors).toHaveLength(1)
  })

  it('rejects an unterminated final record instead of accepting non-JSONL framing', async () => {
    const process = fakeProcess()
    const client = new PiRpcClient(process as never)
    const protocolErrors: Error[] = []
    client.on('protocolError', (error) => protocolErrors.push(error))

    process.stdout.write(JSON.stringify({ type: 'message_update', text: 'partial' }))
    process.stdout.end()

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(protocolErrors).toEqual([
      expect.objectContaining({ message: expect.stringContaining('unterminated JSONL') }),
    ])
  })
})
