// @arch docs/architecture/desktop/unified-desktop.md#renderer-边界
// Account-scoped social reads and mutations stay in Electron main.

export type SocialAvatar = { version: string; smallUrl: string; mediumUrl: string; updatedAt: string } | null

export type SavedContact = {
  id: string
  kind: 'human' | 'agent'
  displayName: string
  avatar: SocialAvatar
  savedAt?: string
  userId?: string
  agentIdentityId?: string
  agentWorkspaceId?: string
  publicId?: string | null
  owned?: boolean
}

export type PlazaAgent = {
  publicId: string
  agentIdentityId: string
  displayName: string
  description: string
  avatar: SocialAvatar
  status: 'active' | 'unavailable'
  machineOnline: boolean
  updatedAt: string
}

export type RoomInvitation = { invitationId: string; roomId: string; roomName: string;
  inviterUserId: string; inviterName: string; status: 'pending'; createdAt: string; expiresAt: string }
export type SentRoomInvitation = { invitationId: string; roomId: string; roomName: string;
  targetUserId: string; status: 'pending' | 'accepted' | 'declined' | 'expired';
  createdAt: string; expiresAt: string | null }

type Operation = 'contacts.list' | 'contacts.save' | 'contacts.delete' | 'plaza.agents.list' | 'plaza.agents.get'
  | 'room.invitation.create' | 'room.invitations.mine' | 'room.invitations.sent' | 'room.invitation.respond'
type Result = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }
type DesktopWindow = typeof globalThis & { shennianDesktop?: { account?: {
  execute(command: { requestId: string; operation: Operation; input: Record<string, unknown> }): Promise<Result>
} } }

let sequence = 0
async function execute(operation: Operation, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const account = (globalThis as DesktopWindow).shennianDesktop?.account
  if (!account?.execute) throw new Error('Desktop account bridge unavailable')
  const result = await account.execute({ requestId: `desktop-social-${Date.now()}-${++sequence}`, operation, input })
  if (!result.ok) throw new Error(result.error.message)
  if (!result.value || typeof result.value !== 'object' || Array.isArray(result.value)) {
    throw new Error('Invalid social response')
  }
  return result.value as Record<string, unknown>
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid social response')
  return value as Record<string, unknown>
}

function contact(value: unknown): SavedContact {
  const row = object(value)
  if (typeof row.id !== 'string' || typeof row.displayName !== 'string' ||
    (row.kind !== 'human' && row.kind !== 'agent')) throw new Error('Invalid contact')
  return row as SavedContact
}

function plazaAgent(value: unknown): PlazaAgent {
  const row = object(value)
  if (typeof row.publicId !== 'string' || typeof row.agentIdentityId !== 'string' ||
    typeof row.displayName !== 'string' || typeof row.description !== 'string') throw new Error('Invalid plaza agent')
  return row as PlazaAgent
}

export const desktopSocialAccountPort = {
  async contacts(q = ''): Promise<{ contacts: SavedContact[]; truncated: boolean }> {
    const result = await execute('contacts.list', q ? { q } : {})
    if (!Array.isArray(result.contacts) || typeof result.truncated !== 'boolean') throw new Error('Invalid contacts list')
    return { contacts: result.contacts.map(contact), truncated: result.truncated }
  },
  async saveHuman(targetUserId: string): Promise<string> {
    const result = await execute('contacts.save', { targetUserId })
    if (typeof result.contactId !== 'string') throw new Error('Invalid contact result')
    return result.contactId
  },
  async saveAgent(publicAgentId: string): Promise<string> {
    const result = await execute('contacts.save', { publicAgentId })
    if (typeof result.contactId !== 'string') throw new Error('Invalid contact result')
    return result.contactId
  },
  async remove(contactId: string): Promise<void> {
    const result = await execute('contacts.delete', { contactId })
    if (result.removed !== true) throw new Error('Invalid contact result')
  },
  async plaza(q = '', cursor?: string): Promise<{ agents: PlazaAgent[]; nextCursor: string | null }> {
    const result = await execute('plaza.agents.list', { ...(q ? { q } : {}), limit: 30, ...(cursor ? { cursor } : {}) })
    if (!Array.isArray(result.agents) || !(result.nextCursor === null || typeof result.nextCursor === 'string')) {
      throw new Error('Invalid plaza list')
    }
    return { agents: result.agents.map(plazaAgent), nextCursor: result.nextCursor }
  },
  async plazaDetail(publicId: string): Promise<PlazaAgent> {
    const result = await execute('plaza.agents.get', { publicId })
    return plazaAgent(result.agent)
  },
  async inviteHuman(targetUserId: string, name: string, clientOperationId: string): Promise<{ roomId: string; invitationId: string }> {
    const result = await execute('room.invitation.create', { name, inviteeUserIds: [targetUserId], clientOperationId })
    const room = object(result.room)
    const invitations = result.invitations
    if (typeof room.id !== 'string' || !Array.isArray(invitations)) throw new Error('Invalid Room invitation')
    const invitation = object(invitations[0])
    if (typeof invitation.invitationId !== 'string' || invitation.status !== 'pending')
      throw new Error('Invalid Room invitation')
    return { roomId: room.id, invitationId: invitation.invitationId }
  },
  async inviteHumans(targetUserIds: string[], name: string, clientOperationId: string): Promise<{ roomId: string }> {
    if (!targetUserIds.length) throw new Error('Choose at least one contact')
    const result = await execute('room.invitation.create', { name, inviteeUserIds: targetUserIds, clientOperationId })
    const room = object(result.room)
    if (typeof room.id !== 'string' || !Array.isArray(result.invitations)
      || result.invitations.length !== targetUserIds.length) throw new Error('Invalid Room invitation')
    const returnedIds = new Set<string>()
    for (const value of result.invitations) {
      const invitation = object(value)
      if (typeof invitation.targetUserId !== 'string' || !targetUserIds.includes(invitation.targetUserId)
        || returnedIds.has(invitation.targetUserId)
        || !['pending', 'already_member'].includes(String(invitation.status))) throw new Error('Invalid Room invitation')
      returnedIds.add(invitation.targetUserId)
    }
    return { roomId: room.id }
  },
  async invitations(): Promise<RoomInvitation[]> {
    const result = await execute('room.invitations.mine', {})
    if (!Array.isArray(result.invitations)) throw new Error('Invalid Room invitations')
    return result.invitations.map(value => {
      const invitation = object(value)
      if (typeof invitation.invitationId !== 'string' || typeof invitation.roomId !== 'string'
        || typeof invitation.roomName !== 'string' || typeof invitation.inviterName !== 'string'
        || invitation.status !== 'pending') throw new Error('Invalid Room invitation')
      return invitation as RoomInvitation
    })
  },
  async sentInvitations(targetUserId: string): Promise<SentRoomInvitation[]> {
    const result = await execute('room.invitations.sent', { targetUserId })
    if (!Array.isArray(result.sentInvitations)) throw new Error('Invalid sent Room invitations')
    return result.sentInvitations.map(value => {
      const row = object(value)
      if (typeof row.invitationId !== 'string' || typeof row.roomId !== 'string'
        || typeof row.roomName !== 'string' || row.targetUserId !== targetUserId
        || !['pending', 'accepted', 'declined', 'expired'].includes(String(row.status)))
        throw new Error('Invalid sent Room invitation')
      return row as SentRoomInvitation
    })
  },
  async respondToInvitation(invitationId: string, decision: 'accept' | 'decline'): Promise<{ roomId: string; status: 'accepted' | 'declined' }> {
    const result = await execute('room.invitation.respond', { invitationId, decision })
    if (typeof result.roomId !== 'string' || (result.status !== 'accepted' && result.status !== 'declined'))
      throw new Error('Invalid Room invitation response')
    return { roomId: result.roomId, status: result.status }
  },
}
