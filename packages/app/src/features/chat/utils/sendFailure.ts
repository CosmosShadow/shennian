// @arch docs/architecture/app/chat-draft-storage.md
// @test src/__tests__/chat-failed-send-draft.test.ts

/** Do not surface raw transport/provider errors, which may contain private paths. */
export function chatSendFailureKey(error: unknown): string {
  const reason = error instanceof Error ? error.message : ''
  if (/managed_agent_direct_requires_cli_upgrade|steward_requires_cli_upgrade/.test(reason)) {
    return 'chat_send_requires_cli_upgrade'
  }
  if (/managed_agent_context_unavailable|managed_room_binding_unavailable/.test(reason)) {
    return 'chat_send_agent_context_unavailable'
  }
  return 'chat_send_rejected_draft_restored'
}
