import { normalizeContacts } from './contactValues'
import { authApi } from '../../config/api'

export type ContactAvatar = {
  version: string
  smallUrl: string
  mediumUrl: string
  updatedAt: string
} | null

export type SavedContact = {
  id: string
  kind: 'human' | 'agent'
  displayName: string
  avatar: ContactAvatar
  userId?: string
  agentIdentityId?: string
  publicId?: string | null
  owned?: boolean
  plazaListed?: boolean
  agentWorkspaceId?: string | null
  savedAt?: string
}

export const contactAccountClient = {
  async list(query = '') {
    const response = await authApi<{ contacts: unknown; truncated: boolean }>(
      `/contacts${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`,
    )
    return { contacts: normalizeContacts(response?.contacts), truncated: response?.truncated === true }
  },
  saveHuman(targetUserId: string) {
    return authApi<{ contactId: string }>('/contacts', {
      method: 'POST', body: JSON.stringify({ targetUserId }),
    })
  },
  savePublicAgent(publicAgentId: string) {
    return authApi<{ contactId: string }>('/contacts', {
      method: 'POST', body: JSON.stringify({ publicAgentId }),
    })
  },
  requestPublicAgent(publicAgentId: string) {
    return authApi<{ outcome: 'pending_approval' | 'already_added'; requestId?: string; contactId?: string }>(
      '/contacts/agent-requests', { method: 'POST', body: JSON.stringify({ publicAgentId }) },
    )
  },
  getPublicAgentRequestStatus(publicAgentId: string) {
    return authApi<{ status: 'added' | 'pending' | 'none' }>(
      `/contacts/agent-requests/${encodeURIComponent(publicAgentId)}`,
    )
  },
  remove(contactId: string) {
    return authApi(`/contacts/${encodeURIComponent(contactId)}`, { method: 'DELETE' })
  },
}
