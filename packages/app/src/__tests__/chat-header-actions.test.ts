import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
// @arch docs/architecture/app/modular-features.md#聊天-feature
// @covers packages/app/src/features/chat/utils/headerActions.ts

import { describe, expect, it } from 'vitest'
import { getChatHeaderActionIds } from '../features/chat/utils/headerActions'

describe('chat header actions', () => {
  it('keeps file browser out of the top bar and leaves details as the primary trailing action', () => {
    expect(getChatHeaderActionIds()).toEqual(['details'])
  })

  it('does not retain the retired Desktop focus-mode action', () => {
    expect(getChatHeaderActionIds()).not.toContain('focus-mode')
  })

  it('does not offer conversation configuration on a Worker sub-conversation', () => {
    expect(getChatHeaderActionIds('sess_worker_123')).toEqual([])
    expect(getChatHeaderActionIds('sess_regular_123')).toEqual(['details'])
  })
})


// @covers packages/app/src/features/chat/components/ChatHeader.tsx
describe('chat header presentation', () => {
  it('uses a standard left-aligned title without persistent identity metadata', () => {
    const header = readFileSync(resolve(__dirname, '../features/chat/components/ChatHeader.tsx'), 'utf8')
    expect(header).toContain('fontSize: 17')
    expect(header).toContain('lineHeight: 22')
    expect(header).toContain("fontWeight: '600'")
    expect(header).toContain("textAlign: 'left'")
    expect(header).not.toContain('styles.mobileHeaderCenter')
    expect(header).toContain('ellipsizeMode="tail"')
    expect(header).not.toContain('getProjectDirName')
    expect(header).not.toContain('{subtitle}')
    expect(header).not.toContain('connectionLabel')
    expect(header).not.toContain('statusLabel')
    expect(header).toContain('<HeaderIconButton')
  })
})
