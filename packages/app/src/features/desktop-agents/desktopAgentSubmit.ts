// @arch docs/features/agent-workspaces.md#创建前真实可用性验证
// @test ../../__tests__/desktop-agent-submit.test.ts
import { desktopAgentDraftSignature, type DesktopAgentWorkspaceDraft } from './desktopAgentWorkspaceDraft'
import type { DesktopAgentSaveResult } from './desktopAgentSave'

export type DesktopAgentAvatarChange = { draft: Blob | null; restoreOwner: boolean }
export type DesktopAgentSubmitOutcome =
  | { status: 'stale' }
  | { status: 'avatar_failed'; result: DesktopAgentSaveResult }
  | { status: 'saved'; result: DesktopAgentSaveResult }

export function hasDesktopAgentAvatarChange(avatar: DesktopAgentAvatarChange): boolean {
  return Boolean(avatar.draft || avatar.restoreOwner)
}

/**
 * Editing an existing agent with only an avatar change never enters the configuration
 * transaction (`agent.editor.save`), so it can never reach runtime validation. A config
 * commit that is still being retried keeps its own transaction semantics.
 */
export function isDesktopAgentAvatarOnlySubmit(input: {
  agentId?: string
  draft: DesktopAgentWorkspaceDraft
  savedSignature: string
  avatar: DesktopAgentAvatarChange
  committed: DesktopAgentSaveResult | null
  projectionPending: boolean
}): boolean {
  return Boolean(input.agentId)
    && hasDesktopAgentAvatarChange(input.avatar)
    && !input.committed
    && !input.projectionPending
    && desktopAgentDraftSignature(input.draft) === input.savedSignature
}

export async function runDesktopAgentSubmit(input: {
  agentId?: string
  draft: DesktopAgentWorkspaceDraft
  savedSignature: string
  avatar: DesktopAgentAvatarChange
  /** Result of an already committed configuration save whose follow-up (projection/avatar) is being retried. */
  committed: DesktopAgentSaveResult | null
  projectionPending: boolean
  isCurrent(): boolean
  commitConfig(): Promise<DesktopAgentSaveResult | null>
  /** Remember/project a committed config. Returns false when the screen is no longer current. */
  onConfigCommitted(result: DesktopAgentSaveResult): Promise<boolean>
  uploadAvatar(agentId: string, image: Blob): Promise<unknown>
  removeAvatar(agentId: string): Promise<unknown>
  reconcile(): Promise<unknown>
}): Promise<DesktopAgentSubmitOutcome> {
  let result = input.committed
  if (!result && isDesktopAgentAvatarOnlySubmit(input)) {
    result = { agentId: input.agentId!, requiresRestart: false }
  } else {
    result ??= await input.commitConfig()
    if (!result) return { status: 'stale' }
    if (!(await input.onConfigCommitted(result))) return { status: 'stale' }
  }
  if (!hasDesktopAgentAvatarChange(input.avatar)) return { status: 'saved', result }
  let avatarFailed = false
  try {
    if (input.avatar.draft) await input.uploadAvatar(result.agentId, input.avatar.draft)
    else await input.removeAvatar(result.agentId)
  } catch {
    avatarFailed = true
  }
  if (!input.isCurrent()) return { status: 'stale' }
  // A failed avatar keeps any committed config result so a retry only repeats the avatar action.
  if (avatarFailed) return { status: 'avatar_failed', result }
  try {
    await input.reconcile()
  } catch {
    /* Relay revision or the next focus will retry the read. */
  }
  return input.isCurrent() ? { status: 'saved', result } : { status: 'stale' }
}
