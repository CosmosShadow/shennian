/**
 * @arch open-source/docs/cli-runtime.md
 * @covers src/agents/adapter.ts
 * @covers src/agents/claude.ts, codex.ts, workbuddy.ts, gemini.ts, cursor.ts, opencode.ts, pi-coding-agent.ts
 * @covers src/agents/custom.ts
 *
 * E2E smoke test for all currently enabled agent adapters (built-in + custom).
 *
 * Usage:  npx tsx src/__tests__/agents-e2e.ts [agent-name]
 *
 * Gemini and Cursor are compatibility adapters and are ignored by the default contract run.
 * Pi is also excluded here because it needs the user's own Pi provider login.
 * Pass an adapter name explicitly only when its external prerequisites are satisfied.
 *
 * Each adapter is asked to return a stable ASCII contract token without translating it.
 * Pass criteria: at least one `delta` event whose text contains that token,
 * followed by a `final` event, within TIMEOUT_MS.
 */

import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import '../agents/claude.js'
import '../agents/codex.js'
import '../agents/workbuddy.js'
import '../agents/gemini.js'
import '../agents/cursor.js'
// OpenClaw support is intentionally disabled.
// import '../agents/openclaw.js'
import '../agents/opencode.js'
import '../agents/pi-coding-agent.js'
import { registerCustomAgent } from '../agents/custom.js'
import { createAgent, getRegisteredAgents, type AgentEvent } from '../agents/adapter.js'
import type { AgentType } from '@shennian/wire'

// Register the built-in example agent as a custom agent for e2e testing.
// This verifies the full custom agent path: caps probe → CustomAgentAdapter → spawn → JSONL parse.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const helloAgentPath = path.resolve(__dirname, '../../../agent-protocol/examples/node/hello-spawn.mjs')
registerCustomAgent('hello', {
  command: `node ${helloAgentPath}`,
  caps: { name: 'Hello Agent', model: 'hello-v1', mode: 'spawn', version: '1.0.0' },
})

const EXPECTED_TOKEN = 'SHENNIAN_AGENT_E2E_OK'
const PROMPT = `Reply with exactly this ASCII token: ${EXPECTED_TOKEN}. Do not translate it or add any other text.`
const TIMEOUT_MS = 60_000
const WORK_DIR = path.join(os.tmpdir(), 'shennian-agent-e2e')
fs.mkdirSync(WORK_DIR, { recursive: true, mode: 0o700 })

type TestResult = {
  agent: AgentType
  status: 'pass' | 'fail' | 'skip' | 'timeout' | 'error'
  events: AgentEvent[]
  collectedText: string
  errorMessage?: string
  durationMs: number
}

const COMPATIBILITY_AGENTS = new Set<AgentType>(['gemini', 'cursor'])
const DEFAULT_IGNORED_AGENTS = new Set<AgentType>(['gemini', 'cursor', 'pi-coding-agent'])
const DEFAULT_MODEL_BY_AGENT = new Map<AgentType, string>([
  // Keep the contract smoke on Claude's stable default alias instead of any local
  // provider-specific model selected in a developer's shell config.
  ['claude', 'sonnet'],
])

async function testAgent(agentType: AgentType): Promise<TestResult> {
  const start = Date.now()
  const events: AgentEvent[] = []
  let collectedText = ''
  const assertionMarker = `${EXPECTED_TOKEN}_${randomUUID()}`
  const prompt = `Reply with exactly this ASCII token: ${assertionMarker}. Do not translate it or add any other text.`

  const adapter = createAgent(agentType)
  if (!adapter) {
    return {
      agent: agentType,
      status: 'skip',
      events: [],
      collectedText: '',
      errorMessage: `createAgent("${agentType}") returned null`,
      durationMs: Date.now() - start,
    }
  }

  return new Promise<TestResult>((resolve) => {
    let resolved = false
    const done = async (status: TestResult['status'], errorMessage?: string) => {
      if (resolved) return
      resolved = true
      clearTimeout(timer)
      let stopError: string | undefined
      try {
        await adapter.stop()
      } catch (error) {
        stopError = error instanceof Error ? error.message : String(error)
      }
      resolve({
        agent: agentType,
        status: stopError ? 'error' : status,
        events,
        collectedText,
        errorMessage: [errorMessage, stopError].filter(Boolean).join('; ') || undefined,
        durationMs: Date.now() - start,
      })
    }

    const timer = setTimeout(() => {
      void done('timeout', `Timed out after ${TIMEOUT_MS}ms. Collected text: "${collectedText}"`)
    }, TIMEOUT_MS)

    adapter.on('agentEvent', (event) => {
      events.push(event)
      if (event.state === 'delta' && event.text) {
        collectedText += event.text
      }
      if (event.state === 'final') {
        clearTimeout(timer)
        const hasExpectedToken = collectedText.includes(EXPECTED_TOKEN)
        void done(
          hasExpectedToken ? 'pass' : 'fail',
          hasExpectedToken ? undefined : `No contract token in output: "${collectedText}"`,
        )
      }
      if (event.state === 'error') {
        clearTimeout(timer)
        void done('error', event.message ?? 'unknown agent error')
      }
    })

    adapter.on('error', (err) => {
      clearTimeout(timer)
      void done('error', err.message)
    })

    adapter.start(`test-${agentType}-${Date.now()}`, WORK_DIR, null, {
      persistNativeSession: agentType !== 'claude' && agentType !== 'workbuddy',
    })
      .then(() => adapter.send(prompt, DEFAULT_MODEL_BY_AGENT.get(agentType)))
      .catch((err) => {
        clearTimeout(timer)
        void done('error', err instanceof Error ? err.message : String(err))
      })
  })
}

async function main() {
  const filterArg = process.argv[2]
  const allAgents = getRegisteredAgents()

  const ignoredByDefault = allAgents.filter((a) => DEFAULT_IGNORED_AGENTS.has(a))
  const toTest = filterArg
    ? allAgents.filter((a) => a === filterArg)
    : allAgents.filter((a) => !DEFAULT_IGNORED_AGENTS.has(a))

  if (toTest.length === 0) {
    console.error(`No matching agent. Available: ${allAgents.join(', ')}`)
    process.exit(1)
  }

  console.log(`\n🧪 Agent E2E Test — Testing ${toTest.length} adapter(s)\n`)
  console.log(`   Prompt: "${PROMPT}"`)
  console.log(`   Timeout: ${TIMEOUT_MS / 1000}s per agent`)
  if (!filterArg && ignoredByDefault.length > 0) {
    console.log(`   Ignored by default: ${ignoredByDefault.join(', ')} (run with adapter name to test explicitly)`)
  }
  console.log('')

  const results: TestResult[] = []

  for (const agentType of toTest) {
    process.stdout.write(`  ⏳ ${agentType} ... `)
    const result = await testAgent(agentType)
    results.push(result)

    const icon = result.status === 'pass' ? '✅' :
                 result.status === 'skip' ? '⏭️' :
                 result.status === 'timeout' ? '⏰' : '❌'
    console.log(`${icon} ${result.status} (${(result.durationMs / 1000).toFixed(1)}s)`)
    if (result.errorMessage) {
      console.log(`     → ${result.errorMessage}`)
    }
    if (result.status === 'pass') {
      console.log(`     → "${result.collectedText.trim().slice(0, 80)}"`)
    }
  }

  console.log('\n' + '─'.repeat(50))
  console.log('Summary:')
  for (const r of results) {
    const icon = r.status === 'pass' ? '✅' : r.status === 'skip' ? '⏭️' : '❌'
    const tier = COMPATIBILITY_AGENTS.has(r.agent) ? 'compat' : 'core'
    console.log(`  ${icon} ${r.agent}: ${r.status} (${tier})`)
  }

  const hardFailed = results.filter(
    (r) => !COMPATIBILITY_AGENTS.has(r.agent) && r.status !== 'pass' && r.status !== 'skip',
  )
  const softFailed = results.filter(
    (r) => COMPATIBILITY_AGENTS.has(r.agent) && r.status !== 'pass' && r.status !== 'skip',
  )

  if (softFailed.length > 0) {
    console.log(`\nCompatibility agent warnings (${softFailed.length}):`)
    for (const result of softFailed) {
      console.log(`  - ${result.agent}: ${result.status}${result.errorMessage ? ` — ${result.errorMessage}` : ''}`)
    }
  }

  if (hardFailed.length > 0) {
    console.log(`\n${hardFailed.length} core agent(s) need fixing.`)
    process.exit(1)
  } else {
    console.log('\nAll core agents passed!')
    process.exit(0)
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
