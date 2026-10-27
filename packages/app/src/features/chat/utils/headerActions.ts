// @arch docs/architecture/app/modular-features.md#聊天-feature
// @test packages/app/src/__tests__/chat-header-actions.test.ts

export type ChatHeaderActionId = 'details'

export function getChatHeaderActionIds(sessionId?: string): ChatHeaderActionId[] {
  return sessionId?.startsWith('sess_worker_') ? [] : ['details']
}
