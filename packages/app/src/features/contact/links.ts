// @arch docs/features/contact-and-reviews.md

import { getServerUrl, getWebAppUrl, isSelfHostedSelection, SERVERS } from '../../config/server'
import { getAppProductLinks } from '../../config/product-links'

const contact = getAppProductLinks()

export const OFFICIAL_ROOM_ID = contact.officialRoom?.roomId ?? ''
export const OFFICIAL_ROOM_INVITE = contact.officialRoom?.inviteToken ?? ''
export const IOS_REVIEW_URL = contact.iosAppId
  ? `https://apps.apple.com/app/id${contact.iosAppId}?action=write-review`
  : ''

export type OfficialRoomTarget = {
  roomId: string
  inviteToken: string
  name: string
}

const FALLBACK_OFFICIAL_ROOM: OfficialRoomTarget | null = contact.officialRoom ?? null

function isOfficialContactOrigin() {
  return !isSelfHostedSelection() && getServerUrl().replace(/\/+$/, '') === SERVERS.cn.url
}

export async function resolveOfficialRoomTarget(
  request: typeof fetch = fetch,
): Promise<OfficialRoomTarget | null> {
  const fallback = isOfficialContactOrigin() ? FALLBACK_OFFICIAL_ROOM : null
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3_000)
  try {
    const response = await request(
      `${getServerUrl().replace(/\/+$/, '')}/api/public/official-room`,
      {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      },
    )
    if (!response.ok) {
      if (fallback) return fallback
      if (response.status === 404) return null
      if (response.status === 503) {
        const detail = (await response.json().catch(() => null)) as { error?: string } | null
        if (detail?.error === 'official_room_unavailable') return null
      }
      throw new Error('contact_join_failed')
    }
    const value = (await response.json()) as Record<string, unknown>
    if (
      typeof value.roomId !== 'string' ||
      !value.roomId ||
      typeof value.inviteToken !== 'string' ||
      !value.inviteToken ||
      typeof value.name !== 'string' ||
      !value.name
    )
      return fallback
    return { roomId: value.roomId, inviteToken: value.inviteToken, name: value.name }
  } catch (error) {
    if (fallback) return fallback
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export function getOfficialRoomUrl(): string {
  return `${getServerUrl().replace(/\/+$/, '')}/join/official`
}

export function getFallbackOfficialRoomUrl(): string {
  if (!FALLBACK_OFFICIAL_ROOM || !isOfficialContactOrigin()) return getOfficialRoomUrl()
  return `${getWebAppUrl()}/spaces/${OFFICIAL_ROOM_ID}?invite=${OFFICIAL_ROOM_INVITE}`
}
