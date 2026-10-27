// @arch docs/design/desktop/unified-desktop-control.md#页面清单与交互矩阵
// @test ../../__tests__/desktop-room-management.test.ts
import type { RoomInviteLink, RoomJoinRequest } from '../rooms/roomAccountClient.types'
import type { RoomDetailView, RoomMemberView } from '../rooms/types'
import { roomNotificationPreferencesForMode, type RoomNotificationMode } from '../rooms/roomNotificationPreference'

export type DesktopRoomManagementClient = {
  getRoom(roomId: string): Promise<{ room: RoomDetailView; membershipId: string | null }>
  listMembers(roomId: string): Promise<RoomMemberView[]>
  listPendingJoinRequests(roomId: string): Promise<RoomJoinRequest[]>
  getInviteLink(roomId: string): Promise<RoomInviteLink>
  resetInviteLink(roomId: string): Promise<RoomInviteLink>
  updateRoom(roomId: string, changes: {
    name?: string
    joinPolicy?: RoomDetailView['joinPolicy']
    maxAgentsPerMember?: number
  }): Promise<RoomDetailView>
  updateNotificationPreferences(
    roomId: string,
    changes: { muteRegularNotifications: boolean; muteMentionNotifications: boolean },
  ): Promise<{ muteRegularNotifications: boolean; muteMentionNotifications: boolean }>
  removeMember(roomId: string, membershipId: string): Promise<void>
  reviewJoinRequest(roomId: string, requestId: string, decision: 'approve' | 'reject'): Promise<void>
  leaveRoom(roomId: string): Promise<void>
  deleteRoomRecord(roomId: string): Promise<void>
  deleteRoom(roomId: string): Promise<void>
}

export type DesktopRoomManagementState = {
  room: RoomDetailView | null
  members: RoomMemberView[]
  requests: RoomJoinRequest[]
  invite: RoomInviteLink | null
  loading: boolean
  busy: string | null
  failure: string | null
}

export type DesktopRoomMemberRow = {
  member: RoomMemberView
  depth: 0 | 1
  owner: RoomMemberView | null
}

const emptyState = (): DesktopRoomManagementState => ({
  room: null,
  members: [],
  requests: [],
  invite: null,
  loading: true,
  busy: null,
  failure: null,
})

export function resolveDesktopRoomPermissions(
  accountId: string,
  room: RoomDetailView | null,
  members: RoomMemberView[],
) {
  const ownMembership = members.find(member =>
    member.principalType === 'human' && member.ownerUserId === accountId,
  ) ?? null
  const active = room?.status === 'active'
  return {
    ownMembership,
    canViewInvite: Boolean(ownMembership),
    canManage: Boolean(active && ownMembership?.role === 'owner'),
    canAddAgent: Boolean(active && ownMembership &&
      room?.membershipStatus !== 'left' && room?.membershipStatus !== 'removed'),
    canLeave: Boolean(active && ownMembership && ownMembership.role !== 'owner'),
    canDeleteRecord: Boolean(room?.membershipStatus || ownMembership),
  }
}

export function resolveDesktopOwnRoomAgents(
  accountId: string,
  members: RoomMemberView[],
): Array<RoomMemberView & { agentIdentityId: string }> {
  return members.filter((member): member is RoomMemberView & { agentIdentityId: string } =>
    member.principalType === 'agent' &&
    member.ownerUserId === accountId &&
    typeof member.agentIdentityId === 'string' &&
    member.agentIdentityId.length > 0,
  )
}

export function buildDesktopRoomMemberRows(members: RoomMemberView[]): DesktopRoomMemberRow[] {
  const humans = members.filter(member => member.principalType === 'human')
  const agents = members.filter(member => member.principalType === 'agent')
  const children = new Map<string, RoomMemberView[]>()
  for (const agent of agents) {
    const parentId = agent.parentHumanMembershipId
    if (!parentId) continue
    const group = children.get(parentId) ?? []
    group.push(agent)
    children.set(parentId, group)
  }
  const rows: DesktopRoomMemberRow[] = []
  for (const human of humans) {
    rows.push({ member: human, depth: 0, owner: null })
    for (const agent of children.get(human.id) ?? []) {
      rows.push({ member: agent, depth: 1, owner: human })
    }
  }
  for (const agent of agents) {
    if (!agent.parentHumanMembershipId || !humans.some(human => human.id === agent.parentHumanMembershipId)) {
      rows.push({ member: agent, depth: 0, owner: null })
    }
  }
  return rows
}

export function resolveDesktopRoomShareUrl(
  room: RoomDetailView,
  invite: RoomInviteLink | null,
  webBaseUrl: string,
): string | null {
  if (room.joinPolicy !== 'closed') return invite?.url ?? null
  return `${webBaseUrl.replace(/\/+$/, '')}/spaces/${encodeURIComponent(room.id)}`
}

export class DesktopRoomManagementModel {
  private state = emptyState()
  private listeners = new Set<() => void>()
  private generation = 0
  private loadSequence = 0
  private active = false

  constructor(private readonly options: {
    accountId: string
    roomId: string
    currentAccount(): string | null
    client: DesktopRoomManagementClient
  }) {}

  getState = (): DesktopRoomManagementState => this.state
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private publish(next: DesktopRoomManagementState): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }
  private current(generation: number): boolean {
    return this.active && generation === this.generation &&
      this.options.currentAccount() === this.options.accountId
  }
  start(): () => void {
    this.active = true
    this.generation += 1
    void this.reload()
    return () => this.stop()
  }
  stop(): void {
    this.active = false
    this.generation += 1
    this.publish(emptyState())
  }
  clearFailure = (): void => {
    if (this.state.busy || !this.current(this.generation) || !this.state.failure) return
    this.publish({ ...this.state, failure: null })
  }
  reload = async (): Promise<boolean> => {
    const generation = this.generation
    if (!this.current(generation) || this.state.busy) return false
    const sequence = ++this.loadSequence
    this.publish({ ...this.state, loading: true, failure: null })
    try {
      const [detail, members] = await Promise.all([
        this.options.client.getRoom(this.options.roomId),
        this.options.client.listMembers(this.options.roomId),
      ])
      if (!this.current(generation) || sequence !== this.loadSequence) return false
      if (detail.room.id !== this.options.roomId) throw new Error('Desktop Room scope mismatch')
      const permissions = resolveDesktopRoomPermissions(this.options.accountId, detail.room, members)
      let requests: RoomJoinRequest[] = []
      if (permissions.canManage) requests = await this.options.client.listPendingJoinRequests(this.options.roomId)
      if (!this.current(generation) || sequence !== this.loadSequence) return false
      this.publish({ room: detail.room, members, requests, invite: null, loading: false, busy: null, failure: null })
      return true
    } catch (error) {
      if (this.current(generation) && sequence === this.loadSequence) {
        this.publish(failureState(this.state, error, { loading: false }))
      }
      return false
    }
  }
  loadInvite = async (): Promise<boolean> => {
    const room = this.state.room
    const permissions = resolveDesktopRoomPermissions(this.options.accountId, room, this.state.members)
    if (!this.current(this.generation) || !permissions.canViewInvite) return false
    if (!room || room.joinPolicy === 'closed') {
      this.publish({ ...this.state, invite: null })
      return Boolean(room)
    }
    return this.run(
      'invite.load',
      () => this.options.client.getInviteLink(this.options.roomId),
      invite => ({ ...this.state, invite }),
    )
  }
  rename = (name: string): Promise<boolean> => {
    const value = name.trim()
    if (!value || !this.canParticipate()) return Promise.resolve(false)
    return this.update('room.rename', { name: value })
  }
  setJoinPolicy = (joinPolicy: RoomDetailView['joinPolicy']): Promise<boolean> =>
    this.canManage() ? this.update('room.joinPolicy', { joinPolicy }) : Promise.resolve(false)
  setNotificationMode = (mode: RoomNotificationMode): Promise<boolean> => {
    if (!this.canParticipate() || this.state.room?.membershipStatus === 'left' || this.state.room?.membershipStatus === 'removed') return Promise.resolve(false)
    return this.run('room.notifications', () =>
      this.options.client.updateNotificationPreferences(
        this.options.roomId,
        roomNotificationPreferencesForMode(mode),
      ), saved => ({ ...this.state, room: { ...this.state.room!, ...saved } }))
  }
  closeInvite = (): Promise<boolean> => this.canManage()
    ? this.update('invite.close', { joinPolicy: 'closed' }) : Promise.resolve(false)
  resetInvite = (): Promise<boolean> => this.canManage() ? this.run(
    'invite.reset',
    () => this.options.client.resetInviteLink(this.options.roomId),
    invite => ({ ...this.state, invite }),
  ) : Promise.resolve(false)
  removeMember = (membershipId: string): Promise<boolean> => this.canRemove(membershipId) ? this.run(`member.remove:${membershipId}`, async () => {
    await this.options.client.removeMember(this.options.roomId, membershipId)
    return this.readAfterMutation()
  }, snapshot => ({ ...this.state, ...snapshot })) : Promise.resolve(false)
  review = (requestId: string, decision: 'approve' | 'reject'): Promise<boolean> =>
    this.canManage() && this.state.requests.some(request => request.id === requestId)
      ? this.run(`request.${decision}:${requestId}`, async () => {
      await this.options.client.reviewJoinRequest(this.options.roomId, requestId, decision)
      return this.readAfterMutation()
    }, snapshot => ({ ...this.state, ...snapshot })) : Promise.resolve(false)
  leave = (): Promise<boolean> => this.canParticipate() && !this.canManage()
    ? this.run('room.leave', () => this.options.client.leaveRoom(this.options.roomId)) : Promise.resolve(false)
  leaveAndClearRecord = (): Promise<boolean> => this.canParticipate() && !this.canManage()
    ? this.run('room.leave', async () => {
      await this.options.client.leaveRoom(this.options.roomId)
      await this.options.client.deleteRoomRecord(this.options.roomId)
    }) : Promise.resolve(false)
  deleteRecord = (): Promise<boolean> => this.state.room &&
    resolveDesktopRoomPermissions(this.options.accountId, this.state.room, this.state.members).canDeleteRecord
    ? this.run('room.record.delete', () => this.options.client.deleteRoomRecord(this.options.roomId))
    : Promise.resolve(false)
  dissolve = (): Promise<boolean> => this.canManage()
    ? this.run('room.delete', () => this.options.client.deleteRoom(this.options.roomId)) : Promise.resolve(false)

  private update(operation: string, changes: Parameters<DesktopRoomManagementClient['updateRoom']>[1]): Promise<boolean> {
    return this.run(operation, async () => {
      await this.options.client.updateRoom(this.options.roomId, changes)
      return this.readAfterMutation()
    }, snapshot => ({ ...this.state, ...snapshot, ...(changes.joinPolicy ? { invite: null } : {}) }))
  }
  private canParticipate(): boolean {
    const permissions = resolveDesktopRoomPermissions(this.options.accountId, this.state.room, this.state.members)
    return Boolean(this.state.room?.status === 'active' && permissions.ownMembership)
  }
  private canManage(): boolean {
    return resolveDesktopRoomPermissions(this.options.accountId, this.state.room, this.state.members).canManage
  }
  private canRemove(membershipId: string): boolean {
    const target = this.state.members.find(member => member.id === membershipId)
    return Boolean(this.canManage() && target && target.role !== 'owner' &&
      !(target.principalType === 'human' && target.ownerUserId === this.options.accountId))
  }
  private async readAfterMutation(): Promise<Pick<DesktopRoomManagementState, 'room' | 'members' | 'requests'>> {
    const [detail, members] = await Promise.all([
      this.options.client.getRoom(this.options.roomId),
      this.options.client.listMembers(this.options.roomId),
    ])
    if (detail.room.id !== this.options.roomId) throw new Error('Desktop Room scope mismatch')
    const permissions = resolveDesktopRoomPermissions(this.options.accountId, detail.room, members)
    const requests = permissions.canManage
      ? await this.options.client.listPendingJoinRequests(this.options.roomId)
      : []
    return { room: detail.room, members, requests }
  }
  private run<T>(
    operation: string,
    task: () => Promise<T>,
    commit?: (value: T) => DesktopRoomManagementState,
  ): Promise<boolean> {
    if (this.state.busy || !this.current(this.generation)) return Promise.resolve(false)
    const generation = this.generation
    this.publish({ ...this.state, busy: operation, failure: null })
    return task().then(value => {
      if (!this.current(generation)) return false
      const next = commit ? commit(value) : this.state
      this.publish({ ...next, busy: null, failure: null })
      return true
    }).catch(error => {
      if (!this.current(generation)) return false
      this.publish(failureState(this.state, error, { busy: null }))
      return false
    })
  }
}

function message(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Desktop Room action failed'
}

function failureState(
  current: DesktopRoomManagementState,
  error: unknown,
  patch: Partial<DesktopRoomManagementState>,
): DesktopRoomManagementState {
  const code = error && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : ''
  if (code === 'FORBIDDEN' || code === 'NOT_FOUND' || code === 'AUTH_REQUIRED') {
    return { ...emptyState(), loading: false, busy: null, failure: 'unavailable' }
  }
  return { ...current, ...patch, failure: message(error) }
}
