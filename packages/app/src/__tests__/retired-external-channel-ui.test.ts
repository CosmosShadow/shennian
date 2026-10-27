// @covers src/features/retired/RetiredExternalChannelScreen.tsx
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

function read(relativePath: string) {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8')
}

describe('external channel retirement UI', () => {
  it('keeps legacy routes explicit but removes provider screens from them', () => {
    const routes = [
      'app/(main)/wecom.tsx',
      'app/(main)/feishu.tsx',
      'app/(main)/wechat-rpa.tsx',
      'app/(main)/chat/[sessionId]/external-channel/index.tsx',
      'app/skills/use-wechat.tsx',
    ]
    for (const route of routes) {
      const source = read(`../../${route}`)
      expect(source).toContain('RetiredExternalChannelScreen')
    }
  })

  it('does not advertise external connectors in profile or chat header actions', () => {
    const profile = read('../features/profile/ProfileScreen.tsx')
    const actions = read('../features/chat/utils/headerActions.ts')
    expect(profile).not.toContain("router.navigate('/(main)/wecom')")
    expect(profile).not.toContain("router.navigate('/(main)/feishu')")
    expect(profile).not.toContain("router.navigate('/(main)/wechat-rpa')")
    expect(actions).not.toContain("'external-channel' as const")
  })
})
