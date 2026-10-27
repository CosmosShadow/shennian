// @covers packages/app/src/features/rooms/useRoomBrowserAuthorizations.ts
// @covers packages/app/src/features/rooms/components/RoomListPanel.tsx
// @covers packages/app/app/(main)/scan.tsx
// @covers packages/app/src/features/rooms/components/RoomInviteQr.tsx
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseScanPayload } from '../utils/scan'
import zh from '../../../../open-source/packages/shared/src/i18n/zh'
import en from '../../../../open-source/packages/shared/src/i18n/en'
const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf8')
describe('single-room browser access UI', () => {
  it('routes shared stable room QR to the App join/membership gate, never machine pairing', () => {
    const url = 'https://app.shennian.net/spaces/room_1'
    expect(parseScanPayload(url)).toEqual({ kind: 'room', roomId: 'room_1', inviteToken: '', url })
    expect(parseScanPayload(`${url}?access=${'a'.repeat(43)}`)?.kind).not.toBe('room')
  })
  it('asks on the phone after a read-only preview and before granting access', () => {
    const scan = read('../../app/(main)/scan.tsx')
    expect(scan.indexOf('/qr/preview')).toBeLessThan(scan.indexOf('Alert.alert(preview.willJoin'))
    expect(scan.indexOf('if (!confirmed) return')).toBeLessThan(scan.lastIndexOf('/qr/confirm'))
    expect(scan).toContain('confirmed: true')
    for (const t of [zh, en]) {
      expect(t.room_browser_approve_title).toContain('{{name}}')
      expect(t.room_browser_approve_body).not.toContain('8')
      expect(t.room_browser_approve_body.split('\n')).toHaveLength(1)
      expect(t.spaces_share_join_hint.split('\n')).toHaveLength(1)
      expect(t.spaces_share_approval_hint.split('\n')).toHaveLength(2)
    }
  })
  it('offers joining from the shared QR and explains when joining is unavailable', () => {
    const gate = read('../features/rooms/RoomAccessGate.tsx')
    const scan = read('../../app/(main)/scan.tsx')
    const errors = read('../features/auth/utils/verifyCodeError.ts')
    expect(gate).not.toContain("t('room_access_invite_required_body')")
    expect(scan).toContain('preview.willJoin')
    expect(errors).toContain("case 'room_join_unavailable':")
    expect(errors).toContain("case 'room_membership_required':")
  })
  it('keeps web access out of the group list and expires active authorizations locally', () => {
    const list = read('../features/rooms/components/RoomListPanel.tsx')
    const info = read('../features/rooms/components/RoomInfoPanel.tsx')
    const hook = read('../features/rooms/useRoomBrowserAuthorizations.ts')
    expect(list).not.toContain('useRoomBrowserAuthorizations')
    expect(list).not.toContain('browserAuthorized')
    expect(list).not.toContain('room-browser-authorized-')
    expect(info).toContain("Platform.OS !== 'web' && ownHuman && roomBrowserAuthorizations.length")
    expect(info).toContain("label={t('spaces_browser_session')}")
    expect(info).toContain("spaces_browser_session_count")
    expect(hook).toContain("'/room-browser/authorizations'")
    expect(hook).toContain('snapshot?.accountId === accountId')
    expect(hook).toContain('Date.parse(session.expiresAt) > Date.now()')
    expect(hook).not.toContain('setInterval')
    expect(read('../features/rooms/components/RoomInviteQr.tsx')).toContain(".split('\\n').map")
  })
  it('clears the old page and rejects late responses after access ends', () => {
    const screen = read('../features/rooms/ScopedRoomConversationScreen.tsx')
    expect(screen).toContain('setMessages([])')
    expect(screen).toContain('setData(null)')
    expect(screen).toContain('if (accessEnded.current) return')
    expect(screen).toContain('Date.parse(data.expiresAt) - Date.now()')
  })
})
