// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test packages/app/src/__tests__/session-account-client.test.ts
import type { NianSession } from '@shennian/wire'
import { authApi } from '../../config/api'
import type { SessionAccountClient } from './sessionAccountClient.types'

export const sessionAccountClient: SessionAccountClient = {
  async getSession(sessionId) {
    return (await authApi<{ session: NianSession }>(`/sessions/index/${encodeURIComponent(sessionId)}`)).session
  },
  async createSession(input) {
    return (await authApi<{ session: NianSession }>('/sessions', {
      method: 'POST', body: JSON.stringify(input),
    })).session
  },
  async updateSession(sessionId, changes) {
    await authApi(`/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PATCH', body: JSON.stringify(changes),
    })
  },
}
