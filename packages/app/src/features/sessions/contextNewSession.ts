// @arch docs/architecture/session-organization.md
// @arch docs/features/desktop-personal-session-navigation.md
// @test packages/app/src/__tests__/context-new-session.test.ts

import type { AgentType, NianSession } from '@shennian/wire'

export type ContextNewSessionPayload = {
  machineId: string
  agentType: AgentType
  workDir: string
  modelId: string
}

export type ContextNewSessionPlan =
  | { kind: 'create'; sourceSession: NianSession; payload: ContextNewSessionPayload }
  | { kind: 'openFullFlow'; reason: 'no-current-session' | 'missing-context' }
  | { kind: 'blocked-by-desktop-policy' }
  | { kind: 'blocked-by-modal' }

function clean(value: string | null | undefined): string {
  return value?.trim() ?? ''
}

export function findCurrentSession(pathname: string, sessions: NianSession[]): NianSession | null {
  const chatMatch = pathname.match(/\/chat\/([^/?#]+)/)
  const sessionId = chatMatch?.[1]
  if (sessionId) {
    return sessions.find((session) => session.id === decodeURIComponent(sessionId)) ?? null
  }
  return sessions.find((session) => pathname.includes(session.id)) ?? null
}

export function planContextNewSession(options: {
  pathname: string
  sessions: NianSession[]
  hasOpenModal: boolean
  desktopControlSurface?: boolean
}): ContextNewSessionPlan {
  if (options.desktopControlSurface) return { kind: 'blocked-by-desktop-policy' }
  if (options.hasOpenModal) return { kind: 'blocked-by-modal' }

  const currentSession = findCurrentSession(options.pathname, options.sessions)
  if (!currentSession) return { kind: 'openFullFlow', reason: 'no-current-session' }

  const machineId = clean(currentSession.machineId)
  const workDir = clean(currentSession.workDir)
  const modelId = clean(currentSession.modelId)

  if (!machineId || !workDir || !modelId) {
    return { kind: 'openFullFlow', reason: 'missing-context' }
  }

  return {
    kind: 'create',
    sourceSession: currentSession,
    payload: {
      machineId,
      agentType: currentSession.agentType,
      workDir,
      modelId,
    },
  }
}

export async function handleContextNewSessionShortcut(options: {
  pathname: string
  sessions: NianSession[]
  hasOpenModal: boolean
  desktopControlSurface?: boolean
  createSession: (payload: ContextNewSessionPayload) => Promise<NianSession>
  openFullFlow: () => void
  persistSession?: (session: NianSession) => Promise<void> | void
  upsertSession: (session: NianSession) => void
  navigateToSession: (sessionId: string) => void
}): Promise<ContextNewSessionPlan> {
  const plan = planContextNewSession(options)

  if (plan.kind === 'blocked-by-modal' || plan.kind === 'blocked-by-desktop-policy') return plan

  if (plan.kind === 'openFullFlow') {
    options.openFullFlow()
    return plan
  }

  const session = await options.createSession(plan.payload)
  const nextSession = {
    ...session,
    machineName: session.machineName?.trim() ? session.machineName : plan.sourceSession.machineName,
  }

  await options.persistSession?.(nextSession)
  options.upsertSession(nextSession)
  options.navigateToSession(nextSession.id)
  return plan
}
