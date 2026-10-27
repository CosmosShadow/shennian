#!/usr/bin/env node
/* global process */
/**
 * Minimal Shennian custom agent in plain Node.js.
 *
 * Features:
 * - no SDK
 * - /caps + /run
 * - models + defaultModel
 * - resume with local JSON session storage
 * - DeepSeek OpenAI-compatible API
 *
 * Register:
 *   shennian agent add demo-node --command "node /path/to/agent.mjs"
 */

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const command = argv[0]

function emit(event) {
  process.stdout.write(JSON.stringify(event) + '\n')
}

function loadDotEnv(filePath) {
  const values = {}
  if (!fs.existsSync(filePath)) return values
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf('=')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

function getConfig() {
  const fileEnv = loadDotEnv(path.join(__dirname, '.env'))
  const read = (key, fallback = '') => process.env[key] ?? fileEnv[key] ?? fallback
  const primaryModel = read('DEEPSEEK_DEFAULT_MODEL', 'deepseek-chat')
  const reasonerModel = read('DEEPSEEK_REASONER_MODEL', 'deepseek-reasoner')
  const models = [...new Set([primaryModel, reasonerModel])]
  const sessionDir = read('SESSION_DIR', path.join(__dirname, '.sessions'))
  return {
    apiKey: read('DEEPSEEK_API_KEY'),
    baseUrl: read('DEEPSEEK_BASE_URL', 'https://api.deepseek.com'),
    systemPrompt: read('DEEPSEEK_SYSTEM_PROMPT', 'You are a concise custom agent demo for Shennian.'),
    defaultModel: primaryModel,
    models,
    sessionDir: path.isAbsolute(sessionDir) ? sessionDir : path.resolve(__dirname, sessionDir),
  }
}

function parseRunArgs(args) {
  const result = {
    workdir: process.cwd(),
    sessionId: null,
    resumeId: null,
    modelId: null,
    attachments: [],
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--workdir' && args[i + 1]) result.workdir = args[++i]
    else if (arg.startsWith('--workdir=')) result.workdir = arg.split('=', 2)[1]
    else if (arg === '--session' && args[i + 1]) result.sessionId = args[++i]
    else if (arg.startsWith('--session=')) result.sessionId = arg.split('=', 2)[1]
    else if (arg === '--resume' && args[i + 1]) result.resumeId = args[++i]
    else if (arg.startsWith('--resume=')) result.resumeId = arg.split('=', 2)[1]
    else if (arg === '--model' && args[i + 1]) result.modelId = args[++i]
    else if (arg.startsWith('--model=')) result.modelId = arg.split('=', 2)[1]
    else if (arg === '--attachment' && args[i + 1]) result.attachments.push(args[++i])
    else if (arg.startsWith('--attachment=')) result.attachments.push(arg.split('=', 2)[1])
  }

  return result
}

function ensureSessionDir(sessionDir) {
  fs.mkdirSync(sessionDir, { recursive: true })
}

function getSessionFile(sessionDir, sessionId) {
  return path.join(sessionDir, `${sessionId}.json`)
}

function loadSessionMessages(sessionDir, sessionId) {
  const file = getSessionFile(sessionDir, sessionId)
  if (!fs.existsSync(file)) return []
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    return Array.isArray(parsed.messages) ? parsed.messages : []
  } catch {
    return []
  }
}

function saveSessionMessages(sessionDir, sessionId, messages) {
  ensureSessionDir(sessionDir)
  fs.writeFileSync(
    getSessionFile(sessionDir, sessionId),
    JSON.stringify({ messages }, null, 2),
  )
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8').trim()
}

async function callDeepSeek({ apiKey, baseUrl, model, messages }) {
  if (!apiKey) {
    throw new Error('Missing DEEPSEEK_API_KEY. Fill examples/node/.env before running the demo.')
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      temperature: 0.2,
    }),
  })

  if (!response.ok) {
    throw new Error(`DeepSeek request failed with ${response.status}: ${await response.text()}`)
  }

  const data = await response.json()
  const content = data.choices?.[0]?.message?.content
  return {
    text: typeof content === 'string' ? content : JSON.stringify(content ?? ''),
    usage: {
      inputTokens: Number(data.usage?.prompt_tokens ?? 0),
      outputTokens: Number(data.usage?.completion_tokens ?? 0),
    },
  }
}

if (command === '/caps') {
  const config = getConfig()
  emit({
    name: 'DeepSeek Demo (Node)',
    model: config.defaultModel,
    models: config.models,
    defaultModel: config.defaultModel,
    mode: 'spawn',
    resume: true,
    version: '1.0.0',
  })
  process.exit(0)
}

if (command === '/run') {
  const config = getConfig()
  const args = parseRunArgs(argv.slice(1))
  const agentSessionId = args.resumeId || args.sessionId || randomUUID()

  try {
    const userText = await readStdin()
    const history = loadSessionMessages(config.sessionDir, agentSessionId)
    const messages = [
      { role: 'system', content: config.systemPrompt },
      ...history,
      { role: 'user', content: userText },
    ]

    const reply = await callDeepSeek({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: args.modelId || config.defaultModel,
      messages,
    })

    const nextHistory = [
      ...history,
      { role: 'user', content: userText },
      { role: 'assistant', content: reply.text },
    ]
    saveSessionMessages(config.sessionDir, agentSessionId, nextHistory)

    emit({ state: 'delta', text: reply.text })
    emit({ state: 'final', usage: reply.usage, agentSessionId })
  } catch (error) {
    emit({
      state: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
  }
  process.exit(0)
}

process.stderr.write('Usage: agent.mjs /caps | /run --workdir <path> [--resume <id>] [--model <id>]\n')
process.exit(1)
