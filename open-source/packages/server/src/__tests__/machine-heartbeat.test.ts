// @covers open-source/packages/server/src/relay/machine-heartbeat.ts

import { describe, expect, it, vi } from 'vitest'
import {
  MachineHeartbeat,
  MACHINE_MISSED_PONG_LIMIT,
  MACHINE_PING_INTERVAL,
} from '../relay/machine-heartbeat.js'

describe('Machine heartbeat (ping/pong)', () => {
  it('keeps the production interval and grace window explicit', () => {
    expect(MACHINE_PING_INTERVAL).toBe(25_000)
    expect(MACHINE_MISSED_PONG_LIMIT).toBe(3)
  })

  it('pings until the bounded missed-pong grace window expires', () => {
    const socket = { ping: vi.fn() }
    const heartbeat = new MachineHeartbeat(socket)

    expect(heartbeat.tick()).toBe('pinged')
    expect(socket.ping).toHaveBeenCalledTimes(1)
    expect(heartbeat.tick()).toBe('pinged')
    expect(heartbeat.tick()).toBe('pinged')
    expect(socket.ping).toHaveBeenCalledTimes(3)
    expect(heartbeat.tick()).toBe('pong_timeout')
    expect(socket.ping).toHaveBeenCalledTimes(MACHINE_MISSED_PONG_LIMIT)
  })

  it('treats ping, pong, or message activity as alive', () => {
    const heartbeat = new MachineHeartbeat({ ping: vi.fn() })
    heartbeat.tick()
    heartbeat.tick()
    expect(heartbeat.getMissedPongs()).toBe(2)

    heartbeat.markAlive()
    expect(heartbeat.getMissedPongs()).toBe(0)
    expect(heartbeat.tick()).toBe('pinged')
  })

  it('reports ping failures to the relay owner', () => {
    const heartbeat = new MachineHeartbeat({
      ping: () => {
        throw new Error('closed')
      },
    })
    expect(heartbeat.tick()).toBe('ping_error')
  })

  it('rejects an invalid grace window', () => {
    expect(() => new MachineHeartbeat({ ping: vi.fn() }, 0)).toThrow(
      'missedPongLimit must be a positive integer',
    )
  })
})
