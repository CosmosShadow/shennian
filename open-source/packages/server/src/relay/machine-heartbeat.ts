// @arch open-source/docs/server-runtime.md
// @test open-source/packages/server/src/__tests__/machine-heartbeat.test.ts

export const MACHINE_PING_INTERVAL = 25_000
export const MACHINE_MISSED_PONG_LIMIT = 3

export type MachineHeartbeatTickResult = 'pinged' | 'pong_timeout' | 'ping_error'

type PingableSocket = {
  ping(): void
}

/**
 * Small state machine shared by the relay and its unit test. Timer ownership,
 * connection shutdown and close-reason logging stay with the relay handler.
 */
export class MachineHeartbeat {
  private missedPongs = 0

  constructor(
    private readonly socket: PingableSocket,
    private readonly missedPongLimit = MACHINE_MISSED_PONG_LIMIT,
  ) {
    if (!Number.isInteger(missedPongLimit) || missedPongLimit < 1) {
      throw new Error('missedPongLimit must be a positive integer')
    }
  }

  markAlive(): void {
    this.missedPongs = 0
  }

  getMissedPongs(): number {
    return this.missedPongs
  }

  tick(): MachineHeartbeatTickResult {
    if (this.missedPongs >= this.missedPongLimit) return 'pong_timeout'

    this.missedPongs += 1
    try {
      this.socket.ping()
      return 'pinged'
    } catch {
      return 'ping_error'
    }
  }
}
