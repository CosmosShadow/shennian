/**
 * @arch open-source/docs/cli-runtime.md
 * @covers src/agents/workbuddy.ts
 *
 * Real WorkBuddy contract smoke. This uses the locally authenticated WorkBuddy
 * account and intentionally reports only booleans and timing, never Session IDs,
 * prompts, transcripts, command lines, or connector credentials.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AgentEvent } from '../agents/adapter.js'
import { WorkBuddyAdapter } from '../agents/workbuddy.js'

const TURN_TIMEOUT_MS = 120_000

async function runTurn(adapter: WorkBuddyAdapter, prompt: string): Promise<{
  text: string
  agentSessionId: string
  toolNames: string[]
}> {
  return await new Promise((resolve, reject) => {
    let text = ''
    const toolNames: string[] = []
    let settled = false
    const finish = (error?: Error, event?: AgentEvent) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      adapter.off('agentEvent', onEvent)
      adapter.off('error', onError)
      if (error) reject(error)
      else if (!event?.agentSessionId) reject(new Error('WorkBuddy final event did not include a Session ID.'))
      else resolve({ text, agentSessionId: event.agentSessionId, toolNames })
    }
    const onEvent = (event: AgentEvent) => {
      if (event.state === 'delta' && event.text && !event.thinking) text += event.text
      if (event.state === 'tool-call' && event.name) toolNames.push(event.name)
      if (event.state === 'error') finish(new Error(event.message || 'WorkBuddy returned an error.'))
      if (event.state === 'final') finish(undefined, event)
    }
    const onError = (error: Error) => finish(error)
    const timer = setTimeout(() => finish(new Error('WorkBuddy real adapter smoke timed out.')), TURN_TIMEOUT_MS)
    adapter.on('agentEvent', onEvent)
    adapter.on('error', onError)
    void adapter.send(prompt).catch(onError)
  })
}

async function main() {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'shennian-workbuddy-adapter-'))
  const first = new WorkBuddyAdapter()
  const second = new WorkBuddyAdapter()
  const startedAt = Date.now()
  try {
    await first.start('workbuddy-e2e-first', workDir)
    const firstResult = await runTurn(
      first,
      'Use the Bash tool to run pwd, then reply with exactly SHENNIAN_WB_ONE and nothing else.',
    )
    await first.stop()

    await second.start('workbuddy-e2e-second', workDir, firstResult.agentSessionId)
    const secondResult = await runTurn(second, 'Reply with exactly SHENNIAN_WB_TWO and nothing else.')
    await second.stop()

    const result = {
      firstReplyPassed: firstResult.text.includes('SHENNIAN_WB_ONE'),
      builtinToolPassed: firstResult.toolNames.includes('Bash'),
      resumedReplyPassed: secondResult.text.includes('SHENNIAN_WB_TWO'),
      sessionIdStable: firstResult.agentSessionId === secondResult.agentSessionId,
      durationMs: Date.now() - startedAt,
    }
    console.log(JSON.stringify(result))
    if (
      !result.firstReplyPassed ||
      !result.builtinToolPassed ||
      !result.resumedReplyPassed ||
      !result.sessionIdStable
    ) process.exitCode = 1
  } finally {
    await first.stop().catch(() => {})
    await second.stop().catch(() => {})
    await rm(workDir, { recursive: true, force: true })
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'WorkBuddy real adapter smoke failed.')
  process.exitCode = 1
})
