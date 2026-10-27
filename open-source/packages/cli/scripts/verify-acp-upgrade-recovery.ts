#!/usr/bin/env tsx

// Real-agent release evidence. Never prints prompts, session IDs, output, or stderr.
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { AcpAgentAdapter } from '../src/agents/acp/adapter.js'
import type { AgentEvent } from '../src/agents/adapter.js'

const kind = process.argv[2]
const launch = kind === 'qwen'
  ? { command: 'qwen', args: ['--acp'] }
  : kind === 'kimi'
    ? { command: 'kimi', args: ['acp'] }
    : null
if (!launch) throw new Error('usage: verify-acp-upgrade-recovery.ts qwen|kimi')

function adapter() {
  return new AcpAgentAdapter({
    id: `${kind}-release-validation`,
    name: `${kind} release validation`,
    launch,
    source: 'local',
  }, { promptTimeoutMs: 120_000, permissionTimeoutMs: 30_000 })
}

const cwd = path.join(os.tmpdir(), 'shennian-acp-upgrade-recovery')
fs.mkdirSync(cwd, { recursive: true, mode: 0o700 })
const first = adapter()
let nativeId: string | null = null
let firstTerminals = 0
first.on('agentEvent', (event: AgentEvent) => {
  if (event.agentSessionId) nativeId = event.agentSessionId
  if (event.state === 'final' || event.state === 'error' || event.state === 'aborted') firstTerminals += 1
  if (event.state === 'approval-pending' && event.permission) {
    const reject = event.permission.options.find((option) => option.kind.startsWith('reject'))
    if (reject) void first.respondToPermission(event.permission.id, reject.id)
  }
})
await first.start('acp-release-first', cwd)
await first.send('Reply with exactly READY and do not use tools.')
await first.stop()
if (!nativeId || firstTerminals !== 1) throw new Error('first ACP turn did not produce one stable terminal')

const recovered = adapter()
let recoveredTerminals = 0
let resumedIdentity = true
recovered.on('agentEvent', (event: AgentEvent) => {
  if (event.agentSessionId && event.agentSessionId !== nativeId) resumedIdentity = false
  if (event.state === 'final' || event.state === 'error' || event.state === 'aborted') recoveredTerminals += 1
  if (event.state === 'approval-pending' && event.permission) {
    const reject = event.permission.options.find((option) => option.kind.startsWith('reject'))
    if (reject) void recovered.respondToPermission(event.permission.id, reject.id)
  }
})
await recovered.start('acp-release-first', cwd, nativeId)
let dispatchIntent = 0
const result = await recovered.recoverInterruptedRun({
  sessionId: 'acp-release-first',
  shennianRunId: 'upgrade-recovery',
  workDir: cwd,
  agentSessionId: nativeId,
  providerRunId: null,
  lastObservedEventSeq: 0,
  continueDispatchState: 'none',
  sendContext: { source: 'upgrade_recovery', recovery: 'upgrade' },
  beforeContinueDispatch: () => { dispatchIntent += 1 },
})
await recovered.stop()
if (
  result.result !== 'continued' || dispatchIntent !== 1 || recoveredTerminals !== 1 || !resumedIdentity
) throw new Error('ACP recovery contract failed')
console.log(`${kind} ACP exact-session upgrade recovery: pass`)
