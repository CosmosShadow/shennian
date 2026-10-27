// @arch open-source/docs/wire.md
// @test open-source/packages/cli/src/__tests__/codex-conversation-settings.test.ts

/** Explicit personal-session options; never interpreted as a shell command. */
export type CodexConversationSettings = {
  codexHome: string | null
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access'
  approvalPolicy: 'on-request' | 'never'
  networkAccess: boolean
}

export const DEFAULT_CODEX_CONVERSATION_SETTINGS: CodexConversationSettings = {
  codexHome: null,
  sandbox: 'danger-full-access',
  approvalPolicy: 'never',
  networkAccess: false,
}

export type CodexConversationSettingsSnapshot = {
  settings: CodexConversationSettings
  homeLocked: boolean
  busy: boolean
}
