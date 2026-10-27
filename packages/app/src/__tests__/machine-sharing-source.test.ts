// @covers packages/app/src/features/machine-sharing/MachineSharingScreen.tsx
// @covers packages/app/src/features/machine-sharing/MachineInviteAcceptanceScreen.tsx
// @covers packages/app/src/features/machine-sharing/MachineInviteScreen.web.tsx

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => fs.readFileSync(path.join(__dirname, file), 'utf8')

describe('machine sharing product surfaces', () => {
  it('uses a dedicated owner page with one permission and keyboard-safe invite sheet', () => {
    const source = read('../features/machine-sharing/MachineSharingScreen.tsx')
    expect(source).toContain('<AppPageHeader')
    expect(source).toContain('<BottomSheet')
    expect(source).toContain('inviteUrl')
    expect(source).toContain('<MachineInviteQr value={invite.inviteUrl}')
    expect(source).toContain('Share.share')
    expect(source).not.toContain("['view', 'use', 'full', 'admin']")
    expect(source).not.toContain('hasCapability')
    expect(source).not.toContain('granteePhone')
  })

  it('fails direct sharing navigation closed for grantees and removed machines', () => {
    const source = read('../features/machine-sharing/MachineSharingScreen.tsx')
    expect(source).toContain('getMachineSharingSurfaceState(machine')
    expect(source).toContain("surfaceState !== 'owner'")
    expect(source).toContain("t('machine_share_owner_only')")
    expect(source.indexOf("if (surfaceState !== 'owner')")).toBeLessThan(
      source.indexOf('const result = await machineAccountClient.createGrant'),
    )
  })

  it('keeps browser handoff lightweight while native and Desktop redemption stay explicit', () => {
    const nativeEntry = read('../features/machine-sharing/MachineInviteScreen.tsx')
    const desktopEntry = read('../features/machine-sharing/MachineInviteScreen.web.tsx')
    const source = read('../features/machine-sharing/MachineInviteAcceptanceScreen.tsx')
    const webSource = read('../features/machine-sharing/MachineInviteWebScreen.tsx')
    expect(nativeEntry).toContain("from './MachineInviteAcceptanceScreen'")
    expect(desktopEntry).toContain('isDesktopControlSurfaceEnabled')
    expect(desktopEntry).toContain('<MachineInviteWebScreen token={token} />')
    expect(desktopEntry).toContain('<Redirect href={{')
    expect(desktopEntry).toContain('<MachineInviteAcceptanceScreen token={token} />')
    expect(source).not.toContain("Platform.OS === 'web'")
    expect(source).not.toContain('machine_invite_open_app')
    expect(source).toContain('machineAccountClient.previewGrant(token)')
    expect(source).toContain('machineAccountClient.redeemGrant(token)')
    expect(source).not.toContain('authApi')
    expect(source).toContain('onPress={() => void accept()}')
    expect(source).toContain('<KeyboardAvoidingView')
    expect(source).toContain("behavior={Platform.OS === 'ios' ? 'padding' : undefined}")
    expect(source).toContain('<AppPageHeader')
    expect(source).toContain('maxFontSizeMultiplier={1.3}')
    expect(source).toContain('maxFontSizeMultiplier={1.6}')
    expect(webSource).toContain('machine_invite_open_app')
    expect(webSource).not.toContain('machineAccountClient')
    expect(webSource).not.toContain('useMachinesStore')
    expect(webSource).not.toContain("from '@shennian/shared'")
  })

  it('allows login to preserve only a validated machine invitation path', () => {
    const source = read('../features/auth/utils/redirect.ts')
    expect(source).toContain('MACHINE_INVITE_REDIRECT')
    expect(source).toContain('MACHINE_INVITE_REDIRECT.test(trimmed)')
  })

  it('does not claim official app-link domains in the public base manifest', () => {
    const appConfig = JSON.parse(read('../../app.json'))
    expect(appConfig.expo.android.intentFilters).toBeUndefined()
    expect(appConfig.expo.ios.associatedDomains).toBeUndefined()
  })
})
