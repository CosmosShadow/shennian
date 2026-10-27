// @arch docs/features/agent-voice-configuration.md
// @test src/__tests__/agent-voice-configuration.test.ts

export type AgentVoiceTextDraft = {
  displayName: string
  description: string
  systemPrompt: string
}

export type AgentVoiceTextPatch = Partial<AgentVoiceTextDraft>

export type AgentVoiceConfigurationResponse = {
  transcript: string
  patch: AgentVoiceTextPatch
  changedFields: Array<keyof AgentVoiceTextDraft>
  summary: string
  model: string
}

export function applyAgentVoicePatch(options: {
  baseline: AgentVoiceTextDraft
  current: AgentVoiceTextDraft
  patch: AgentVoiceTextPatch
}): {
  next: AgentVoiceTextDraft
  appliedFields: Array<keyof AgentVoiceTextDraft>
  conflictedFields: Array<keyof AgentVoiceTextDraft>
} {
  const fields = ['displayName', 'description', 'systemPrompt'] as const
  const next = { ...options.current }
  const appliedFields: Array<keyof AgentVoiceTextDraft> = []
  const conflictedFields: Array<keyof AgentVoiceTextDraft> = []

  for (const field of fields) {
    const value = options.patch[field]
    if (typeof value !== 'string' || value === options.current[field]) continue
    if (options.current[field] !== options.baseline[field]) {
      conflictedFields.push(field)
      continue
    }
    next[field] = value
    appliedFields.push(field)
  }

  return { next, appliedFields, conflictedFields }
}
