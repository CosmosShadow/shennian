// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test ../../__tests__/desktop-profile-actions.test.ts
export type DesktopProfileActionState = { busy: string | null; error: string | null }

type DesktopProfileCommandPort = {
  updateProfile(name: string): Promise<unknown>
  setAvatar(image: Blob, contentType: 'image/jpeg' | 'image/png' | 'image/webp'): Promise<unknown>
  deleteAccount(operationId: string): Promise<void>
  revokeDevice(deviceId: string): Promise<void>
}

/** Account-owned command lifecycle. Replies never write renderer auth or caches. */
export function createDesktopProfileActions(deps: {
  accountId: string
  isCurrent: () => boolean
  client: DesktopProfileCommandPort
  logout: (accountId: string) => Promise<void>
  onState: (state: DesktopProfileActionState) => void
  operationId: () => string
}) {
  let active = true
  let generation = 0
  let busy: string | null = null
  let deletionId: string | null = null
  const current = () => active && deps.isCurrent()
  async function run(name: string, action: () => Promise<unknown>): Promise<boolean> {
    if (!current() || busy) return false
    const requestGeneration = generation
    const requestCurrent = () => current() && generation === requestGeneration
    busy = name
    deps.onState({ busy, error: null })
    let failure: string | null = null
    try {
      await action()
      return requestCurrent()
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
      return false
    } finally {
      if (generation === requestGeneration) busy = null
      if (requestCurrent()) deps.onState({ busy: null, error: failure })
    }
  }
  return {
    start() { active = true; generation += 1; busy = null },
    stop() { active = false; generation += 1; busy = null },
    saveNickname: (name: string) => run('nickname', () => deps.client.updateProfile(name)),
    saveAvatar: (image: Blob) => run('avatar', () => deps.client.setAvatar(image, 'image/jpeg')),
    revokeDevice: (deviceId: string) => run(`revoke:${deviceId}`, () => deps.client.revokeDevice(deviceId)),
    logout: () => run('logout', () => deps.logout(deps.accountId)),
    deleteAccount: () => run('delete', async () => {
      const deletionGeneration = generation
      deletionId ??= deps.operationId()
      await deps.client.deleteAccount(deletionId)
      if (current() && generation === deletionGeneration) {
        await deps.logout(deps.accountId)
        if (generation === deletionGeneration) deletionId = null
      }
    }),
  }
}
