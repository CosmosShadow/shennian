import { authApi } from '../../config/api'
import type { ContactAvatar } from './contactAccountClient'

export type PlazaAgent = {
  publicId: string
  agentIdentityId: string
  displayName: string
  description: string
  allowNewContacts: boolean
  requireContactApproval: boolean
  avatar: ContactAvatar
  status: 'active' | 'unavailable'
  machineOnline: boolean
  updatedAt: string
}

export const plazaAccountClient = {
  list(query = '', cursor?: string | null) {
    const params = new URLSearchParams({ limit: '30' })
    if (query.trim()) params.set('q', query.trim())
    if (cursor) params.set('cursor', cursor)
    return authApi<{ agents: PlazaAgent[]; nextCursor: string | null }>(`/plaza/agents?${params}`)
  },
  get(publicId: string) {
    return authApi<{ agent: PlazaAgent }>(`/plaza/agents/${encodeURIComponent(publicId)}`)
  },
}
