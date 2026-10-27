// @covers packages/app/src/components/avatarShape.ts
// @covers packages/app/src/features/rooms/components/RoomIdentityAvatar.tsx
// @covers packages/app/src/features/profile/styles.ts
// @covers packages/app/src/features/desktop-shell/DesktopSidebar.tsx

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { avatarBorderRadius } from '../components/avatarShape'

describe('shared rounded-square avatars', () => {
  it.each([[16, 3], [21, 4], [25, 5], [30, 5], [44, 8], [56, 10], [80, 14]])(
    'scales the mask for a %i pt avatar without turning it into a circle', (size, radius) => {
      expect(avatarBorderRadius(size)).toBe(radius)
      expect(radius).toBeLessThan(size / 4)
    },
  )

  it('keeps mosaic tiles square without changing ordinary identity avatars', () => {
    expect(avatarBorderRadius(19.5, 'group-tile')).toBe(0)
    expect(avatarBorderRadius(14.5, 'group-tile')).toBe(0)
    expect(avatarBorderRadius(44)).toBe(8)
    expect(avatarBorderRadius(56)).toBe(10)
  })

  it('uses the same mask for photos, placeholders and standalone account avatars', () => {
    for (const file of [
      'features/rooms/components/RoomIdentityAvatar.tsx',
      'features/profile/styles.ts',
      'features/desktop-shell/desktopSidebarStyles.ts',
    ]) {
      const source = readFileSync(resolve(__dirname, '..', file), 'utf8')
      expect(source).toContain('borderRadius: avatarBorderRadius(')
    }
    const identity = readFileSync(resolve(__dirname, '../features/rooms/components/RoomIdentityAvatar.tsx'), 'utf8')
    expect(identity.match(/borderRadius: avatarBorderRadius\(size, variant\)/g)).toHaveLength(2)
    expect(identity).not.toContain("overflow: 'hidden'")
  })
})
