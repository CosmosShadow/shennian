// @arch docs/features/network-rooms/scoped-browser-access.md
// @test src/__tests__/scoped-room-api.test.ts

import { ApiError } from '@shennian/shared/api'
import { getApiBaseUrl } from '../../config/api'

export async function scopedRoomApi<T>(
  roomId: string,
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}/room-browser${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
      'X-Shennian-Room-Id': roomId,
      ...(options?.headers ?? {}),
    },
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new ApiError(response.status, body || response.statusText)
  }
  return response.json() as Promise<T>
}

export function scopedRoomEventsUrl(roomId: string): string {
  const url = new URL(`${getApiBaseUrl()}/room-browser/events`)
  url.searchParams.set('roomId', roomId)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}
