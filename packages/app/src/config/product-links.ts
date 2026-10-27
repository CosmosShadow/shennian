// @arch open-source/docs/mobile-app.md
// @test src/__tests__/product-links.test.ts
import Constants from 'expo-constants'

export type SupportRoomTarget = { roomId: string; inviteToken: string; name: string }
export type AppProductLinks = { iosAppId?: string; officialRoom?: SupportRoomTarget }

/** Build metadata is optional; no private paths, public-room credentials or store IDs in core. */
export function parseAppProductLinks(value: unknown): AppProductLinks {
  if (!value || typeof value !== 'object') return {}
  const input = value as Record<string, unknown>
  const result: AppProductLinks = {}
  if (typeof input.iosAppId === 'string' && /^\d{5,20}$/.test(input.iosAppId))
    result.iosAppId = input.iosAppId
  const room = input.officialRoom as Partial<SupportRoomTarget> | undefined
  if (
    room &&
    typeof room === 'object' &&
    typeof room.roomId === 'string' &&
    /^[A-Za-z0-9_-]{1,191}$/.test(room.roomId) &&
    typeof room.inviteToken === 'string' &&
    /^[A-Za-z0-9_-]{1,512}$/.test(room.inviteToken) &&
    typeof room.name === 'string' &&
    room.name.trim().length > 0 &&
    room.name.length <= 100
  ) {
    result.officialRoom = { roomId: room.roomId, inviteToken: room.inviteToken, name: room.name }
  }
  return result
}
export function getAppProductLinks(): AppProductLinks {
  return parseAppProductLinks(Constants.expoConfig?.extra?.productLinks)
}
