// @covers packages/app/src/features/profile/profileAvatar.ts
// @covers packages/app/src/features/profile/components/ProfileAvatarEditor.tsx

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildSquareAvatarActions,
  resolveProfileAvatarUrl,
  stableAvatarColor,
} from '../features/profile/profileAvatar'

describe('profile avatar editor', () => {
  it('builds a centered square crop and bounds oversized uploads', () => {
    expect(buildSquareAvatarActions(1600, 900)).toEqual([
      { crop: { originX: 350, originY: 0, width: 900, height: 900 } },
    ])
    expect(buildSquareAvatarActions(3000, 1800)).toEqual([
      { crop: { originX: 600, originY: 0, width: 1800, height: 1800 } },
      { resize: { width: 1024, height: 1024 } },
    ])
  })

  it('resolves API-relative immutable URLs in local and production layouts', () => {
    expect(resolveProfileAvatarUrl('/public/avatar/96', 'http://127.0.0.1:3000')).toBe(
      'http://127.0.0.1:3000/public/avatar/96',
    )
    expect(resolveProfileAvatarUrl('/public/avatar/96', 'https://shennian.net/api')).toBe(
      'https://shennian.net/api/public/avatar/96',
    )
    expect(
      resolveProfileAvatarUrl('/public/avatar/96', 'https://shennian.net/api', 'avatar-v2'),
    ).toBe('https://shennian.net/api/public/avatar/96?v=avatar-v2')
  })

  it('keeps the default initial color stable and makes the avatar itself the only edit action', () => {
    expect(stableAvatarColor('user-1')).toBe(stableAvatarColor('user-1'))
    const source = readFileSync(
      resolve(__dirname, '../features/profile/components/ProfileAvatarEditor.tsx'),
      'utf8',
    )
    expect(source).toContain('allowsEditing: true')
    expect(source).toContain('aspect: [1, 1]')
    expect(source).toContain('profile-avatar-library')
    expect(source).not.toContain('profile-avatar-camera')
    expect(source).not.toContain('profile-avatar-remove')
    expect(source).not.toContain('camera-outline')
    expect(source).not.toContain('profileAvatarEditBadge')
    expect(source).not.toContain("t('profile_avatar_hint')")
    expect(source).not.toContain("t('profile_avatar_replace')")
  })
})
