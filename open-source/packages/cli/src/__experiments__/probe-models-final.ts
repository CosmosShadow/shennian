/**
 * Final model probing experiment - verified approaches for each CLI.
 *
 * Summary of findings:
 *
 * | Agent    | Method                        | Complexity | Reliability |
 * |----------|-------------------------------|------------|-------------|
 * | Cursor   | `agent --list-models`         | ★☆☆        | ★★★         |
 * | OpenClaw | `openclaw models list --json`  | ★☆☆        | ★★★         |
 * | Codex    | PTY → /model → parse TUI      | ★★★        | ★★☆         |
 * | Claude   | PTY → /model → parse TUI      | ★★★        | ★★☆         |
 * | Claude   | parse cli.js source (backup)   | ★★☆        | ★★★         |
 * | Gemini   | parse models.js source          | ★★☆        | ★★★         |
 * | Gemini   | PTY → /model → parse TUI      | ★★★        | ★☆☆         |
 *
 * Run with: npx tsx open-source/packages/cli/src/__experiments__/probe-models-final.ts
 */

import { spawn, execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

type ModelEntry = {
  id: string
  name: string
  description?: string
  current?: boolean
  tags?: string[]
}

type ProbeResult = {
  agent: string
  method: string
  success: boolean
  models: ModelEntry[]
  error?: string
  durationMs: number
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').replace(/[\x00-\x09\x0b-\x1f\x7f]/g, ' ')
}

// ═══════════════════════════════════════════════════════════════
// 1. Cursor Agent: `agent --list-models` (★ best approach)
// ═══════════════════════════════════════════════════════════════

async function probeCursorAgent(): Promise<ProbeResult> {
  const start = Date.now()
  return new Promise((resolve) => {
    const proc = spawn('agent', ['--list-models'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15_000,
    })
    let stdout = ''
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.on('close', () => {
      const clean = stripAnsi(stdout)
      const models: ModelEntry[] = []
      for (const line of clean.split('\n')) {
        // Format: "model-id - Display Name  (current, default)"
        const match = line.match(/^(\S+)\s+-\s+(.+?)(?:\s+\((current|default)(?:,\s*(current|default))?\))?$/)
        if (match) {
          const [, id, name, tag1, tag2] = match
          const tags: string[] = []
          if (tag1) tags.push(tag1)
          if (tag2) tags.push(tag2)
          models.push({ id: id.trim(), name: name.trim(), current: tags.includes('current'), tags })
        }
      }
      resolve({ agent: 'cursor', method: 'agent --list-models', success: models.length > 0, models, durationMs: Date.now() - start })
    })
    proc.on('error', (e) => resolve({ agent: 'cursor', method: 'agent --list-models', success: false, models: [], error: String(e), durationMs: Date.now() - start }))
  })
}

// ═══════════════════════════════════════════════════════════════
// 2. OpenClaw: `openclaw models list --all --json`
// ═══════════════════════════════════════════════════════════════

async function probeOpenClaw(): Promise<ProbeResult> {
  const start = Date.now()
  return new Promise((resolve) => {
    const proc = spawn('openclaw', ['models', 'list', '--all', '--json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15_000,
    })
    let stdout = ''
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.on('close', () => {
      try {
        const data = JSON.parse(stdout) as { models: Array<{ key: string; name: string; available: boolean; tags: string[] }> }
        const models = data.models
          .filter(m => m.available)
          .map(m => ({
            id: m.key,
            name: m.name,
            current: m.tags.includes('default'),
            tags: m.tags,
          }))
        resolve({ agent: 'openclaw', method: 'openclaw models list --all --json', success: true, models, durationMs: Date.now() - start })
      } catch (e) {
        resolve({ agent: 'openclaw', method: 'openclaw models list --all --json', success: false, models: [], error: String(e), durationMs: Date.now() - start })
      }
    })
    proc.on('error', (e) => resolve({ agent: 'openclaw', method: 'openclaw models list --all --json', success: false, models: [], error: String(e), durationMs: Date.now() - start }))
  })
}

// ═══════════════════════════════════════════════════════════════
// 3. Claude: parse bundled cli.js for model option objects
// ═══════════════════════════════════════════════════════════════

function probeClaudeFromSource(): ProbeResult {
  const start = Date.now()
  try {
    const binPath = execSync('which claude', { encoding: 'utf-8' }).trim()
    const realPath = fs.realpathSync(binPath)
    const cliJs = fs.readFileSync(realPath, 'utf-8')

    // Extract {value:"...",label:"...",description:"..."} patterns used by the model picker
    const regex = /\{value:"([^"]+)",label:"([^"]+)"(?:,description:"([^"]*)")?\}/g
    const allOptions: Array<{ value: string; label: string; description: string }> = []
    let m: RegExpExecArray | null
    while ((m = regex.exec(cliJs)) !== null) {
      allOptions.push({ value: m[1], label: m[2], description: m[3] || '' })
    }

    // Filter for model-related options (sonnet, opus, haiku, opusplan, inherit, default-like)
    const modelKeywords = ['sonnet', 'opus', 'haiku', 'inherit']
    const models: ModelEntry[] = allOptions
      .filter(o => modelKeywords.some(kw => o.value.toLowerCase().includes(kw)))
      .map(o => ({ id: o.value, name: o.label, description: o.description }))

    // Deduplicate by id (same id may appear with different descriptions for different contexts)
    const seen = new Set<string>()
    const unique = models.filter(m => {
      if (seen.has(m.id)) return false
      seen.add(m.id)
      return true
    })

    return { agent: 'claude', method: 'parse cli.js source', success: unique.length > 0, models: unique, durationMs: Date.now() - start }
  } catch (e) {
    return { agent: 'claude', method: 'parse cli.js source', success: false, models: [], error: String(e), durationMs: Date.now() - start }
  }
}

// ═══════════════════════════════════════════════════════════════
// 4. Gemini: parse models.js from @google/gemini-cli-core
// ═══════════════════════════════════════════════════════════════

function probeGeminiFromSource(): ProbeResult {
  const start = Date.now()
  try {
    const binPath = execSync('which gemini', { encoding: 'utf-8' }).trim()
    const realPath = fs.realpathSync(binPath)
    const pkgDir = path.dirname(path.dirname(realPath)) // go up from dist/index.js to package root

    // Find models.js in the core package
    const modelsJsPath = path.join(pkgDir, 'node_modules/@google/gemini-cli-core/dist/src/config/models.js')
    const modelsJs = fs.readFileSync(modelsJsPath, 'utf-8')

    // Extract constants: export const SOME_MODEL = 'model-name';
    const constantRegex = /export const (\w+)\s*=\s*'([^']+)'/g
    const constants: Record<string, string> = {}
    let cm: RegExpExecArray | null
    while ((cm = constantRegex.exec(modelsJs)) !== null) {
      constants[cm[1]] = cm[2]
    }

    // Extract VALID_GEMINI_MODELS set members
    const validSetMatch = modelsJs.match(/VALID_GEMINI_MODELS\s*=\s*new Set\(\[([^\]]+)\]\)/)
    const validModels: string[] = []
    if (validSetMatch) {
      const refs = validSetMatch[1].match(/\w+/g) || []
      for (const ref of refs) {
        if (constants[ref]) validModels.push(constants[ref])
      }
    }

    // Extract display names from getDisplayString
    const displayMap: Record<string, string> = {}
    const displayRegex = /case (\w+):\s*return '([^']+)'/g
    let dm: RegExpExecArray | null
    while ((dm = displayRegex.exec(modelsJs)) !== null) {
      const constName = dm[1]
      const displayName = dm[2]
      if (constants[constName]) {
        displayMap[constants[constName]] = displayName
      }
    }

    // Also add auto models
    const autoModels = ['auto-gemini-3', 'auto-gemini-2.5']

    const allModels = [...new Set([...autoModels, ...validModels])]
    const models: ModelEntry[] = allModels.map(id => ({
      id,
      name: displayMap[id] || id,
      description: id.includes('preview') ? 'Preview' : id.includes('auto') ? 'Auto mode' : 'Stable',
    }))

    // Add aliases
    const aliases = [
      { id: 'auto', name: 'Auto', description: 'Alias for current auto mode' },
      { id: 'pro', name: 'Pro', description: 'Alias for latest pro model' },
      { id: 'flash', name: 'Flash', description: 'Alias for latest flash model' },
      { id: 'flash-lite', name: 'Flash Lite', description: 'Alias for flash lite model' },
    ]

    return {
      agent: 'gemini',
      method: 'parse @google/gemini-cli-core models.js',
      success: models.length > 0,
      models: [...models, ...aliases],
      durationMs: Date.now() - start,
    }
  } catch (e) {
    return { agent: 'gemini', method: 'parse models.js', success: false, models: [], error: String(e), durationMs: Date.now() - start }
  }
}

// ═══════════════════════════════════════════════════════════════
// 5. Codex: PTY approach (verified working)
//    In production use pexpect/node-pty; here just document the result
// ═══════════════════════════════════════════════════════════════

function probeCodexManual(): ProbeResult {
  // This was captured from the pexpect PTY probe experiment
  const models: ModelEntry[] = [
    { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', description: 'Latest frontier agentic coding model', current: true },
    { id: 'gpt-5.4', name: 'GPT-5.4', description: 'Latest frontier agentic coding model' },
    { id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex', description: 'Frontier agentic coding model' },
    { id: 'gpt-5.1-codex-max', name: 'GPT-5.1 Codex Max', description: 'Codex-optimized flagship for deep and fast reasoning' },
    { id: 'gpt-5.2', name: 'GPT-5.2', description: 'Latest frontier model with improvements across knowledge, reasoning and coding' },
    { id: 'gpt-5.1-codex-mini', name: 'GPT-5.1 Codex Mini', description: 'Optimized for codex. Cheaper, faster, but less capable' },
  ]
  return { agent: 'codex', method: 'PTY /model (captured result)', success: true, models, durationMs: 0 }
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗')
  console.log('║            Model List Probing - Final Results               ║')
  console.log('╚══════════════════════════════════════════════════════════════╝')

  const results: ProbeResult[] = []

  // Run async probes in parallel
  const [cursorResult, openClawResult] = await Promise.all([
    probeCursorAgent(),
    probeOpenClaw(),
  ])
  results.push(cursorResult, openClawResult)

  // Sync probes
  results.push(probeClaudeFromSource())
  results.push(probeGeminiFromSource())
  results.push(probeCodexManual())

  // Print results
  for (const r of results) {
    console.log(`\n${'─'.repeat(60)}`)
    console.log(`Agent: ${r.agent}`)
    console.log(`Method: ${r.method}`)
    console.log(`Status: ${r.success ? '✅ Success' : '❌ Failed'}`)
    console.log(`Duration: ${r.durationMs}ms`)
    if (r.error) console.log(`Error: ${r.error}`)
    console.log(`Models (${r.models.length}):`)
    for (const m of r.models) {
      const flags = [m.current && '●', ...(m.tags || [])].filter(Boolean).join(' ')
      console.log(`  ${flags ? flags + ' ' : ''}${m.id}  →  ${m.name}${m.description ? '  (' + m.description + ')' : ''}`)
    }
  }

  // Summary
  console.log(`\n${'═'.repeat(60)}`)
  console.log('SUMMARY:')
  console.log('═'.repeat(60))
  for (const r of results) {
    console.log(`  ${r.success ? '✅' : '❌'} ${r.agent.padEnd(10)} ${r.models.length.toString().padStart(3)} models  [${r.method}]  ${r.durationMs}ms`)
  }
}

main().catch(console.error)
