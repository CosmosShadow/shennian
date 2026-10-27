// @arch docs/features/agent-workspaces.md
// @test ../../__tests__/desktop-agent-avatar-controller.test.ts
import type { AgentWorkspace } from '@shennian/wire'

type Avatar = AgentWorkspace['avatar']
export function createDesktopAgentAvatarController(deps: {
  isCurrent(): boolean
  pick(signal: AbortSignal): Promise<Blob | null>
  save?(image: Blob): Promise<Avatar>
  remove?(): Promise<void>
  onSaved(avatar: Avatar): void
  onDraft(image: Blob): void
  onError(error: unknown): void
  onBusy(busy: boolean): void
}) {
  let active = false
  let generation = 0
  let pending: AbortController | null = null
  const current = (epoch: number) => active && generation === epoch && deps.isCurrent()
  async function run(action: 'pick-draft' | 'pick-save' | 'remove') {
    if (!active || !deps.isCurrent() || pending) return
    const epoch = generation
    const request = new AbortController()
    pending = request
    deps.onBusy(true)
    try {
      if (action === 'remove') {
        if (!deps.remove) throw new Error('Avatar removal requires an explicit save.')
        await deps.remove()
        if (current(epoch)) deps.onSaved(null)
      } else {
        const image = await deps.pick(request.signal)
        if (!image || !current(epoch)) return
        if (action === 'pick-draft') deps.onDraft(image)
        else {
          if (!deps.save) throw new Error('Avatar upload requires an explicit save.')
          const avatar = await deps.save(image)
          if (current(epoch)) deps.onSaved(avatar)
        }
      }
    } catch (error) {
      if (current(epoch)) deps.onError(error)
    } finally {
      if (pending === request) pending = null
      if (current(epoch)) deps.onBusy(false)
    }
  }
  return {
    start() { active = true; generation += 1 },
    stop() { active = false; generation += 1; pending?.abort(); pending = null },
    chooseDraft: () => run('pick-draft'),
    chooseAndSave: () => run('pick-save'),
    restoreOwner: () => run('remove'),
  }
}
