// @covers src/relay/machine-connection.ts
// @covers src/relay/personal-history-relay.ts
// @covers src/relay/pubsub.ts

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { describeFrame } from '../relay/handler.js'

const source = (relative: string) => fs.readFileSync(path.resolve(__dirname, relative), 'utf8')

describe('personal sync relay privacy boundary', () => {
  it('reduces body/tool/thinking diagnostics to byte counts without retaining values', () => {
    const secrets = {
      body: 'PERSONAL_BODY_SENTINEL_7d8c',
      thinking: 'THINKING_SENTINEL_2a31',
      args: 'RAW_TOOL_SENTINEL_f084',
      attachment: 'ATTACHMENT_BYTES_SENTINEL_91bb',
    }
    const diagnostic = describeFrame(
      JSON.stringify({
        type: 'event',
        event: 'session.body.delta',
        payload: {
          sessionId: 'session-safe-id',
          text: secrets.body,
          thinking: secrets.thinking,
          args: secrets.args,
          attachment: secrets.attachment,
        },
      }),
    )
    const serialized = JSON.stringify(diagnostic)

    expect(diagnostic).toMatchObject({
      event: 'session.body.delta',
      frameType: 'event',
      sessionId: 'session-safe-id',
      payloadBytes: expect.any(Number),
      textBytes: expect.any(Number),
      argsBytes: expect.any(Number),
    })
    for (const value of Object.values(secrets)) expect(serialized).not.toContain(value)
  })

  it('describes chat requests without retaining message bodies', () => {
    const secret = 'ROOM_MESSAGE_SENTINEL_41fa'
    const diagnostic = describeFrame(
      JSON.stringify({
        type: 'req',
        id: 'traceable-request-id',
        method: 'chat.enqueue',
        params: { sessionId: 'session-safe-id', text: secret },
      }),
    )

    expect(diagnostic).toMatchObject({
      key: 'req:chat.enqueue',
      requestId: 'traceable-request-id',
      sessionId: 'session-safe-id',
      frameType: 'req',
    })
    expect(JSON.stringify(diagnostic)).not.toContain(secret)
  })

  it('keeps the personal relay free of durable stores and Redis history free of queue commands', () => {
    const relay = source('../relay/personal-history-relay.ts')
    const pubsub = source('../relay/pubsub.ts')

    expect(relay).not.toMatch(/from ['"].*(prisma|oss|services\/log|analytics)/)
    expect(relay).not.toMatch(/console\.(log|warn|error)/)
    expect(pubsub).toContain('.publish(HISTORY_PREFIX + routeKey, data)')
    expect(pubsub).not.toMatch(/\.(set|setex|hset|lpush|rpush|xadd)\(HISTORY_PREFIX/i)
  })

  it('translates an accepted daemon index into the session.update event consumed by mobile', () => {
    const handler = source('../relay/machine-connection.ts')
    const branchStart = handler.indexOf("event.event === 'session.index.updated'")
    const branchEnd = handler.indexOf("event.event === 'session.message'", branchStart)
    const branch = handler.slice(branchStart, branchEnd)

    expect(branch).toContain("event: 'session.update'")
    expect(branch).toContain('pubsub.publishToUser(ownerId')
    expect(branch).toContain('payload: { machineId, session: result.sessionPatch }')
    expect(branch).not.toContain('JSON.stringify(event)')
  })
})
