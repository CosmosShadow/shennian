// @arch open-source/docs/mobile-app.md
// @covers packages/app/src/config/product-links.ts
// @covers packages/app/src/features/contact/links.ts
// @covers packages/app/src/features/contact/joinCurrentOfficialRoom.ts
// @covers packages/app/src/platform/mobileAppDownload.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({
  url: 'https://shennian.net',
  manual: false,
  links: {} as unknown,
}))
vi.mock('expo-constants', () => ({
  default: {
    get expoConfig() {
      return { extra: { productLinks: state.links } }
    },
  },
}))
vi.mock('../config/server', () => ({
  getServerUrl: () => state.url,
  getWebAppUrl: () => 'https://app.shennian.net',
  isSelfHostedSelection: () => state.manual,
  SERVERS: { cn: { url: 'https://shennian.net' } },
  PUBLIC_SITE_URL: 'https://shennian.net',
}))
import { getAppProductLinks, parseAppProductLinks } from '../config/product-links'
const room = { roomId: 'test-room', inviteToken: 'unit-invite', name: 'Support' }
beforeEach(() => {
  vi.resetModules()
  state.url = 'https://shennian.net'
  state.manual = false
  state.links = { iosAppId: '1234567890', officialRoom: room }
})
afterEach(() => vi.unstubAllGlobals())

describe('optional build metadata for the shared App', () => {
  it('does not need private files or an official store / group identity', () => {
    state.links = undefined
    expect(getAppProductLinks()).toEqual({})
  })
  it('copies only valid public-facing metadata and rejects URL / token injection', () => {
    expect(
      parseAppProductLinks({ ...(state.links as object), credential: 'not-exported' }),
    ).toEqual({ iosAppId: '1234567890', officialRoom: room })
    expect(
      parseAppProductLinks({
        iosAppId: '../account',
        officialRoom: { ...room, inviteToken: 'unit&redirect=x' },
      }),
    ).toEqual({})
  })
  it('preserves official review and store destinations but omits review when no store is configured', async () => {
    let links = await import('../features/contact/links')
    expect(links.IOS_REVIEW_URL).toBe('https://apps.apple.com/app/id1234567890?action=write-review')
    const { getMobileAppDownloadUrl } = await import('../platform/mobileAppDownload')
    expect(getMobileAppDownloadUrl('ios')).toBe('https://apps.apple.com/app/id1234567890')
    state.links = {}
    vi.resetModules()
    links = await import('../features/contact/links')
    expect(links.IOS_REVIEW_URL).toBe('')
    expect(getMobileAppDownloadUrl('ios')).toBe('https://shennian.net/#download')
  })
  it('retains the official offline fallback only on the official service', async () => {
    const { resolveOfficialRoomTarget } = await import('../features/contact/links')
    const request = vi.fn().mockRejectedValue(new Error('offline'))
    expect(await resolveOfficialRoomTarget(request)).toEqual(room)
  })
  it.each([true, false])(
    'never applies official group credentials on a company service (manual=%s)',
    async (manual) => {
      state.manual = manual
      state.url = 'https://company.example'
      const { resolveOfficialRoomTarget, getFallbackOfficialRoomUrl } =
        await import('../features/contact/links')
      const request = vi.fn().mockResolvedValue({ ok: false, status: 404 })
      expect(await resolveOfficialRoomTarget(request)).toBeNull()
      expect(request.mock.calls[0][0]).toBe('https://company.example/api/public/official-room')
      expect(getFallbackOfficialRoomUrl()).toBe('https://company.example/join/official')
    },
  )
  it('accepts the support room configured by the selected company server', async () => {
    state.manual = true
    state.url = 'https://company.example'
    const configured = { ...room, roomId: 'company-room' }
    const { resolveOfficialRoomTarget } = await import('../features/contact/links')
    expect(
      await resolveOfficialRoomTarget(
        vi.fn().mockResolvedValue({ ok: true, json: async () => configured }),
      ),
    ).toEqual(configured)
  })
  it('reports missing configuration without trying to exchange an official invitation', async () => {
    state.manual = true
    state.url = 'https://company.example'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    const client = { exchange: vi.fn(), join: vi.fn() }
    const { joinCurrentOfficialRoom } = await import('../features/contact/joinCurrentOfficialRoom')
    await expect(joinCurrentOfficialRoom(client)).rejects.toThrow('contact_not_configured')
    expect(client.exchange).not.toHaveBeenCalled()
  })
  it('does not misreport network failure as missing configuration on a company service', async () => {
    state.manual = true
    state.url = 'https://company.example'
    const { resolveOfficialRoomTarget } = await import('../features/contact/links')
    await expect(
      resolveOfficialRoomTarget(vi.fn().mockRejectedValue(new Error('offline'))),
    ).rejects.toThrow('offline')
  })
})

it('recognizes the server explicit unconfigured-support response, not every 503 as configuration loss', async () => {
  state.manual = true
  state.url = 'https://company.example'
  const { resolveOfficialRoomTarget } = await import('../features/contact/links')
  expect(
    await resolveOfficialRoomTarget(
      vi
        .fn()
        .mockResolvedValue({
          ok: false,
          status: 503,
          json: async () => ({ error: 'official_room_unavailable' }),
        }),
    ),
  ).toBeNull()
  await expect(
    resolveOfficialRoomTarget(
      vi
        .fn()
        .mockResolvedValue({
          ok: false,
          status: 503,
          json: async () => ({ error: 'upstream_failure' }),
        }),
    ),
  ).rejects.toThrow('contact_join_failed')
})
