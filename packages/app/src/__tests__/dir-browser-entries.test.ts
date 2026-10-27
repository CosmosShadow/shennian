// @arch docs/architecture/compatibility.md
// @covers packages/app/src/components/DirBrowser.tsx
// @covers packages/app/src/utils/dirBrowserEntries.ts

import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FsEntry } from '@shennian/wire'
import {
  DIR_BROWSER_WEB_PAGE_SIZE,
  filterDirBrowserEntries,
  getVisibleDirBrowserEntries,
} from '../utils/dirBrowserEntries'

function makeDirectory(index: number): FsEntry {
  const name = `folder-${String(index).padStart(3, '0')}`
  return { name, path: `/home/test/${name}`, isDir: true }
}

describe('DirBrowser entries', () => {
  it('keeps directories after the first ten available to the picker', () => {
    const entries = Array.from({ length: 25 }, (_, index) => makeDirectory(index + 1))

    const filtered = filterDirBrowserEntries(entries, '')

    expect(filtered).toHaveLength(25)
    expect(filtered[10]?.name).toBe('folder-011')
    expect(getVisibleDirBrowserEntries(filtered, DIR_BROWSER_WEB_PAGE_SIZE)).toHaveLength(25)
  })

  it('searches the complete candidate set instead of only the rendered page', () => {
    const entries = Array.from({ length: 150 }, (_, index) => makeDirectory(index + 1))

    const filtered = filterDirBrowserEntries(entries, 'folder-149')

    expect(filtered.map((entry) => entry.name)).toEqual(['folder-149'])
  })

  it('filters files and hidden directories while keeping deterministic ordering', () => {
    const entries: FsEntry[] = [
      { name: 'Zulu', path: '/Zulu', isDir: true },
      { name: '.secret', path: '/.secret', isDir: true },
      { name: 'notes.txt', path: '/notes.txt', isDir: false },
      { name: 'alpha', path: '/alpha', isDir: true },
    ]

    expect(filterDirBrowserEntries(entries, '').map((entry) => entry.name)).toEqual([
      'alpha',
      'Zulu',
    ])
  })

  it('uses a non-virtualized web scroll surface with explicit incremental loading', () => {
    const source = readFileSync('packages/app/src/components/DirBrowser.tsx', 'utf8')

    expect(source).toContain("Platform.OS === 'web'")
    expect(source).toContain('<ScrollView')
    expect(source).toContain('getVisibleDirBrowserEntries(filteredDirs, visibleCount)')
    expect(source).toContain("t('load_more_dirs'")
    expect(source).toContain('data={filteredDirs}')
  })
})

// @arch docs/architecture/compatibility.md
// @covers packages/app/src/components/DirBrowser.tsx

import {
  buildDirBrowserLsParams,
  canNavigateUpForDirBrowser,
  getParentForDirBrowser,
} from '../utils/dirBrowserMode'

describe('DirBrowser mode semantics', () => {
  it('lets session browsing move above the initial workDir for cross-project references', () => {
    expect(buildDirBrowserLsParams('session', '/Users/alice/project/src', '/Users/alice/project')).toEqual({
      path: '/Users/alice/project/src',
    })
    expect(canNavigateUpForDirBrowser('session', '/Users/alice/project', '/Users/alice/project')).toBe(true)
    expect(getParentForDirBrowser('session', '/Users/alice/project', '/Users/alice/project')).toBe('/Users/alice')
  })

  it('lets workDirPicker browse outside the initial path and relies on session creation authorization', () => {
    expect(buildDirBrowserLsParams('workDirPicker', '/Users/alice/project', '/Users/alice/project')).toEqual({
      path: '/Users/alice/project',
    })
    expect(canNavigateUpForDirBrowser('workDirPicker', '/Users/alice/project', '/Users/alice/project')).toBe(true)
    expect(getParentForDirBrowser('workDirPicker', '/Users/alice/project', '/Users/alice/project')).toBe('/Users/alice')
  })

  it('does not lock Linux root-user workDirPicker navigation to /root', () => {
    expect(buildDirBrowserLsParams('workDirPicker', '~', '/root')).toEqual({
      path: '~',
    })
    expect(buildDirBrowserLsParams('workDirPicker', '/var/www', '/root')).toEqual({
      path: '/var/www',
    })
    expect(canNavigateUpForDirBrowser('workDirPicker', '/root', '/root')).toBe(true)
    expect(getParentForDirBrowser('workDirPicker', '/root', '/root')).toBe('/')
  })
})

// @arch docs/architecture/remote-folders.md
// @covers packages/app/src/components/DirBrowser.tsx
import { isValidElement, type ReactElement, type ReactNode } from 'react'
let index = 0
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => [index++ === 3 ? false : initial, vi.fn()],
  useEffect: vi.fn(), useCallback: (fn: unknown) => fn,
  useMemo: (fn: () => unknown) => fn(), useRef: (current: unknown) => ({ current }),
}))
vi.mock('react-native', () => ({
  View: 'View', Text: 'Text', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator', Modal: 'Modal', FlatList: 'FlatList', ScrollView: 'ScrollView', Platform: { OS: 'ios' },
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 0.5 },
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@expo/vector-icons/Feather', () => ({ default: 'Icon' }))
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }))
vi.mock('../components/AppPageHeader', () => ({ AppPageHeader: 'AppPageHeader' }))
vi.mock('../features/account-runtime/accountRuntime', () => ({ accountRuntime: {} }))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ colors: { bg: '#fff' } }) }))
import { DirBrowser } from '../components/DirBrowser'
function nodes(node: ReactNode): Array<ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap(nodes)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...nodes(node.props.children as ReactNode)]
}
beforeEach(() => { index = 0 })
it('renders the new directory route inline, without presenting a native modal', () => {
  const tree = nodes(DirBrowser({ machineId: 'unit', initialPath: '/unit', inline: true, onSelect: vi.fn(), onClose: vi.fn() }))
  expect(tree[0]!.type).toBe('View')
  expect(tree.some(node => node.type === 'Modal')).toBe(false)
})
it('lets the page own the async save lifecycle instead of closing before persistence', () => {
  const select = vi.fn(), close = vi.fn()
  const tree = nodes(DirBrowser({ machineId: 'unit', initialPath: '/unit', inline: true, closeOnSelect: false, onSelect: select, onClose: close }))
  const button = tree.find(node => node.props.accessibilityLabel === 'select_this_dir')!
  expect(button.props.disabled).toBe(false)
  ;(button.props.onPress as () => void)()
  expect(select).toHaveBeenCalledWith('/unit')
  expect(close).not.toHaveBeenCalled()
})
it('retains the existing modal and auto-close behavior for other directory pickers', () => {
  const select = vi.fn(), close = vi.fn()
  const tree = nodes(DirBrowser({ machineId: 'unit', initialPath: '/unit', onSelect: select, onClose: close }))
  expect(tree[0]!.type).toBe('Modal')
  ;(tree.find(node => node.props.accessibilityLabel === 'select_this_dir')!.props.onPress as () => void)()
  expect(select).toHaveBeenCalledWith('/unit')
  expect(close).toHaveBeenCalledOnce()
})
