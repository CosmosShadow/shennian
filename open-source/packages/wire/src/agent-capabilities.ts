export type AgentCapabilityProvider = 'codex' | 'claude' | 'workbuddy'

export type AgentCapabilityKind = 'skill' | 'plugin_skill'

export type AgentCapabilitySource = 'personal' | 'project' | 'plugin' | 'system'

export type AgentNativeCapability = {
  id: string
  name: string
  description?: string
  kind: AgentCapabilityKind
  source: AgentCapabilitySource
  invocation: string
}

export type AgentCapabilitiesListPayload = {
  supported: boolean
  agentType: string
  capabilities: AgentNativeCapability[]
}
