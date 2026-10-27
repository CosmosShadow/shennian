// @arch open-source/docs/cli-runtime.md

import type { AgentEvent } from './adapter.js'

const TERMINAL_STATES = new Set(['final', 'error', 'aborted'])

/**
 * Provider adapters do not all expose the same native lifecycle. This gate is
 * the common, provider-independent boundary that makes a Shennian run
 * terminal exactly once and hides every late event for that run.
 *
 * The bounded history protects long-lived daemon sessions without relying on
 * provider run ids being globally unique forever.
 */
export class AgentEventTerminalGate {
  private readonly terminalRunIds = new Set<string>()
  private readonly terminalOrder: string[] = []

  constructor(private readonly historyLimit = 256) {}

  accept(event: AgentEvent): boolean {
    if (this.terminalRunIds.has(event.runId)) return false
    if (!TERMINAL_STATES.has(event.state)) return true

    this.terminalRunIds.add(event.runId)
    this.terminalOrder.push(event.runId)
    while (this.terminalOrder.length > this.historyLimit) {
      const expired = this.terminalOrder.shift()
      if (expired !== undefined) this.terminalRunIds.delete(expired)
    }
    return true
  }
}
