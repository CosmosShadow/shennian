// @arch docs/features/agent-workspaces.md#创建前真实可用性验证
// @test src/__tests__/agent-workspace-draft.test.ts

export function agentValidationMessageKey(
  error: unknown,
  fallback = 'agents_create_failed',
): string {
  const message = validationErrorText(error)
  if (/unknown method|agent\.workspace\.validate/i.test(message)) {
    return 'agents_validation_upgrade_required'
  }
  const known: Record<string, string> = {
    agent_validation_server_upgrade_required: 'agents_validation_server_upgrade_required',
    agent_validation_cleanup_failed: 'agents_validation_cleanup_failed',
    agent_validation_invalid_configuration: 'agents_validation_invalid_configuration',
    agent_validation_workdir_not_found: 'agents_validation_workdir_not_found',
    agent_validation_workdir_not_directory: 'agents_validation_workdir_not_directory',
    agent_validation_workdir_unavailable: 'agents_validation_workdir_unavailable',
    agent_validation_workdir_invalid: 'agents_validation_workdir_invalid',
    agent_validation_runtime_unavailable: 'agents_validation_runtime_unavailable',
    agent_validation_runtime_auth_required: 'agents_validation_runtime_auth_required',
    agent_validation_manager_unavailable: 'agents_validation_manager_unavailable',
    agent_validation_model_unavailable: 'agents_validation_model_unavailable',
    agent_validation_quota_exceeded: 'agents_validation_quota_exceeded',
    agent_validation_network_failed: 'agents_validation_network_failed',
    agent_validation_start_failed: 'agents_validation_start_failed',
    agent_validation_response_timeout: 'agents_validation_response_timeout',
    agent_validation_response_mismatch: 'agents_validation_response_mismatch',
    agent_validation_response_failed: 'agents_validation_response_failed',
  }
  const code = Object.keys(known).find((candidate) => message.includes(candidate))
  if (code) return known[code]!
  if (/not connected|no connection|timed out|disconnected|not authenticated/i.test(message)) {
    return 'agents_validation_machine_unreachable'
  }
  return fallback
}

function validationErrorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
