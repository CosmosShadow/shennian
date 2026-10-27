// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/daemon-control-ipc.test.ts
import { isAvailableAgentType, type AgentInfo } from '@shennian/wire'
import type { DaemonStatus } from '../commands/daemon.js'
import type { AgentWorkspaceValidationInput, AgentWorkspaceValidationResult } from '../session/handlers/agent-workspace-validation.js'
import type { DaemonIpcHandler } from './server.js'
import { DaemonIpcError } from './protocol.js'
import type { UnavailableAcpAgent } from '../agents/acp/discovery.js'

type DiscoveredAi = AgentInfo & { runtimePlatform?: string; runtimeIsWsl?: boolean }

export function createAgentReadinessHandlers(input: {
  getStatus: () => DaemonStatus
  getSnapshot: () => DiscoveredAi[]
  discover: (agentType?: string) => Promise<DiscoveredAi[]>
  /** Known tools found on PATH whose ACP handshake failed in the latest scan. */
  getUnavailable?: () => UnavailableAcpAgent[]
  validate: (params: AgentWorkspaceValidationInput) => Promise<AgentWorkspaceValidationResult>
}): Record<string, DaemonIpcHandler> {
  let testing = false
  const assertRunning = () => {
    const status = input.getStatus()
    if (status.remoteAccessDisabled) throw new DaemonIpcError('daemon_paused', 'Shennian is paused; resume it only when requested.')
    if (!status.running) throw new DaemonIpcError('daemon_unavailable', 'Shennian is not running.')
  }
  return {
    'agent.discover': async (params) => {
      assertRunning()
      const requestedType = params && typeof params === 'object' && !Array.isArray(params)
        && typeof params.agentType === 'string' ? params.agentType : null
      const compact = Boolean(params && typeof params === 'object' && !Array.isArray(params) && params.compact === true)
      const refresh = Boolean(params && typeof params === 'object' && !Array.isArray(params) && params.refresh === true)
      const snapshot = refresh ? await input.discover(requestedType ?? undefined) : input.getSnapshot()
      const agents = snapshot.filter((agent) => !requestedType || agent.type === requestedType)
      const unavailable = (input.getUnavailable?.() ?? [])
        .filter((item) => !requestedType || item.type === requestedType)
      return { modelTested: false, compact, refreshed: refresh, unavailable, agents: agents.map((agent) => {
        const defaultModel = agent.models.find((model) => model.isDefault)
        const orderedModels = defaultModel
          ? [defaultModel, ...agent.models.filter((model) => model.id !== defaultModel.id)]
          : agent.models
        const models = orderedModels
          .map((model) => ({ id: model.id, name: model.name, isDefault: model.isDefault === true }))
        return {
          type: agent.type,
          name: agent.display?.name ?? agent.type,
          authState: agent.authState ?? 'unknown',
          ...(agent.runtime?.cliVersion ? { version: agent.runtime.cliVersion } : {}),
          ...(agent.runtime?.compatibility ? { compatibility: agent.runtime.compatibility } : {}),
          ...(agent.runtimePlatform ? { runtimePlatform: agent.runtimePlatform } : {}),
          ...(agent.runtimeIsWsl !== undefined ? { runtimeIsWsl: agent.runtimeIsWsl } : {}),
          supportsStandardSession: agent.supportsStandardSession === true,
          ...(agent.supportsAgent !== undefined ? { supportsAgent: agent.supportsAgent } : {}),
          ...(agent.supportedAgentExecutionModes
            ? { supportedAgentExecutionModes: agent.supportedAgentExecutionModes }
            : {}),
          supportsManagedAgent: agent.supportsManagedAgent === true,
          supportsManagedNativeFull: agent.supportsManagedNativeFull === true,
          supportsRoomTools: agent.supportsRoomTools === true,
          supportsWorker: agent.supportsWorker === true,
          supportsManagerMode: agent.supportsManagerMode === true,
          supportsExternalWorkerTarget: agent.supportsExternalWorkerTarget === true,
          modelCount: agent.models.length,
          defaultModelId: defaultModel?.id ?? null,
          ...(compact ? {} : {
            models,
            modelsTruncated: false,
          }),
        }
      }) }
    },
    'agent.check': async (params) => {
      assertRunning()
      if (!params || typeof params !== 'object' || Array.isArray(params)
        || typeof params.agentType !== 'string' || !isAvailableAgentType(params.agentType)
        || typeof params.workDir !== 'string' || !params.workDir.trim()
        || (params.modelId != null && typeof params.modelId !== 'string')) {
        throw new DaemonIpcError('agent_validation_invalid_configuration', 'Select an AI and its absolute working directory.')
      }
      if (testing) throw new DaemonIpcError('agent_check_in_progress', 'An AI reply check is already running.')
      testing = true
      try {
        const result = await input.validate({ runtimeAdapter: params.agentType,
          workDir: params.workDir, modelId: params.modelId ?? null, sessionMode: 'standard' })
        if (!result.ok) throw new DaemonIpcError(result.errorCode, result.errorCode)
        return { ready: true, agentType: params.agentType, modelId: params.modelId ?? null, scope: 'hello_reply' }
      } finally { testing = false }
    },
  }
}
