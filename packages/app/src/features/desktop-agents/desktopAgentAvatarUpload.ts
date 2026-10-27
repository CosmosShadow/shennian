// @arch docs/features/agent-workspaces.md
// @test ../../__tests__/desktop-agent-avatar-controller.test.ts
import type { AgentWorkspace } from '@shennian/wire'
import { useAuthStore } from '../../config/auth'

/** Bind local encoding to the same account lifetime as the picker, before main receives a command. */
export async function uploadDesktopAgentAvatar(agentId: string, image: Blob, isCurrent: () => boolean): Promise<NonNullable<AgentWorkspace['avatar']>> {
  const accountId = useAuthStore.getState().user?.id
  let changed = false
  const unsubscribe = useAuthStore.subscribe((state, previous) => { if (state.user?.id !== previous.user?.id) changed = true })
  const assertCurrent = () => { if (!accountId || changed || !isCurrent() || useAuthStore.getState().user?.id !== accountId) throw new Error('agent_account_changed') }
  try {
    assertCurrent()
    const bytes = new Uint8Array(await image.arrayBuffer())
    assertCurrent()
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 16384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384))
    const result = await requireDesktopAgentAccountBridge().execute({ requestId: crypto.randomUUID(), operation: 'agent.avatar.set', input: { agentId, contentType: 'image/jpeg', base64: btoa(binary) } })
    assertCurrent()
    if (!result.ok) throw new Error(result.error?.message ?? 'Avatar upload failed')
    const avatar = result.value?.avatar
    if (!avatar || typeof avatar.version !== 'string' || typeof avatar.mediumUrl !== 'string') throw new Error('Invalid avatar response')
    return avatar
  } finally { unsubscribe() }
}

export async function removeDesktopAgentAvatar(agentId: string): Promise<void> {
  const result = await requireDesktopAgentAccountBridge().execute({
    requestId: crypto.randomUUID(),
    operation: 'agent.avatar.remove',
    input: { agentId },
  })
  if (!result.ok) throw new Error(result.error?.message ?? 'Avatar removal failed')
}

type DesktopAgentAvatarResult = {
  ok: boolean
  value?: { avatar?: AgentWorkspace['avatar'] }
  error?: { message: string }
}
type DesktopAgentAccountBridge = { execute(input: unknown): Promise<DesktopAgentAvatarResult> }
function requireDesktopAgentAccountBridge(): DesktopAgentAccountBridge {
  const bridge = (globalThis as typeof globalThis & {
    shennianDesktop?: { account?: DesktopAgentAccountBridge }
  }).shennianDesktop?.account
  if (!bridge || typeof bridge.execute !== 'function') {
    throw new Error('Desktop Agent account bridge is unavailable')
  }
  return bridge
}
