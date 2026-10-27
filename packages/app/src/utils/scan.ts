// @arch docs/architecture/app/modular-features.md#扫码路由
// @test src/__tests__/scan-utils.test.ts

export type ScanActionKind = 'login' | 'pair' | 'share' | 'room' | 'roomAccess' | 'person'

export type ScanAction =
  | { kind: 'room'; roomId: string; inviteToken: string; url: string }
  | { kind: 'roomAccess'; roomId: string; token: string }
  | { kind: 'person'; userId: string }
  | { kind: Exclude<ScanActionKind, 'room' | 'roomAccess' | 'person'>; token: string }

/** Links never choose a server: accept only the active instance's origin. */
function isActiveInstanceLink(url: URL, instanceOrigin?: string): boolean {
  const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
  if (!instanceOrigin) return (url.protocol === 'https:' && url.origin === 'https://app.shennian.net') || local
  try {
    const active = new URL(instanceOrigin)
    if (active.username || active.password || active.pathname !== '/' || active.search || active.hash) return false
    if (active.origin === 'https://shennian.net') return url.origin === 'https://app.shennian.net' || local
    return url.origin === active.origin && (url.protocol === 'https:' || (local && active.protocol === 'http:'))
  } catch { return false }
}

export function extractPersonShare(value: string, instanceOrigin?: string): { userId: string } | null {
  try {
    const url = new URL(value.trim())
    if (!isActiveInstanceLink(url, instanceOrigin)) return null
    const match = url.pathname.match(/^\/contacts\/users\/([A-Za-z0-9_-]{8,64})\/?$/)
    if (!match || url.search || url.hash || url.username || url.password) return null
    return { userId: match[1] }
  } catch { return null }
}

export function extractMachineInvitation(value: string, instanceOrigin?: string): { token: string } | null {
  try {
    const url = new URL(value.trim())
    if (!isActiveInstanceLink(url, instanceOrigin)) return null
    const match = url.pathname.match(/^\/machine-invites\/([A-Za-z0-9_-]{16,128})$/)
    if (!match || url.search || url.hash || url.username || url.password) return null
    return { token: match[1] }
  } catch { return null }
}

export function extractRoomInvitation(
  value: string, instanceOrigin?: string,
): { roomId: string; inviteToken: string; url: string } | null {
  const text = value.trim()
  try {
    const url = new URL(text)
    if (!isActiveInstanceLink(url, instanceOrigin)) return null
    const match = url.pathname.match(/^\/spaces\/([^/]+)$/)
    const inviteToken = url.searchParams.get('invite') ?? ''
    if (
      !match ||
      (url.searchParams.size !== 0 && (url.searchParams.size !== 1 || !url.searchParams.has('invite'))) ||
      (url.searchParams.size === 1 && !/^[A-Za-z0-9_-]{32,256}$/.test(inviteToken)) ||
      url.username ||
      url.password ||
      url.hash
    ) return null
    const roomId = decodeURIComponent(match[1])
    if (!roomId || roomId.includes('/')) return null
    return { roomId, inviteToken, url: url.toString() }
  } catch {
    return null
  }
}

export function parseScanPayload(data: string, instanceOrigin?: string): ScanAction | null {
  const value = data.trim()
  if (!value) return null

  const roomInvitation = extractRoomInvitation(value, instanceOrigin)
  if (roomInvitation) return { kind: 'room', ...roomInvitation }
  const person = extractPersonShare(value, instanceOrigin)
  if (person) return { kind: 'person', userId: person.userId }
  const machineInvitation = extractMachineInvitation(value, instanceOrigin)
  if (machineInvitation) return { kind: 'share', token: machineInvitation.token }
  if (/^https?:\/\//i.test(value)) return null

  const roomAccess = value.match(/^room-access:([A-Za-z0-9_-]{1,191}):([A-Za-z0-9_-]{43})$/)
  if (roomAccess) return { kind: 'roomAccess', roomId: roomAccess[1], token: roomAccess[2] }

  if (value.startsWith('qr:')) {
    const token = value.slice(3).trim()
    return token ? { kind: 'login', token } : null
  }

  if (value.startsWith('share:')) {
    const token = value.slice(6).trim()
    return token ? { kind: 'share', token } : null
  }

  if (value.startsWith('pair:')) {
    const token = value.slice(5).trim()
    return token ? { kind: 'pair', token } : null
  }

  return { kind: 'pair', token: value }
}

export function getScanSuccessTranslationKey(
  kind: Exclude<ScanActionKind, 'room' | 'person'>,
): 'scan_result_login' | 'scan_result_pair' | 'scan_result_share' | 'scan_result_room_access' {
  if (kind === 'roomAccess') return 'scan_result_room_access'
  if (kind === 'login') return 'scan_result_login'
  if (kind === 'share') return 'scan_result_share'
  return 'scan_result_pair'
}

export function isScannerEnabled(params: { processing: boolean; completed: boolean }): boolean {
  return !params.processing && !params.completed
}
