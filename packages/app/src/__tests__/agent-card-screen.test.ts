// @covers packages/app/src/features/agents/AgentCardScreen.tsx
// @covers packages/app/app/(main)/agents/[agentId]/index.tsx
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf8')

describe('AI card entry and owner requests', () => {
  it('uses authenticated requests for every owner-only card operation', () => {
    const source = read('../features/agents/AgentCardScreen.tsx')
    expect(source).toContain("import { authApi } from '../../config/api'")
    expect(source.match(/await authApi</g)).toHaveLength(13)
    expect(source).not.toMatch(/\bawait api</)
  })

  it('does not stretch the manage-row title away from its subtitle', () => {
    const source = read('../../app/(main)/agents/[agentId]/index.tsx')
    expect(source).toContain('style={[styles.globalManageTitle, { color: colors.text }]}>{cardLabel}</Text>')
    expect(source).toContain('globalManageTitle: { ...mobileTypography.listTitle },')
  })

  it('keeps only a download action below the card QR code', () => {
    const source = read('../features/agents/AgentCardQr.tsx')
    expect(source).toContain("icon={saved ? 'checkmark' : 'download-outline'}")
    expect(source).not.toContain('share-outline')
    expect(source).not.toContain('Share.share')
  })

  it('centers all four card-setting switches in their rows', () => {
    const source = read('../features/agents/AgentCardScreen.tsx')
    expect(source.match(/<View style={styles.switchControl}>/g)).toHaveLength(4)
    expect(source.match(/style={styles.settingSwitch}/g)).toHaveLength(4)
    expect(source).toContain("settingSwitch: Platform.OS === 'ios' ? { width: 51, height: 31 } : {}")
  })

  it('activates the publication before listing it, so Discover never shows an unusable card', () => {
    const source = read('../features/agents/AgentCardScreen.tsx')
    const togglePlaza = source.slice(source.indexOf('const togglePlaza'), source.indexOf('const toggleApproval'))
    expect(togglePlaza).toContain("if (listed && current.status !== 'active')")
    expect(togglePlaza).toContain('/publication/activate')
  })

  it('does not present an inactive profile URL as a working invitation and activates before direct use', () => {
    const source = read('../features/agents/AgentCardScreen.tsx')
    expect(source).toContain("const url = publication?.status === 'active' && publication.publicId")
    const toggle = source.slice(source.indexOf('const updateAnonymous'), source.indexOf('const toggleAnonymous'))
    expect(toggle).toContain("if (allowed && current.status !== 'active')")
    expect(toggle.indexOf('/publication/activate')).toBeLessThan(toggle.indexOf('/publication/anonymous-access'))
  })
})
