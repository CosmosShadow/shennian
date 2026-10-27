// @arch docs/architecture/cli/model-discovery.md
// @test src/__tests__/composer-actions.test.ts

export type ComposerPlatform = 'web' | 'native'

export type ComposerActionId =
  | 'attach'
  | 'plus'
  | 'pick-file'
  | 'pick-image'
  | 'file-drawer'
  | 'model'

export function getComposerActionIds(
  _platform: ComposerPlatform,
  canOpenModelSelector: boolean,
): ComposerActionId[] {
  const baseActions: ComposerActionId[] = ['plus']

  return canOpenModelSelector ? [...baseActions, 'model'] : baseActions
}
