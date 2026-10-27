// @covers packages/app/src/features/chat/components/ComposerActionMenu.tsx
// @covers packages/app/src/features/chat/components/ChatComposer.tsx
// @covers packages/app/src/features/chat/hooks/useChatComposerActions.tsx
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => readFileSync(resolve(__dirname, file), 'utf8')

describe('native composer action menu layout', () => {
  it('lays all available actions out equally without a minimum tile width or a scroll strip', () => {
    const menu = read('../features/chat/components/ComposerActionMenu.tsx')
    expect(menu).toContain('flexBasis: 0')
    expect(menu).toContain('minWidth: 0')
    expect(menu).toContain("alignSelf: 'stretch'")
    expect(menu).toContain('size={22}')
    expect(menu).toContain('color: web ? colors.text : colors.textSecondary')
    expect(menu).toContain('numberOfLines={web ? 1 : undefined}')
    expect(menu).not.toContain('horizontal={true}')
  })

  it('places the native five-action menu above the input at full available width', () => {
    const composer = read('../features/chat/components/ChatComposer.tsx')
    const actions = read('../features/chat/hooks/useChatComposerActions.tsx')
    expect(composer).toContain("Platform.OS !== 'web' && contextMenu")
    expect(composer).toContain('marginHorizontal: -16')
    for (const id of ['media', 'camera', 'file', 'browser', 'capabilities']) {
      expect(actions).toContain(`id: '${id}'`)
    }
    for (const label of ['photos', 'files', 'machine_files', 'skill']) {
      expect(actions).toContain(`label: t('composer_menu_${label}')`)
    }
  })
})
