#!/usr/bin/env node
/* global process */
/**
 * Minimal Shennian agent — spawn mode, pure Node.js (no dependencies).
 *
 * Handles:
 *   hello-spawn.mjs /caps              → prints caps JSON and exits
 *   hello-spawn.mjs /run [options]     → reads stdin, prints JSONL events, exits
 *
 * Register with CLI:
 *   shennian agent add hello --command "node /path/to/hello-spawn.mjs"
 *
 * Used as the canonical test fixture for custom agent e2e tests.
 */

import { randomUUID } from 'node:crypto'

const command = process.argv[2]

function emit(event) {
  process.stdout.write(JSON.stringify(event) + '\n')
}

// ── /caps ─────────────────────────────────────────────────────────────────

if (command === '/caps') {
  emit({
    name: 'Hello Agent',
    model: 'hello-v1',
    mode: 'spawn',
    version: '1.0.0',
  })
  process.exit(0)
}

// ── /run ──────────────────────────────────────────────────────────────────

if (command === '/run') {
  const runId = randomUUID()
  let seq = 0

  const chunks = []
  process.stdin.on('data', (chunk) => chunks.push(chunk))
  process.stdin.on('end', () => {
    const text = Buffer.concat(chunks).toString('utf-8').trim()
    emit({ state: 'delta', text: `Hello! You said: "${text}"`, runId, seq: seq++ })
    emit({ state: 'final', runId, seq: seq++ })
  })
} else {
  process.stderr.write(`Usage: hello-spawn.mjs /caps | /run [--workdir <path>]\n`)
  process.exit(1)
}
