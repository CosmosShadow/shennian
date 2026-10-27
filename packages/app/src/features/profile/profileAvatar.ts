// @arch docs/features/network-rooms/ui.md#三昵称和头像
// @test src/__tests__/profile-avatar-editor.test.ts

import type { Action } from 'expo-image-manipulator'

const INITIAL_COLORS = ['#2563EB', '#7C3AED', '#DB2777', '#DC2626', '#D97706', '#059669', '#0891B2']

export function stableAvatarColor(value: string): string {
  let hash = 0
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return INITIAL_COLORS[Math.abs(hash) % INITIAL_COLORS.length]!
}

export function resolveProfileAvatarUrl(
  path: string,
  apiBaseUrl: string,
  version?: string,
): string {
  const url = /^https?:\/\//i.test(path)
    ? path
    : `${apiBaseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
  if (!version) return url
  return `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(version)}`
}

export function buildSquareAvatarActions(width: number, height: number): Action[] {
  const side = Math.min(width || 0, height || 0)
  if (side <= 0) return []
  const actions: Action[] = [
    {
      crop: {
        originX: Math.max(0, Math.floor((width - side) / 2)),
        originY: Math.max(0, Math.floor((height - side) / 2)),
        width: side,
        height: side,
      },
    },
  ]
  if (side > 1024) actions.push({ resize: { width: 1024, height: 1024 } })
  return actions
}
