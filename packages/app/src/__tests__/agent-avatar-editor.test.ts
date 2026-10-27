// @covers packages/app/src/features/agents/AgentAvatarEditor.tsx
// @covers packages/app/src/features/agents/AgentAvatarDraftEditor.tsx
// @covers packages/app/src/features/agents/screens/AgentNewScreen.tsx
// @covers packages/app/src/features/rooms/components/RoomIdentityAvatar.tsx

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFileSync(resolve(__dirname, relative), 'utf8')

describe('Agent avatar editor', () => {
  it('uploads an independent avatar and can restore live owner-avatar inheritance', () => {
    const editor = read('../features/agents/AgentAvatarEditor.tsx')
    expect(editor).toContain('agentAccountClient.setAgentAvatar(')
    expect(editor).toContain('agentAccountClient.removeAgentAvatar(agent.id)')
    expect(editor).not.toContain('authApi')
    expect(editor).toContain('avatar={agent.avatar}')
    expect(editor).toContain('ownerAvatar={user?.avatar}')
    expect(editor).toContain('onLongPress={agent.avatar ? restoreOwnerAvatar : undefined}')
    expect(editor).not.toContain('name="camera-outline"')
    expect(editor).not.toContain('testID="agent-avatar-use-mine"')
    expect(editor).not.toContain("{t('agents_avatar_use_mine')}</Text>")
    expect(editor).not.toContain('styles.inherited')
  })

  it('shows the owner avatar while creating and uploads an optional draft after creation', () => {
    const draftEditor = read('../features/agents/AgentAvatarDraftEditor.tsx')
    const create = read('../features/agents/screens/AgentNewScreen.tsx')

    expect(draftEditor).toContain('testID="agent-avatar-draft-library"')
    expect(draftEditor).toContain('ownerAvatar={user?.avatar}')
    expect(draftEditor).toContain('avatar={null}')
    expect(draftEditor).toContain('prepareAgentAvatarDraft')
    expect(draftEditor).toContain('onLongPress={value ? restoreOwnerAvatar : undefined}')
    expect(draftEditor).not.toContain('name="camera-outline"')
    expect(draftEditor).not.toContain('testID="agent-avatar-draft-use-mine"')
    expect(create).toContain('<AgentAvatarDraftEditor')
    expect(create).toContain('uploadAgentAvatarDraft(id, avatarDraft)')
    expect(create).toContain('createAgentWithAvatar({')
    expect(create).not.toContain('db.upsertAgent')
  })

})
