// @arch docs/features/desktop-personal-session-navigation.md
// @test ../../__tests__/desktop-session-launch.test.ts
import type { NianSession } from '@shennian/wire'
import type { MachineSessionCreateInput } from '../machines/machineAccountClient.types'

export type DesktopSessionLaunchInput = Omit<MachineSessionCreateInput, 'title'>

export function readDesktopCreatedSession(value: unknown): NianSession {
  const session = (value as { session?: NianSession } | null)?.session
  if (!session || typeof session !== 'object' || Array.isArray(session) ||
      ['id', 'machineId', 'workDir', 'userId'].some(key => typeof session[key as keyof NianSession] !== 'string' || !session[key as keyof NianSession]) ||
      session.agentIdentityId != null) throw new Error('desktop_session_invalid_result')
  return session
}

/** Cancelling a form discards its callbacks, not an already dispatched remote operation. */
export function createDesktopLaunchSubmission(options: {
  isCurrent(): boolean
  create(input: DesktopSessionLaunchInput): Promise<NianSession>
  onCommitted(session: NianSession, input: DesktopSessionLaunchInput): void
}) {
  let active = true
  let pending = false
  return {
    dispose() { active = false },
    async submit(input: DesktopSessionLaunchInput): Promise<boolean> {
      if (!active || pending || !options.isCurrent()) return false
      pending = true
      try {
        const session = await options.create(input)
        if (!active || !options.isCurrent()) return false
        options.onCommitted(session, input)
        return true
      } catch (error) {
        if (!active || !options.isCurrent()) return false
        throw error
      } finally { pending = false }
    },
  }
}
