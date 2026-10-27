// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/codex-conversation-settings.test.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_CODEX_CONVERSATION_SETTINGS, type CodexConversationSettings } from '@shennian/wire'

export function normalizeCodexConversationSettings(input: unknown): CodexConversationSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('codex_settings_invalid')
  const value = input as Record<string, unknown>
  if (Object.keys(value).some((key) => !['codexHome', 'sandbox', 'approvalPolicy', 'networkAccess'].includes(key))) {
    throw new Error('codex_settings_invalid')
  }
  if (typeof value.sandbox !== 'string' || typeof value.approvalPolicy !== 'string' ||
      !['read-only', 'workspace-write', 'danger-full-access'].includes(value.sandbox) ||
      !['on-request', 'never'].includes(value.approvalPolicy) ||
      typeof value.networkAccess !== 'boolean' ||
      (value.codexHome !== null && typeof value.codexHome !== 'string')) throw new Error('codex_settings_invalid')
  let codexHome = typeof value.codexHome === 'string' ? value.codexHome.trim() || null : null
  if (codexHome) {
    if (codexHome.length > 1024 || /[\x00-\x1f]/.test(codexHome)) throw new Error('codex_home_invalid')
    if (codexHome.startsWith('~/')) codexHome = path.join(os.homedir(), codexHome.slice(2))
    if (!path.isAbsolute(codexHome)) throw new Error('codex_home_absolute_required')
    try {
      codexHome = fs.realpathSync(codexHome)
      if (!fs.statSync(codexHome).isDirectory()) throw new Error('not_directory')
    } catch { throw new Error('codex_home_directory_required') }
  }
  return { codexHome, sandbox: value.sandbox, approvalPolicy: value.approvalPolicy,
    networkAccess: value.networkAccess } as CodexConversationSettings
}

export function codexThreadPermissionParams(settings?: CodexConversationSettings) {
  const value = settings ?? DEFAULT_CODEX_CONVERSATION_SETTINGS
  return {
    approvalPolicy: value.approvalPolicy === 'on-request' ? 'on-request' : 'never',
    sandbox: value.sandbox,
    config: {
      'features.default_mode_request_user_input': true,
      ...(value.sandbox === 'workspace-write' ? { 'sandbox_workspace_write.network_access': value.networkAccess } : {}),
    },
  }
}

export function codexTurnPermissionParams(settings: CodexConversationSettings | undefined, workDir: string) {
  const value = settings ?? DEFAULT_CODEX_CONVERSATION_SETTINGS
  return {
    approvalPolicy: value.approvalPolicy,
    sandboxPolicy: value.sandbox === 'read-only' ? { type: 'readOnly' }
      : value.sandbox === 'workspace-write'
        ? { type: 'workspaceWrite', writableRoots: [workDir], networkAccess: value.networkAccess,
            excludeTmpdirEnvVar: true, excludeSlashTmp: true }
        : { type: 'dangerFullAccess' },
  }
}

export function hasNonDefaultCodexSettings(settings?: CodexConversationSettings): boolean {
  return Boolean(settings && (settings.codexHome || settings.sandbox !== 'danger-full-access' ||
    settings.approvalPolicy !== 'never'))
}
