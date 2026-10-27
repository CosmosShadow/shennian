#!/usr/bin/env npx ts-node
/**
 * Final benchmark: optimal model probing for each agent.
 *
 * Results (from experiments):
 *
 *   Agent    | Method                      | Cold     | Warm (/model in session)
 *   ---------|-----------------------------|---------:|------------------------:
 *   Cursor   | agent --list-models         |    2.2s  | n/a (direct command)
 *   OpenClaw | openclaw models list --json  |    2.0s  | n/a (direct command)
 *   Claude   | Parse cli.js source         |  0.06s   | 0.56s (PTY /model)
 *   Gemini   | Parse models.js source      | 0.0005s  | 1.4s (PTY /model)
 *   Codex    | Read config + call API      |    1.3s  | 2.1s (PTY /model)
 *
 * Strategy: Source parse > Direct command > Config+API > PTY
 */
import { execSync, spawnSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

function findFiles(pattern: string): string[] {
  try {
    return execSync(`ls ${pattern} 2>/dev/null`, { encoding: 'utf-8' }).trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

interface ModelInfo {
  id: string
  name?: string
  description?: string
  available?: boolean
}

interface ProbeResult {
  agent: string
  method: string
  durationMs: number
  models: ModelInfo[]
  error?: string
}

function time<T>(fn: () => T): [T, number] {
  const start = performance.now()
  const result = fn()
  return [result, performance.now() - start]
}

// ═══════════════════════════════════════════════════════════════════
// 1. Cursor (agent --list-models)
// ═══════════════════════════════════════════════════════════════════

function probeCursor(): ProbeResult {
  const [models, ms] = time(() => {
    const out = execSync('agent --list-models 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 15_000,
    })
    return out
      .split('\n')
      .filter((l) => l.includes(' - '))
      .map((l) => {
        const m = l.match(/^(\S+)\s+-\s+(.+?)(?:\s+\((.+)\))?$/)
        if (!m) return null
        return {
          id: m[1].trim(),
          name: m[2].trim(),
          description: m[3]?.trim(),
        }
      })
      .filter(Boolean) as ModelInfo[]
  })

  return { agent: 'cursor', method: 'agent --list-models', durationMs: ms, models }
}

// ═══════════════════════════════════════════════════════════════════
// 2. OpenClaw (openclaw models list --json)
// ═══════════════════════════════════════════════════════════════════

function probeOpenClaw(): ProbeResult {
  const [models, ms] = time(() => {
    const out = execSync('openclaw models list --json 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 15_000,
    })
    const data = JSON.parse(out)
    const allModels = data.models || []
    return allModels
      .filter((m: any) => m.available)
      .map((m: any) => ({
        id: m.key,
        name: m.name,
        available: m.available,
      }))
  })

  return { agent: 'openclaw', method: 'openclaw models list --json', durationMs: ms, models }
}

// ═══════════════════════════════════════════════════════════════════
// 3. Claude (parse cli.js source)
// ═══════════════════════════════════════════════════════════════════

function probeClaude(): ProbeResult {
  const [result, ms] = time(() => {
    const nvmBase = path.join(process.env.HOME!, '.nvm/versions/node')
    const cliPaths = findFiles(`${nvmBase}/*/lib/node_modules/@anthropic-ai/claude-code/cli.js`)
    if (!cliPaths.length) throw new Error('cli.js not found')

    const src = fs.readFileSync(cliPaths[cliPaths.length - 1], 'utf-8')

    // Direct approach: find all firstParty model definitions
    const modelDefs: Array<{ varName: string; modelId: string }> = []
    const defRegex = /(\w+)=\{firstParty:"(claude-[^"]+)"/g
    let m: RegExpExecArray | null
    while ((m = defRegex.exec(src)) !== null) {
      modelDefs.push({ varName: m[1], modelId: m[2] })
    }

    // Extract picker aliases (what /model actually shows)
    const aliasMatch = src.match(/rL9=\[([^\]]+)\]/)
    const aliases = aliasMatch ? (aliasMatch[1].match(/"([^"]+)"/g) || []).map((s) => s.replace(/"/g, '')) : []

    // Extract catalog mapping: {haiku35:VP1, sonnet46:SP1, ...}
    const catalogMatch = src.match(/\{(haiku\d+:\w+[^}]*opus\d+:\w+)\}/)
    const catalog: Record<string, string> = {}
    if (catalogMatch) {
      const entries = catalogMatch[1].match(/(\w+):(\w+)/g) || []
      for (const entry of entries) {
        const [name, varName] = entry.split(':')
        const def = modelDefs.find((d) => d.varName === varName)
        if (def) catalog[name] = def.modelId
      }
    }

    // Build model list: latest version of each alias family
    const latestForAlias: Record<string, { id: string; version: string }> = {}
    for (const [key, modelId] of Object.entries(catalog)) {
      const alias = key.replace(/\d+/g, '')
      if (!latestForAlias[alias] || key > latestForAlias[alias].version) {
        latestForAlias[alias] = { id: modelId, version: key }
      }
    }

    return {
      aliases,
      catalog,
      models: aliases.map((alias) => ({
        id: latestForAlias[alias]?.id || alias,
        name: alias.charAt(0).toUpperCase() + alias.slice(1),
        description: alias === aliases[0] ? 'Default (recommended)' : undefined,
      })),
    }
  })

  return {
    agent: 'claude',
    method: 'Parse cli.js source',
    durationMs: ms,
    models: result.models,
  }
}

// ═══════════════════════════════════════════════════════════════════
// 4. Gemini (parse models.js source)
// ═══════════════════════════════════════════════════════════════════

function probeGemini(): ProbeResult {
  const [models, ms] = time(() => {
    const nvmBase = path.join(process.env.HOME!, '.nvm/versions/node')
    const paths = findFiles(
      `${nvmBase}/*/lib/node_modules/@google/gemini-cli/node_modules/@google/gemini-cli-core/dist/src/config/models.js`
    )
    if (!paths.length) throw new Error('models.js not found')

    const src = fs.readFileSync(paths[paths.length - 1], 'utf-8')

    const modelIds = [...new Set(src.match(/=\s*'(gemini-[^']+)'/g)?.map((m) => m.replace(/^=\s*'|'$/g, '')) || [])]
    const aliases = src.match(/GEMINI_MODEL_ALIAS_\w+\s*=\s*'([^']+)'/g)?.map((m) => {
      const match = m.match(/'([^']+)'/)
      return match ? match[1] : ''
    }).filter(Boolean) || []

    return [
      ...aliases.map((a) => ({ id: a, name: a.charAt(0).toUpperCase() + a.slice(1) })),
      ...modelIds.filter((id) => !id.includes('embedding')).map((id) => ({ id, name: id })),
    ]
  })

  return { agent: 'gemini', method: 'Parse models.js source', durationMs: ms, models }
}

// ═══════════════════════════════════════════════════════════════════
// 5. Codex (read ~/.codex config + call /v1/models API)
// ═══════════════════════════════════════════════════════════════════

function probeCodex(): ProbeResult {
  const [models, ms] = time(() => {
    const home = process.env.HOME!
    const config = fs.readFileSync(path.join(home, '.codex/config.toml'), 'utf-8')
    const auth = JSON.parse(fs.readFileSync(path.join(home, '.codex/auth.json'), 'utf-8'))

    const baseUrlMatch = config.match(/base_url\s*=\s*"([^"]+)"/)
    const baseUrl = baseUrlMatch?.[1] ?? 'https://api.openai.com/v1'
    const apiKey = auth.OPENAI_API_KEY

    const res = execSync(`curl -s -m 5 -H "Authorization: Bearer ${apiKey}" "${baseUrl}/models"`, {
      encoding: 'utf-8',
      timeout: 10_000,
    })

    const data = JSON.parse(res)
    return (data.data || []).map((m: any) => ({
      id: m.id,
      name: m.id,
      description: `Owned by: ${m.owned_by}`,
    }))
  })

  return { agent: 'codex', method: 'Read config + call /v1/models API', durationMs: ms, models }
}

// ═══════════════════════════════════════════════════════════════════
// Run all
// ═══════════════════════════════════════════════════════════════════

function run(name: string, fn: () => ProbeResult) {
  try {
    const result = fn()
    console.log(`\n${'─'.repeat(60)}`)
    console.log(`  ${result.agent.toUpperCase()} | ${result.method}`)
    console.log(`  Duration: ${result.durationMs.toFixed(1)}ms`)
    console.log(`  Models (${result.models.length}):`)
    for (const m of result.models.slice(0, 12)) {
      const desc = m.description ? ` (${m.description})` : ''
      const name = m.name && m.name !== m.id ? ` - ${m.name}` : ''
      console.log(`    ${m.id}${name}${desc}`)
    }
    if (result.models.length > 12) {
      console.log(`    ... +${result.models.length - 12} more`)
    }
    return result
  } catch (e: any) {
    console.log(`\n  ${name}: ERROR - ${e.message}`)
    return null
  }
}

console.log('═'.repeat(60))
console.log('  FINAL MODEL PROBE BENCHMARK')
console.log('═'.repeat(60))

const results: ProbeResult[] = []

const r1 = run('Claude', probeClaude)
if (r1) results.push(r1)

const r2 = run('Gemini', probeGemini)
if (r2) results.push(r2)

const r3 = run('Cursor', probeCursor)
if (r3) results.push(r3)

const r4 = run('OpenClaw', probeOpenClaw)
if (r4) results.push(r4)

const r5 = run('Codex', probeCodex)
if (r5) results.push(r5)

console.log(`\n${'═'.repeat(60)}`)
console.log('  SUMMARY')
console.log('═'.repeat(60))
for (const r of results) {
  const bar = '█'.repeat(Math.max(1, Math.round(r.durationMs / 100)))
  console.log(`  ${r.agent.padEnd(10)} ${r.durationMs.toFixed(0).padStart(6)}ms  ${bar}  ${r.models.length} models`)
}
