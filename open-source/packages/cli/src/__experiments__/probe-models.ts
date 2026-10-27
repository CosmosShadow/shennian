/**
 * Experimental script: probe model lists from each Agent CLI.
 *
 * Run with:  npx tsx open-source/packages/cli/src/__experiments__/probe-models.ts
 */

import { spawn, execFileSync } from 'node:child_process'
import { createInterface } from 'node:readline'

// ─── Utilities ──────────────────────────────────────────────────────────────

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
}

type ModelEntry = { id: string; name: string; description: string; current?: boolean }

// ─── 1. OpenClaw: openclaw models list --all --json ─────────────────────────

async function probeOpenClaw(): Promise<ModelEntry[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn('openclaw', ['models', 'list', '--all', '--json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15_000,
    })
    let stdout = ''
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.on('close', (code) => {
      try {
        const data = JSON.parse(stdout) as { models: Array<{ key: string; name: string; available: boolean; tags: string[] }> }
        const models = data.models
          .filter(m => m.available)
          .map(m => ({ id: m.key, name: m.name, description: m.tags.join(', '), current: m.tags.includes('default') }))
        resolve(models)
      } catch (e) {
        reject(new Error(`Failed to parse openclaw output (code ${code}): ${e}`))
      }
    })
    proc.on('error', reject)
  })
}

// ─── 2. Claude: use `script` to create PTY and capture /model output ────────

async function probeClaude(): Promise<ModelEntry[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('timeout')) }, 20_000)

    // Use macOS `script` command to create a PTY wrapper
    // script -q /dev/null claude  ← allocates PTY, captures to /dev/null, streams to stdout
    const proc = spawn('script', ['-q', '/dev/null', 'claude'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TERM: 'dumb', COLUMNS: '200', LINES: '50' },
    })

    let output = ''
    let sentModel = false
    let sentEsc = false

    proc.stdout.on('data', (d: Buffer) => {
      output += d.toString()

      // Wait for Claude to be ready (shows the prompt), then send /model
      if (!sentModel && (output.includes('>') || output.includes('❯'))) {
        sentModel = true
        proc.stdin.write('/model\n')
      }

      // Wait for model list to fully render
      if (sentModel && !sentEsc && (output.includes('Esc to exit') || output.includes('to confirm'))) {
        sentEsc = true
        // Send ESC then Ctrl+C to exit
        proc.stdin.write('\x1b')
        setTimeout(() => {
          proc.stdin.write('\x03')
          proc.stdin.end()
        }, 500)
      }
    })

    proc.on('close', () => {
      clearTimeout(timer)
      const models = parseClaudeModelList(output)
      resolve(models)
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

function parseClaudeModelList(raw: string): ModelEntry[] {
  const clean = stripAnsi(raw)
  const models: ModelEntry[] = []

  // Match lines like: "1. Default (recommended)  Use the default model (currently Sonnet 4.6)"
  // or "2. Sonnet (1M context) ✓  Sonnet 4.6 for long sessions · $3/$15 per Mtok"
  for (const line of clean.split('\n')) {
    const match = line.match(/^\s*(\d+)\.\s+(.+?)\s{2,}(.+)$/)
    if (match) {
      const [, _num, rawName, desc] = match
      const name = rawName.replace(/[✓✗●○]/g, '').trim()
      const current = rawName.includes('✓') || rawName.toLowerCase().includes('current')
      models.push({ id: nameToId(name), name, description: desc.trim(), current })
    }
  }
  return models
}

function nameToId(name: string): string {
  const lower = name.toLowerCase()
  if (lower.includes('default')) return 'default'
  if (lower.includes('sonnet') && lower.includes('1m')) return 'sonnet[1m]'
  if (lower.includes('opus') && lower.includes('1m')) return 'opus[1m]'
  if (lower.includes('sonnet')) return 'sonnet'
  if (lower.includes('opus')) return 'opus'
  if (lower.includes('haiku')) return 'haiku'
  return lower.replace(/\s+/g, '-').replace(/[()]/g, '')
}

// ─── 3. Codex: same PTY approach ────────────────────────────────────────────

async function probeCodex(): Promise<ModelEntry[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('timeout')) }, 20_000)

    const proc = spawn('script', ['-q', '/dev/null', 'codex'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TERM: 'dumb', COLUMNS: '200', LINES: '50' },
    })

    let output = ''
    let sentModel = false
    let sentEsc = false

    proc.stdout.on('data', (d: Buffer) => {
      output += d.toString()

      // Codex shows "/model to change" when ready
      if (!sentModel && (output.includes('/model') || output.includes('>'))) {
        sentModel = true
        proc.stdin.write('/model\n')
      }

      // Wait for model selection to render
      if (sentModel && !sentEsc && (output.includes('esc to dismiss') || output.includes('enter to select') || output.includes('Press enter'))) {
        sentEsc = true
        proc.stdin.write('\x1b')
        setTimeout(() => {
          proc.stdin.write('\x03')
          proc.stdin.end()
        }, 500)
      }
    })

    proc.on('close', () => {
      clearTimeout(timer)
      const models = parseCodexModelList(output)
      resolve(models)
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

function parseCodexModelList(raw: string): ModelEntry[] {
  const clean = stripAnsi(raw)
  const models: ModelEntry[] = []

  // Match: "1. gpt-5.3-codex (current)  Latest frontier agentic coding model."
  for (const line of clean.split('\n')) {
    const match = line.match(/^\s*[\s>]*(\d+)\.\s+([\w.-]+)\s*(\(current\))?\s{2,}(.+)$/)
    if (match) {
      const [, _num, id, currentTag, desc] = match
      models.push({ id: id.trim(), name: id.trim(), description: desc.trim(), current: !!currentTag })
    }
  }
  return models
}

// ─── 4. Gemini: try the interactive approach too ─────────────────────────────

async function probeGemini(): Promise<ModelEntry[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('timeout')) }, 20_000)

    const proc = spawn('script', ['-q', '/dev/null', 'gemini'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TERM: 'dumb', COLUMNS: '200', LINES: '50' },
    })

    let output = ''
    let sentModel = false
    let sentEsc = false

    proc.stdout.on('data', (d: Buffer) => {
      output += d.toString()

      if (!sentModel && (output.includes('>') || output.includes('❯'))) {
        sentModel = true
        proc.stdin.write('/model\n')
      }

      if (sentModel && !sentEsc && (output.length > 500 || output.includes('Esc') || output.includes('esc'))) {
        sentEsc = true
        proc.stdin.write('\x1b')
        setTimeout(() => {
          proc.stdin.write('\x03')
          proc.stdin.end()
        }, 500)
      }
    })

    proc.on('close', () => {
      clearTimeout(timer)
      // Try to extract model info from output
      const clean = stripAnsi(output)
      console.log('\n=== Gemini raw output (cleaned) ===')
      console.log(clean.slice(0, 3000))
      resolve([]) // parse manually for now
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60))
  console.log('Model List Probing Experiment')
  console.log('='.repeat(60))

  // 1. OpenClaw
  console.log('\n--- OpenClaw ---')
  try {
    const models = await probeOpenClaw()
    console.log(`Found ${models.length} available models:`)
    models.forEach(m => console.log(`  ${m.current ? '●' : '○'} ${m.id}  ${m.name}  ${m.description}`))
  } catch (e) {
    console.error('OpenClaw probe failed:', e)
  }

  // 2. Claude
  console.log('\n--- Claude (PTY) ---')
  try {
    const models = await probeClaude()
    console.log(`Found ${models.length} models:`)
    models.forEach(m => console.log(`  ${m.current ? '●' : '○'} ${m.id}  ${m.name}  ${m.description}`))
  } catch (e) {
    console.error('Claude probe failed:', e)
  }

  // 3. Codex
  console.log('\n--- Codex (PTY) ---')
  try {
    const models = await probeCodex()
    console.log(`Found ${models.length} models:`)
    models.forEach(m => console.log(`  ${m.current ? '●' : '○'} ${m.id}  ${m.name}  ${m.description}`))
  } catch (e) {
    console.error('Codex probe failed:', e)
  }

  // 4. Gemini
  console.log('\n--- Gemini (PTY) ---')
  try {
    const models = await probeGemini()
    console.log(`Found ${models.length} models:`)
    models.forEach(m => console.log(`  ${m.current ? '●' : '○'} ${m.id}  ${m.name}  ${m.description}`))
  } catch (e) {
    console.error('Gemini probe failed:', e)
  }

  console.log('\n' + '='.repeat(60))
  console.log('Done.')
}

main().catch(console.error)
