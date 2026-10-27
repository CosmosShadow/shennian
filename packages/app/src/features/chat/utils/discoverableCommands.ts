// @arch docs/features/desktop-action-discoverability.md
// @test src/__tests__/desktop-action-command-bindings.test.ts

export type ChatDiscoverableCommandTargets = {
  refreshSession(): void
  copyCurrentMessage(): void
}

export function createChatDiscoverableCommands(targets: ChatDiscoverableCommandTargets) {
  return {
    refreshSession: targets.refreshSession,
    copyCurrentMessage: targets.copyCurrentMessage,
  }
}
