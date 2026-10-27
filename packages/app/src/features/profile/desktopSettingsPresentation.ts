// @arch docs/features/desktop-settings-information-architecture.md
// @test src/__tests__/desktop-settings-presentation.test.ts

export type ProfileSettingsPresentation = {
  accountPlacement: 'primary' | 'footer'
  accountInitiallyExpanded: boolean
  showUpdateBadgeOnAccount: boolean
}

export function getProfileSettingsPresentation(isDesktop: boolean): ProfileSettingsPresentation {
  return isDesktop
    ? {
        accountPlacement: 'primary',
        accountInitiallyExpanded: true,
        showUpdateBadgeOnAccount: false,
      }
    : {
        accountPlacement: 'footer',
        accountInitiallyExpanded: false,
        showUpdateBadgeOnAccount: true,
      }
}
