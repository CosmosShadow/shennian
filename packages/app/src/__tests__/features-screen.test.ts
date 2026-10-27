// @vitest-environment happy-dom
// @arch docs/architecture/mobile-navigation.md
// @covers packages/app/src/features/mobile-navigation/FeaturesScreen.tsx
import React, { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  tabs: ['shennian', 'schedules', 'projects', 'features'],
  machines: [{ online: true }, { online: true }],
  push: vi.fn(),
}))
type Props = {
  children?: ReactNode
  testID?: string
  accessibilityLabel?: string
  onPress?: () => void
  style?: unknown
}
vi.mock('react-native', () => {
  const container = ({ children, testID, style }: Props) =>
    React.createElement(
      'div',
      {
        'data-testid': testID,
        style: Array.isArray(style) ? Object.assign({}, ...style) : style,
      },
      children,
    )
  return {
    View: container,
    Text: container,
    ScrollView: container,
    Pressable: ({ children, testID, onPress, accessibilityLabel }: Props) =>
      React.createElement(
        'button',
        {
          'data-testid': testID,
          onClick: onPress,
          'aria-label': accessibilityLabel,
        },
        children,
      ),
    StyleSheet: { create: (value: unknown) => value },
    useWindowDimensions: () => ({ width: 390, fontScale: 1 }),
  }
})
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: Props) => children,
}))
vi.mock('@expo/vector-icons/Ionicons', () => ({
  default: ({ name }: { name: string }) => React.createElement('i', { 'data-icon': name }),
}))
vi.mock('expo-router', () => ({ useRouter: () => ({ push: state.push }) }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { total?: number; online?: number }) =>
      values ? `${key}:${values.online ?? ''}:${values.total}` : key,
  }),
}))
vi.mock('../components/useMobileModuleBack', () => ({ useMobileModuleBack: () => undefined }))
vi.mock('../components/ConnectedAppPageHeader', () => ({
  AppPageHeader: ({ trailing }: { trailing: ReactNode }) => trailing,
  HeaderIconButton: ({ onPress, testID }: Props) =>
    React.createElement('button', { onClick: onPress, 'data-testid': testID }),
}))
vi.mock('../features/local-apps/useLocalAppShortcuts', () => ({
  useLocalAppShortcuts: () => ({ shortcuts: [] }),
}))
vi.mock('../features/remote-folders/useRemoteFolders', () => ({
  useRemoteFolders: () => ({ folders: [] }),
}))
vi.mock('../config/auth', () => ({ useAuthStore: () => 'unit-account' }))
vi.mock('../hooks/useTheme', () => ({
  useTheme: () => ({ colors: { successText: 'green', warning: 'orange', errorText: 'red' } }),
}))
vi.mock('@shennian/shared', () => ({ useMachinesStore: () => state.machines }))
vi.mock('../features/unread/useUnreadNavigation', () => ({
  useUnreadNavigation: () => ({ tabs: { rooms: 2 } }),
}))
vi.mock('../features/unread/UnreadCountBadge', () => ({ UnreadCountBadge: () => null }))
vi.mock('../features/rooms/components/RoomApprovalDot', () => ({ RoomApprovalDot: () => null }))
vi.mock('../features/mobile-navigation/useMobileUpgradeBadges', () => ({
  useMobileUpgradeBadges: () => ({}),
}))

import FeaturesScreen from '../features/mobile-navigation/FeaturesScreen'
let host: HTMLDivElement, root: Root
const find = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`)
async function render() {
  await act(async () => root.render(React.createElement(FeaturesScreen)))
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  state.tabs = ['shennian', 'schedules', 'projects', 'features']
  state.machines = [{ online: true }, { online: true }]
  state.push.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

it('uses a fixed list and keeps root tabs and computers out of the secondary directory', async () => {
  await render()
  expect(find('features-list')).not.toBeNull()
  for (const key of ['projects', 'contacts', 'computers']) expect(find(`feature-${key}`)).toBeNull()
  for (const key of ['recording', 'schedules', 'diary', 'folders', 'memory', 'scheduledTasks', 'content', 'english', 'plaza', 'agents']) expect(find(`feature-${key}`)).not.toBeNull()
  expect(find('features-customize-navigation')).toBeNull()
  expect(find('features-manage-navigation')).toBeNull()
  expect(find('features-layout-toggle')).toBeNull()
})
it('opens personal modules as details with explicit parameters', async () => {
  await render()
  await act(async () => find('feature-diary')!.click())
  expect(state.push).toHaveBeenCalledWith({ pathname: '/(main)/personal-workspace', params: { kind: 'diary', __mobileEntry: 'push' } })
  await act(async () => find('feature-recording')!.click())
  expect(state.push).toHaveBeenCalledWith({ pathname: '/(main)/personal-modules', params: { tab: 'recording', __mobileEntry: 'push' } })
})
