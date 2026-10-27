// @arch docs/architecture/app/chat-draft-storage.md
import { useSessionsStore } from '@shennian/shared'
import type { NianSession } from '@shennian/wire'
import { db } from '../../storage/db'
import { authApi } from '../../config/api'
import { useAuthStore } from '../../config/auth'
import { accountRuntime } from '../account-runtime/accountRuntime'
import { createLocalSessionPromoter } from './localSessionDraft'

export const ensureLocalSession = createLocalSessionPromoter({
  read: async (id) => {
    if (await db.getSessionDeletion(id)) return undefined
    return db.getSessionSyncTarget!(id)
  },
  create: async (id, input) => (await authApi<{ session: NianSession }>(
    `/sessions/local/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify(input) },
  )).session,
  persist: (session) => accountRuntime.persistSession(session),
  publish: (session) => useSessionsStore.getState().upsertSession(session),
  accountId: () => useAuthStore.getState().user?.id ?? '',
})
