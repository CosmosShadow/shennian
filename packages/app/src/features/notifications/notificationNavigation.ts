// @arch docs/features/agent-workspaces.md
// @test src/__tests__/push-notification-response-registration.test.ts

import type { NavigationState, PartialState } from '@react-navigation/native'
import type { NianSession } from '@shennian/wire'

export type NotificationNavigationData = {
  roomId?: string
  sessionId?: string
}

type Route = { name: string; params?: Record<string, string>; state?: PartialState<NavigationState> }

const tabRoot = (name: 'home' | 'projects'): Route => ({ name: '(tabs)', state: { routes: [{ name }] } })

export function buildNotificationNavigationState(
  data: NotificationNavigationData,
  session?: Pick<NianSession, 'id' | 'machineId' | 'workDir'>,
): PartialState<NavigationState> | null {
  if (data.roomId) {
    return mainStack([
      tabRoot('home'),
      { name: 'room-workspace', params: { roomId: data.roomId } },
    ])
  }
  if (!data.sessionId) return null

  const routes: Route[] = [tabRoot('projects')]
  if (session?.id === data.sessionId && session.machineId && session.workDir) {
    routes.push({
      name: 'project',
      params: { machineId: session.machineId, workDir: session.workDir },
    })
  }
  routes.push({ name: 'chat/[sessionId]/index', params: { sessionId: data.sessionId } })
  return mainStack(routes)
}

function mainStack(routes: Route[]): PartialState<NavigationState> {
  return {
    index: 0,
    routes: [
      {
        name: '(main)',
        state: { index: routes.length - 1, routes },
      },
    ],
  }
}
