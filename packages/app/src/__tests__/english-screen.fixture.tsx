// @vitest-environment happy-dom
// @covers src/features/personal-modules/PersonalEnglishScreen.tsx
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  cache: vi.fn(),
  cached: vi.fn(),
  user: { id: 'owner' },
  clear: vi.fn(),
}))
vi.mock('react-native', () => ({
  View: ({ children }: any) => <div>{children}</div>,
  Text: ({ children }: any) => <span>{children}</span>,
  Pressable: ({ children, onPress, disabled, accessibilityLabel }: any) => (
    <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  TextInput: ({ value, onChangeText, accessibilityLabel }: any) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
  Switch: ({ value, onValueChange, accessibilityLabel, disabled }: any) => (
    <button
      aria-label={accessibilityLabel}
      disabled={disabled}
      onClick={() => onValueChange(!value)}
    >
      {String(value)}
    </button>
  ),
  ScrollView: ({ children }: any) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  RefreshControl: () => null,
  FlatList: ({ data, renderItem, ListEmptyComponent }: any) => (
    <div>
      {data.length
        ? data.map((item: any, index: number) => (
            <React.Fragment key={item.word}>{renderItem({ item, index })}</React.Fragment>
          ))
        : ListEmptyComponent}
    </div>
  ),
  AppState: { addEventListener: () => ({ remove() {} }) },
}))
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: any) => <div>{children}</div>,
}))
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => true }))
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: ({ name }: any) => <span>{name}</span> }))
vi.mock('../components/AppPageHeader', () => ({
  AppPageHeader: ({ title, trailing, onBack }: any) => (
    <header>
      <button onClick={onBack}>back</button>
      {title}
      {trailing}
    </header>
  ),
  HeaderIconButton: ({ label, onPress }: any) => <button onClick={onPress}>{label}</button>,
}))
vi.mock('../components/useMobileModuleBack', () => ({ useMobileModuleBack: () => vi.fn() }))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ colors: {} }) }))
vi.mock('../config/auth', () => {
  const hook = Object.assign((selector: any) => selector({ user: mocks.user }), {
    getState: () => ({ user: mocks.user }),
  })
  return { useAuthStore: hook }
})
vi.mock('../features/steward/ContextualStewardContext', () => ({
  useContextualSteward: () => null,
}))
vi.mock('../config/api', () => ({ authApi: mocks.api }))
vi.mock('../features/personal-modules/runtime', () => ({
  clearEnglishFeedback: mocks.clear,
  useRecordingState: () => ({ revision: 0 }),
  moduleStore: async () => ({ cached: mocks.cached, cache: mocks.cache }),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: any) =>
      key === 'personal_english_progress'
        ? `mastered ${values.mastered} learning ${values.learning}`
        : key,
  }),
}))
import PersonalEnglishScreen from '../features/personal-modules/PersonalEnglishScreen'
let container: HTMLDivElement, root: Root
const words = [
  { word: 'apple', state: 'partial', selfUseCount: 2, repeatCount: 1, promptCount: 1 },
  { word: 'water', state: 'mastered', selfUseCount: 3, repeatCount: 2, promptCount: 1 },
]
beforeEach(() => {
  vi.resetAllMocks()
  mocks.cached.mockResolvedValue(null)
  mocks.api.mockImplementation(async (path: string) =>
    path.endsWith('/items') ? { items: words } : { enabled: true, intervalMinutes: 5 },
  )
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
async function mount() {
  await act(async () => {
    root.render(React.createElement(PersonalEnglishScreen))
  })
}
async function click(text: string) {
  const button = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent === text || b.getAttribute('aria-label') === text,
  )
  expect(button, text).toBeTruthy()
  await act(async () => button!.click())
}
describe('simple English vocabulary entry', () => {
  it('renders only totals and vocabulary initially, opens detail and hides mastered action', async () => {
    await mount()
    expect(container.textContent).toContain('mastered 1 learning 1')
    expect(container.textContent).toContain('apple')
    expect(container.querySelector('input')).toBeNull()
    expect(container.textContent).not.toContain('personal_analyze')
    expect(container.textContent).not.toContain('personal_word_counts')
    expect(mocks.api.mock.calls.every(([path]) => path.includes('/english/'))).toBe(true)
    await click('apple, personal_word_partial')
    expect(container.textContent).toContain('personal_word_counts')
    await click('personal_mastered')
    expect(mocks.api).toHaveBeenCalledWith('/personal-modules/english/items', {
      method: 'PUT',
      body: JSON.stringify({ word: 'apple', state: 'mastered' }),
    })
    await click('back')
    await click('water, personal_word_mastered')
    expect(container.textContent).not.toContain('personal_mastered')
  })
  it('keeps add/settings/analysis behind the more entry, and reads cloud without recording', async () => {
    await mount()
    await click('personal_english_settings')
    expect(container.textContent).toContain('personal_interval')
    expect(container.querySelector('input')?.value).toBe('5')
    await click('personal_english_enabled')
    expect(mocks.api).toHaveBeenCalledWith('/personal-modules/english/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ enabled: false }),
    })
    expect(mocks.clear).toHaveBeenCalledOnce()
    await click('personal_analyze')
    expect(mocks.api).toHaveBeenCalledWith('/personal-modules/english/analyze', {
      method: 'POST',
      body: '{}',
    })
    await click('personal_add_word')
    expect(container.querySelector('input')?.getAttribute('aria-label')).toBe('personal_word')
  })
  it('shows retained offline vocabulary honestly and never turns failure into empty progress', async () => {
    mocks.cached.mockResolvedValue({ words, enabled: true, intervalMinutes: 5 })
    mocks.api.mockRejectedValue(new Error('offline'))
    await mount()
    expect(container.textContent).toContain('personal_english_offline')
    expect(container.textContent).toContain('apple')
    expect(container.textContent).toContain('mastered 1 learning 1')
    expect(container.textContent).not.toContain('personal_english_empty')
  })
})
