let accountId: string | null = null

export function setDesktopRoomReplicaAccountId(value: string | null): void {
  accountId = value
}

export function requireDesktopRoomReplicaAccountId(): string {
  if (!accountId) throw new Error('Desktop Room replica account is unavailable.')
  return accountId
}
