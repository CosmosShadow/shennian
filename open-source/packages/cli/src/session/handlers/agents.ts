// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/model-switching.test.ts

import type { AgentInfo, AgentType, ReqFrame } from '@shennian/wire'
import { SERVERS } from '../../region.js'
import { loadConfig } from '../../config/index.js'
import { detectAgents } from '../../agents/detect.js'
import { refreshAgentInfos } from '../../agents/model-registry.js'
import { resetCommandSpecCache } from '../../agents/command-spec.js'
import { clearAcpCapabilityCache } from '../../agents/acp/capability-cache.js'
import type { SessionManagerRuntime } from '../types.js'

const lastPublishedAgentSnapshot = new WeakMap<object, string>()

/** Shared discovery path for the App refresh and local CLI. Never sends a model prompt. */
export async function scanMachineAgents(refresh = false, agentType?: AgentType) {
  if (refresh) {
    resetCommandSpecCache()
    clearAcpCapabilityCache()
  }
  const config = loadConfig()
  const options = {
    serverUrl: config.serverUrl ?? SERVERS.cn.url,
    authToken: config.machineToken ?? config.accessToken,
  }
  const detectedAgents = await detectAgents({ ...options, ...(agentType ? { agentType } : {}) })
  const agents = detectedAgents.length ? await refreshAgentInfos(detectedAgents, options) : [] as AgentInfo[]
  return { detectedAgents, agents, agentList: detectedAgents.map((agent) => agent.type) }
}

export async function refreshMachineAgents(
  runtime: SessionManagerRuntime,
  req?: ReqFrame,
): Promise<void> {
  try {
    const { agentList, agents } = await scanMachineAgents()
    const payload = { agentList, agents }
    if (req) {
      runtime.client.sendRes({
        type: 'res',
        id: req.id,
        ok: true,
        payload,
      })
    }
    const snapshot = JSON.stringify(payload)
    if (lastPublishedAgentSnapshot.get(runtime.client) !== snapshot) {
      lastPublishedAgentSnapshot.set(runtime.client, snapshot)
      runtime.client.sendEvent({
        type: 'event',
        event: 'machine.agents',
        payload,
      })
    }
  } catch (err) {
    if (!req) return
    runtime.client.sendRes({
      type: 'res',
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export async function handleModelsRefresh(runtime: SessionManagerRuntime, req: ReqFrame): Promise<void> {
  await refreshMachineAgents(runtime, req)
}

export async function handleAgentsRefresh(runtime: SessionManagerRuntime, req: ReqFrame): Promise<void> {
  resetCommandSpecCache()
  clearAcpCapabilityCache()
  runtime.reloadCustomAgents()
  await refreshMachineAgents(runtime, req)
}
