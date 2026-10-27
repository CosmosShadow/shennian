// @arch docs/architecture/app/modular-features.md#扫码路由
// @covers packages/app/src/utils/scan.ts

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  extractRoomInvitation,
  extractMachineInvitation,
  extractPersonShare,
  getScanSuccessTranslationKey,
  isScannerEnabled,
  parseScanPayload,
} from '../utils/scan'
import { sanitizeAuthRedirect } from '../features/auth/utils/redirect'

describe('scan utils', () => {
  it('parses qr login, share and pair payloads', () => {
    expect(parseScanPayload('qr:login-token')).toEqual({ kind: 'login', token: 'login-token' })
    expect(parseScanPayload(`room-access:room_1:${'a'.repeat(43)}`)).toEqual({
      kind: 'roomAccess',
      roomId: 'room_1',
      token: 'a'.repeat(43),
    })
    expect(parseScanPayload('share:share-token')).toEqual({
      kind: 'share',
      token: 'share-token',
    })
    expect(parseScanPayload('pair:sn-abcd-efgh-ijkl')).toEqual({
      kind: 'pair',
      token: 'sn-abcd-efgh-ijkl',
    })
    expect(parseScanPayload('sn-abcd-efgh-ijkl')).toEqual({
      kind: 'pair',
      token: 'sn-abcd-efgh-ijkl',
    })
    expect(parseScanPayload('pair:   ')).toBeNull()
    const token = 'a'.repeat(43)
    const url = `https://app.shennian.net/spaces/room_1?invite=${token}`
    expect(parseScanPayload(url)).toEqual({
      kind: 'room',
      roomId: 'room_1',
      inviteToken: token,
      url,
    })
    expect(extractRoomInvitation(url)).toEqual({ roomId: 'room_1', inviteToken: token, url })
    expect(extractRoomInvitation(token)).toBeNull()
    expect(extractRoomInvitation(`https://shennian.net/spaces/join/${token}`)).toBeNull()
    const machineUrl = `https://app.shennian.net/machine-invites/${token}`
    expect(parseScanPayload(machineUrl)).toEqual({ kind: 'share', token })
    expect(extractMachineInvitation(machineUrl)).toEqual({ token })
    expect(extractMachineInvitation(`https://evil.example/machine-invites/${token}`)).toBeNull()
  })

  it('keeps scanner disabled while processing or after a success result', () => {
    expect(isScannerEnabled({ processing: false, completed: false })).toBe(true)
    expect(isScannerEnabled({ processing: true, completed: false })).toBe(false)
    expect(isScannerEnabled({ processing: false, completed: true })).toBe(false)
  })

  it('opens only canonical person identity links without treating them as pairing tokens', () => {
    const link = 'https://app.shennian.net/contacts/users/user_12345678'
    expect(extractPersonShare(link)).toEqual({ userId: 'user_12345678' })
    expect(parseScanPayload(link)).toEqual({ kind: 'person', userId: 'user_12345678' })
    expect(extractPersonShare('https://evil.example/contacts/users/user_12345678')).toBeNull()
    expect(extractPersonShare(`${link}?token=abc`)).toBeNull()
    expect(extractPersonShare('https://app.shennian.net/contacts/users/..%2Fadmin')).toBeNull()
    expect(sanitizeAuthRedirect('/contacts/users/user_12345678')).toBe(
      '/contacts/users/user_12345678',
    )
    expect(sanitizeAuthRedirect('/contacts/users/../admin')).toBe('/(main)')
  })

  it('maps success states to translation keys', () => {
    expect(getScanSuccessTranslationKey('login')).toBe('scan_result_login')
    expect(getScanSuccessTranslationKey('pair')).toBe('scan_result_pair')
    expect(getScanSuccessTranslationKey('share')).toBe('scan_result_share')
  })

  it('leaves native domain claims to the configured distributor', () => {
    const config = JSON.parse(readFileSync(resolve(__dirname, '../../app.json'), 'utf8'))
    expect(config.expo.android.intentFilters).toBeUndefined()
    expect(config.expo.ios.associatedDomains).toBeUndefined()
  })
})

describe('active self-hosted invite origins', () => {
  const origin = 'https://192.168.20.30'
  const invite = 'a'.repeat(43)
  it('accepts its own Room, machine and person links', () => {
    expect(parseScanPayload(`${origin}/spaces/room-qa?invite=${invite}`, origin)?.kind).toBe('room')
    expect(parseScanPayload(`${origin}/machine-invites/${invite}`, origin)?.kind).toBe('share')
    expect(parseScanPayload(`${origin}/contacts/users/user-12345678`, origin)?.kind).toBe('person')
  })
  it('rejects official and other-instance links while bound to a private server', () => {
    for (const other of [
      'https://app.shennian.net',
      'https://192.168.20.31',
      'https://192.168.20.30:8443',
      'http://192.168.20.30',
    ]) {
      expect(parseScanPayload(`${other}/spaces/room-qa?invite=${invite}`, origin)).toBeNull()
    }
    expect(
      parseScanPayload(`${origin}/spaces/room-qa?invite=${invite}`, 'https://shennian.net'),
    ).toBeNull()
  })
  it('keeps an explicitly selected loopback development origin scoped to its own port', () => {
    const local = 'http://localhost:8081'
    expect(parseScanPayload(`${local}/spaces/room-qa?invite=${invite}`, local)?.kind).toBe('room')
    expect(
      parseScanPayload(`http://localhost:8082/spaces/room-qa?invite=${invite}`, local),
    ).toBeNull()
    expect(
      parseScanPayload(
        `${origin}/spaces/room-qa?invite=${invite}`,
        'https://user:pass@192.168.20.30',
      ),
    ).toBeNull()
  })
})
