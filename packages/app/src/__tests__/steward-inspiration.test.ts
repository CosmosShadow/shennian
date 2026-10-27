// @vitest-environment happy-dom
// @covers packages/app/src/features/steward/useStewardInspiration.tsx
// @covers packages/app/src/features/steward/components/StewardInspirationSheet.tsx

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enInspiration } from '../../../../open-source/packages/shared/src/i18n/en-inspiration'

type Layout = { nativeEvent: { layout: { x: number; y: number; height: number } } }
type ScrollEvent = { nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } } }
const state = vi.hoisted(() => ({ values: new Map<string, string>(), failWrite: false, closeSide: '',
  layouts: new Map<string, (event: Layout) => void>(), bodyScrolls: [] as { y: number; animated: boolean }[],
  scrollProps: {} as { onScroll?: (event: ScrollEvent) => void; onScrollBeginDrag?: () => void },
}))
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: vi.fn(async (key: string) => state.values.get(key) ?? null),
  setItem: async (key: string, value: string) => {
    if (state.failWrite) throw new Error('write_failed')
    state.values.set(key, value)
  },
} }))
vi.mock('react-native', () => ({
  Keyboard: { dismiss: () => {} },
  useWindowDimensions: () => ({ width: 390, fontScale: 1 }),
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  View: ({ children, testID, onLayout }: { children: React.ReactNode; testID?: string; onLayout?: (event: Layout) => void }) => {
    if (testID && onLayout) state.layouts.set(testID, onLayout)
    return React.createElement('div', { 'data-testid': testID }, children)
  },
  ScrollView: ({ children, ref }: { children: React.ReactNode; ref: React.Ref<unknown> }) => {
    React.useImperativeHandle(ref, () => ({ scrollTo: () => {} }))
    return React.createElement('div', null, children)
  },
  Text: ({ children }: { children: React.ReactNode }) => React.createElement('span', null, children),
  Pressable: ({ children, onPress, disabled, testID, onLayout, accessibilityState }: { children: React.ReactNode; onPress: () => void; disabled: boolean; testID: string; onLayout?: (event: Layout) => void; accessibilityState?: { selected?: boolean } }) => {
    if (onLayout) state.layouts.set(testID, onLayout)
    return React.createElement('button', { onClick: onPress, disabled, 'data-testid': testID, 'aria-selected': accessibilityState?.selected }, children)
  },
}))
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: () => null }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => enInspiration[key as keyof typeof enInspiration] ?? key }) }))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ colors: {} }) }))
vi.mock('../components/BottomSheet', () => ({ default: ({ isOpen, children, headerRight, onClose, closeButtonSide, bodyScrollRef, bodyScrollProps }: {
  isOpen: boolean; children: React.ReactNode; headerRight: React.ReactNode; onClose: () => void; closeButtonSide: string
  bodyScrollRef: React.Ref<unknown>; bodyScrollProps: typeof state.scrollProps
}) => {
  React.useImperativeHandle(bodyScrollRef, () => ({ scrollTo: (position: { y: number; animated: boolean }) => state.bodyScrolls.push(position) }))
  state.closeSide = closeButtonSide; state.scrollProps = bodyScrollProps
  return isOpen ? React.createElement('section', null, headerRight, React.createElement('button', { onClick: onClose, 'data-testid': 'close-sheet' }, 'Close'), children) : null
} }))

import { useStewardInspiration } from '../features/steward/useStewardInspiration'
import AsyncStorage from '@react-native-async-storage/async-storage'

type Options = Parameters<typeof useStewardInspiration>[0]
let root: Root
let host: HTMLDivElement
let options: Options
function Harness() {
  const result = useStewardInspiration(options)
  return React.createElement('div', null,
    React.createElement('button', { onClick: result.openInspiration, 'data-testid': 'plus-menu-entry' }, 'Get inspired'),
    result.inspirationUi)
}
async function render() { await act(async () => { root.render(React.createElement(Harness)); await Promise.resolve() }) }
async function click(id: string) {
  const element = host.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)
  expect(element, id).not.toBeNull()
  await act(async () => { element!.click(); await Promise.resolve() })
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  state.values.clear(); state.failWrite = false; state.layouts.clear(); state.bodyScrolls.length = 0
  vi.mocked(AsyncStorage.getItem).mockReset().mockImplementation(async key => state.values.get(key) ?? null)
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  options = { enabled: true, accountId: 'unit-a', input: '', attachments: 0, sending: false,
    uploading: false, editing: false, voicePhase: 'idle', ready: true,
    closeMenu: vi.fn(), send: vi.fn(async () => true), showError: vi.fn() }
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

describe('inspiration isolated UI behavior (no Agent or network)', () => {
  it('never flashes a hidden shortcut while reading preferences on mount or account switch', async () => {
    let finish!: (value: string | null) => void
    vi.mocked(AsyncStorage.getItem).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    await render()
    expect(host.querySelector('[data-testid="steward-inspiration-open"]')).toBeNull()
    await act(async () => { finish('false') })
    expect(host.querySelector('[data-testid="steward-inspiration-open"]')).toBeNull()
    // A new account defaults to visible only after its read has completed.
    options = { ...options, accountId: 'unit-b' }; await render()
    expect(host.querySelector('[data-testid="steward-inspiration-open"]')).toBeNull()
    await act(async () => { finish(null) })
    expect(host.querySelector('[data-testid="steward-inspiration-open"]')).not.toBeNull()
    options = { ...options, accountId: 'unit-a' }; await render()
    expect(host.querySelector('[data-testid="steward-inspiration-open"]')).toBeNull()
    await act(async () => { finish('false') })
    expect(host.querySelector('[data-testid="steward-inspiration-open"]')).toBeNull()
    await click('plus-menu-entry')
    expect(host.textContent).toContain(enInspiration.inspiration_show_short)
  })
  it('uses tags as scroll anchors without filtering, and follows manual scrolling back and forth', async () => {
    await render(); await click('plus-menu-entry')
    const ids = ['getting_started', 'work', 'apps', 'learning']
    await act(async () => {
      state.layouts.get('inspiration-tags')!({ nativeEvent: { layout: { x: 0, y: 0, height: 60 } } })
      ids.forEach((id, index) => state.layouts.get(`inspiration-section-${id}`)!({ nativeEvent: { layout: { x: 0, y: 60 + index * 600, height: 600 } } }))
    })
    await click('inspiration-tag-apps')
    expect(state.bodyScrolls.at(-1)).toEqual({ y: 1200, animated: true })
    expect(host.querySelector('[data-testid="inspiration-tag-apps"]')?.getAttribute('aria-selected')).toBe('true')
    await act(async () => state.scrollProps.onScroll!({ nativeEvent: { contentOffset: { y: 600 }, contentSize: { height: 3000 }, layoutMeasurement: { height: 600 } } }))
    expect(host.querySelector('[data-testid="inspiration-tag-apps"]')?.getAttribute('aria-selected')).toBe('true')
    // The top and bottom groups still exist: tags never filter the document.
    expect(host.querySelector('[data-testid="steward-inspiration-group"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="steward-inspiration-meeting"]')).not.toBeNull()
    await act(async () => {
      state.scrollProps.onScrollBeginDrag!()
      state.scrollProps.onScroll!({ nativeEvent: { contentOffset: { y: 1800 }, contentSize: { height: 3000 }, layoutMeasurement: { height: 600 } } })
    })
    expect(host.querySelector('[data-testid="inspiration-tag-learning"]')?.getAttribute('aria-selected')).toBe('true')
    await act(async () => state.scrollProps.onScroll!({ nativeEvent: { contentOffset: { y: 0 }, contentSize: { height: 3000 }, layoutMeasurement: { height: 600 } } }))
    expect(host.querySelector('[data-testid="inspiration-tag-getting_started"]')?.getAttribute('aria-selected')).toBe('true')
  })
  it('uses a left close control and text-only cards without the instructional tagline', async () => {
    await render(); await click('plus-menu-entry')
    expect(state.closeSide).toBe('left')
    expect(host.textContent).not.toContain(enInspiration.inspiration_hint)
    const card = host.querySelector('[data-testid="steward-inspiration-group"]')
    expect(card?.textContent).toBe(enInspiration.inspiration_group_title + enInspiration.inspiration_group_description)
  })
  it('hides only the shortcut, retains menu access, restores it and remembers the preference', async () => {
    await render(); await click('steward-inspiration-open')
    expect(host.querySelectorAll('[data-testid^="steward-inspiration-"]').length).toBeGreaterThan(40)
    await click('steward-inspiration-toggle')
    expect(host.querySelector('[data-testid="steward-inspiration-open"]')).toBeNull()
    expect(host.textContent).toContain(enInspiration.inspiration_show_short)
    await click('close-sheet'); await click('plus-menu-entry')
    expect(host.textContent).toContain(enInspiration.inspiration_show_short)
    await click('steward-inspiration-toggle')
    expect(host.querySelector('[data-testid="steward-inspiration-open"]')).not.toBeNull()
    expect([...state.values.values()]).toEqual(['true'])
  })
  it('sends exactly the chosen prompt, closing only when the ordinary send path retains it', async () => {
    await render(); await click('plus-menu-entry'); await click('steward-inspiration-ai_schedule')
    expect(options.send).toHaveBeenCalledExactlyOnceWith({ textOverride: expect.stringContaining(enInspiration.inspiration_ai_schedule_prompt) })
    expect(options.send).toHaveBeenCalledWith({ textOverride: expect.stringContaining('shennian guide schedules') })
    expect(host.querySelector('section')).toBeNull()
  })
  it('does not close on a rejected send, such as cancelled AI consent', async () => {
    options.send = vi.fn(async () => false)
    await render(); await click('plus-menu-entry'); await click('steward-inspiration-group')
    expect(host.querySelector('section')).not.toBeNull()
    expect(host.textContent).toContain(enInspiration.inspiration_not_sent)
  })
  it('leaves drafts and attachments untouched and blocks recording/uploading', async () => {
    for (const change of [{ input: 'keep this' }, { attachments: 1 }, { voicePhase: 'listening' }, { uploading: true }]) {
      options = { ...options, input: '', attachments: 0, voicePhase: 'idle', uploading: false, ...change }
      await render(); await click('plus-menu-entry'); await click('steward-inspiration-group')
      expect(options.send).not.toHaveBeenCalled()
    }
  })
  it('does not pretend a visibility write succeeded and shows an error inside the sheet', async () => {
    state.failWrite = true
    await render(); await click('plus-menu-entry'); await click('steward-inspiration-toggle')
    expect(host.querySelector('[data-testid="steward-inspiration-open"]')).not.toBeNull()
    expect(host.textContent).toContain(enInspiration.inspiration_save_failed)
  })
  it('isolates visibility when switching accounts', async () => {
    await render(); await click('plus-menu-entry'); await click('steward-inspiration-toggle')
    options = { ...options, accountId: 'unit-b' }; await render()
    expect(host.querySelector('[data-testid="steward-inspiration-open"]')).not.toBeNull()
    options = { ...options, accountId: 'unit-a' }; await render()
    expect(host.querySelector('[data-testid="steward-inspiration-open"]')).toBeNull()
  })
  it('blocks duplicate taps while the chosen prompt is being submitted', async () => {
    let finish!: (accepted: boolean) => void
    options.send = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve }))
    await render(); await click('plus-menu-entry'); await click('steward-inspiration-group'); await click('steward-inspiration-agent')
    expect(options.send).toHaveBeenCalledTimes(1)
    await act(async () => { finish(true) })
  })
})

// @covers packages/app/src/features/steward/stewardInspiration.ts
// @covers packages/app/src/features/steward/components/StewardInspirationSheet.tsx
// @covers packages/app/src/features/steward/inspirationPreferences.ts
// @covers packages/app/src/features/steward/useStewardInspiration.tsx
// @covers open-source/packages/shared/src/i18n/zh-inspiration.ts
// @covers open-source/packages/shared/src/i18n/en-inspiration.ts

import { inspirationSendBlock, readInspirationVisible, writeInspirationVisible } from '../features/steward/inspirationPreferences'
import { mobileFeatures } from '../components/mobileFeatureRegistry'
import { stewardInspirationCards, stewardInspirationIds, stewardInspirationCatalog } from '../features/steward/stewardInspiration'
import { zhInspiration } from '../../../../open-source/packages/shared/src/i18n/zh-inspiration'
import { featureGuides } from '../../../../open-source/packages/cli/src/guides/catalog'

describe('steward product inspiration catalog', () => {
  it('covers the product feature directory, with unique starters and no filtering', () => {
    expect(stewardInspirationIds).toHaveLength(40)
    expect(stewardInspirationIds).toEqual(expect.arrayContaining(['group', 'agent', 'computer', 'folder_shortcut', 'ai_schedule', 'notification', 'homework', 'review']))
    const covered = new Set<string>(stewardInspirationCatalog.map(card => card.feature))
    for (const feature of mobileFeatures) expect(covered.has(feature.key), feature.key).toBe(true)
    expect(new Set(stewardInspirationIds).size).toBe(stewardInspirationIds.length)
  })

  for (const [language, messages] of [['zh', zhInspiration], ['en', enInspiration]] as const) {
    it(`provides a complete readable card and an actual chat prompt in ${language}`, () => {
      const cards = stewardInspirationCards(key => messages[key as keyof typeof messages])
      expect(cards).toHaveLength(40)
      for (const card of cards) {
        expect(card.icon.length).toBeGreaterThan(0)
        expect(card.title.length).toBeGreaterThan(0)
        expect(card.description.length).toBeGreaterThan(0)
        expect(card.prompt.length).toBeGreaterThan(card.title.length)
        expect(card.prompt).not.toContain('inspiration_')
        expect(card.prompt).toContain(`shennian guide ${card.guide}`)
      }
    })
  }

  it('links every starter to a real bundled Client guide, including local app lifecycle starters', () => {
    const topics = new Set(featureGuides.map(guide => guide.id))
    for (const card of stewardInspirationCatalog) expect(topics.has(card.guide), card.id).toBe(true)
    expect(stewardInspirationIds).toEqual(expect.arrayContaining(['app_tracker', 'app_fix', 'app_update', 'app_export']))
  })

  it('keeps the same translation keys in both languages', () => {
    expect(Object.keys(enInspiration).sort()).toEqual(Object.keys(zhInspiration).sort())
  })

  it('does not assume private records or successful actions, and uses standalone Client pairing', () => {
    expect(zhInspiration.inspiration_review_prompt).toContain('不要编造')
    expect(enInspiration.inspiration_review_prompt).toContain('instead of inventing')
    expect(zhInspiration.inspiration_agent_prompt).toContain('不要假装')
    expect(enInspiration.inspiration_agent_prompt).toContain('do not pretend')
    expect(zhInspiration.inspiration_computer_prompt).toContain('独立 Shennian Client')
    expect(enInspiration.inspiration_computer_prompt).toContain('standalone Shennian Client')
  })
})


describe('inspiration visibility and safe sending', () => {
  function storage() {
    const values = new Map<string, string>()
    return { values, getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => { values.set(key, value) } }
  }
  it('shows by default, persists hide/show, and isolates accounts', async () => {
    const store = storage()
    expect(await readInspirationVisible(store, 'a')).toBe(true)
    await writeInspirationVisible(store, 'a', false)
    expect(await readInspirationVisible(store, 'a')).toBe(false)
    expect(await readInspirationVisible(store, 'b')).toBe(true)
    await writeInspirationVisible(store, 'a', true)
    expect(await readInspirationVisible(store, 'a')).toBe(true)
  })
  it('recovers from corrupt/failed reads and propagates write failure instead of pretending to save', async () => {
    const store = storage()
    await writeInspirationVisible(store, 'a', false)
    const key = [...store.values.keys()][0]
    store.values.set(key, 'broken')
    expect(await readInspirationVisible(store, 'a')).toBe(true)
    const failed = { getItem: async () => { throw new Error('read') }, setItem: async () => { throw new Error('write') } }
    expect(await readInspirationVisible(failed, 'a')).toBe(true)
    await expect(writeInspirationVisible(failed, 'a', false)).rejects.toThrow('write')
    await expect(writeInspirationVisible(store, '', false)).rejects.toThrow('inspiration_account_required')
  })
  const ready = { input: '', attachments: 0, sending: false, uploading: false, editing: false, voicePhase: 'idle', ready: true }
  it('allows only a clean, ready composer, preserving pending text and attachments', () => {
    expect(inspirationSendBlock(ready)).toBeNull()
    for (const state of [{ input: 'unsent draft' }, { attachments: 1 }, { editing: true }]) {
      expect(inspirationSendBlock({ ...ready, ...state })).toBe('inspiration_finish_draft')
    }
    for (const state of [{ sending: true }, { uploading: true }, { voicePhase: 'listening' }, { voicePhase: 'refining' }, { ready: false }]) {
      expect(inspirationSendBlock({ ...ready, ...state })).toBe('inspiration_unavailable')
    }
  })
  it('distinguishes a managed AI schedule from a phone reminder and keeps a folder shortcut read-only', () => {
    expect(zhInspiration.inspiration_ai_schedule_prompt).toContain('有效调度上下文')
    expect(zhInspiration.inspiration_notification_prompt).toContain('手机通知权限')
    expect(zhInspiration.inspiration_folder_shortcut_prompt).toContain('不是复制或上传')
    expect(enInspiration.inspiration_folder_shortcut_prompt).toContain('not a copy or upload')
  })
})
