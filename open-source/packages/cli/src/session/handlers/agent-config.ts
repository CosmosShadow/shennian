// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/agent-config-status.test.ts
// @test src/__tests__/agent-config-handler.test.ts

import { mkdir } from 'node:fs/promises'
import type { AgentType, ReqFrame } from '@shennian/wire'
import { createAgent, type AgentEvent } from '../../agents/adapter.js'
import {
  buildManagedAgentEnv,
  deleteManagedAgentProviderConfig,
  getAgentConfigSummary,
  upsertManagedAgentProviderConfig,
} from '../../agents/config-status.js'
import { resolveShennianPath } from '../../config/index.js'
import type { SessionManagerRuntime } from '../types.js'
import { handleAgentsRefresh } from './agents.js'

type ConfigurableAgent = 'codex' | 'claude'
const AGENT_TEST_TIMEOUT_MS = 30_000
const AGENT_TEST_PROMPT = '这是一次神念连接测试。请只回复 OK，不要解释。'
const AGENT_TEST_WORK_DIR = resolveShennianPath('tmp', 'agent-config-test')

function normalizeAgent(value: unknown): ConfigurableAgent {
  if (value === 'codex' || value === 'claude') return value
  throw new Error('Only Codex, Claude Code, and Nian provider config are supported')
}

export async function handleAgentConfigGet(runtime: SessionManagerRuntime, req: ReqFrame): Promise<void> {
  const agent = normalizeAgent(req.params.agent)
  runtime.client.sendRes({
    type: 'res',
    id: req.id,
    ok: true,
    payload: { agent, config: getAgentConfigSummary(agent) },
  })
}

export async function handleAgentConfigUpsert(runtime: SessionManagerRuntime, req: ReqFrame): Promise<void> {
  const agent = normalizeAgent(req.params.agent)
  const baseUrl = typeof req.params.baseUrl === 'string' ? req.params.baseUrl.trim() : undefined
  const token = typeof req.params.token === 'string' ? req.params.token.trim() : undefined

  if (!baseUrl && !token) throw new Error('Base URL or token is required')

  upsertManagedAgentProviderConfig({ agent, baseUrl, token })
  runtime.client.sendRes({
    type: 'res',
    id: req.id,
    ok: true,
    payload: { agent, config: getAgentConfigSummary(agent) },
  })
  await broadcastAgents(runtime)
}

export async function handleAgentConfigClear(runtime: SessionManagerRuntime, req: ReqFrame): Promise<void> {
  const agent = normalizeAgent(req.params.agent)
  deleteManagedAgentProviderConfig(agent)
  runtime.client.sendRes({
    type: 'res',
    id: req.id,
    ok: true,
    payload: { agent, config: getAgentConfigSummary(agent) },
  })
  await broadcastAgents(runtime)
}

export async function handleAgentConfigTest(runtime: SessionManagerRuntime, req: ReqFrame): Promise<void> {
  const agent = normalizeAgent(req.params.agent)
  const summary = getAgentConfigSummary(agent)
  try {
    const result = await runAgentConfigTest(agent)
    runtime.client.sendRes({
      type: 'res',
      id: req.id,
      ok: true,
      payload: { agent, config: getAgentConfigSummary(agent), test: result },
    })
  } catch (err) {
    runtime.client.sendRes({
      type: 'res',
      id: req.id,
      ok: false,
      payload: { agent, config: summary },
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

async function runAgentConfigTest(agent: ConfigurableAgent): Promise<{ mode: 'agent-run'; reply?: string }> {
  const adapter = createAgent(agent)
  if (!adapter) throw new Error(`Unsupported agent: ${agent}`)

  const sessionId = `agent-test-${agent}-${Date.now()}`
  await mkdir(AGENT_TEST_WORK_DIR, { recursive: true })
  let settled = false
  let failWait: (error: Error) => void = () => {}

  const waitForReply = new Promise<{ mode: 'agent-run'; reply?: string }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('Agent test timed out after 30 seconds'))
    }, AGENT_TEST_TIMEOUT_MS)

    function finish(result: { mode: 'agent-run'; reply?: string }) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(result)
    }

    function fail(error: Error) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    }
    failWait = fail

    adapter.on('agentEvent', (event: AgentEvent) => {
      if (event.state === 'delta' && event.text && !event.thinking) {
        finish({ mode: 'agent-run', reply: event.text.slice(0, 120) })
        return
      }
      if (event.state === 'final') {
        finish({ mode: 'agent-run' })
        return
      }
      if (event.state === 'error') {
        fail(new Error(event.message || 'Agent test failed'))
      }
    })
    adapter.on('error', fail)
  })

  try {
    adapter.configure?.({
      sessionId,
      env: getManagedEnvForAgent(agent),
    })
    await adapter.start(sessionId, AGENT_TEST_WORK_DIR, null)
    const sendPromise = adapter.send(AGENT_TEST_PROMPT).catch((err) => {
      failWait(err instanceof Error ? err : new Error(String(err)))
    })
    return await Promise.race([waitForReply, sendPromise.then(() => waitForReply)])
  } finally {
    adapter.removeAllListeners()
    await adapter.stop().catch(() => {})
  }
}

async function broadcastAgents(runtime: SessionManagerRuntime): Promise<void> {
  const req: ReqFrame = {
    type: 'req',
    id: `agent-config-refresh-${Date.now()}`,
    method: 'agents.refresh',
    params: {},
  }
  await handleAgentsRefresh(runtime, req)
}

export function getManagedEnvForAgent(agentType: AgentType): NodeJS.ProcessEnv {
  // Re-export point kept here for session handlers to avoid reaching into storage internals.
  // The implementation lives in agents/config-status.ts.
  return agentType === 'codex' || agentType === 'claude'
    ? buildManagedAgentEnv(agentType)
    : {}
}
