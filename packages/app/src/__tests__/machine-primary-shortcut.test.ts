// @covers packages/app/src/features/machines/screens/MachinesScreen.tsx
// @covers packages/app/src/features/machines/components/MachineNameRow.tsx
// @covers packages/app/src/features/machines/components/MachineCard.tsx
import { beforeEach, expect, it, vi } from 'vitest'
import { isValidElement, type ReactNode, type ReactElement } from 'react'
import type { Machine } from '@shennian/wire'
const state = vi.hoisted(() => ({ navigate: vi.fn(), add: vi.fn(), refresh: vi.fn() }))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (value: unknown) => [value, vi.fn()], useCallback: (fn: unknown) => fn,
  useMemo: (fn: () => unknown) => fn(), useRef: (value: unknown) => ({ current: value }),
}))
vi.mock('react-native', () => ({ Platform: { OS: 'ios', select: (values: Record<string, unknown>) => values.ios }, StyleSheet: { create: (s: unknown) => s },
  ActivityIndicator: 'ActivityIndicator', KeyboardAvoidingView: 'KeyboardAvoidingView', Pressable: 'Pressable', RefreshControl: 'RefreshControl', ScrollView: 'ScrollView', Text: 'Text', View: 'View' }))
vi.mock('expo-router', () => ({ useFocusEffect: vi.fn(), useRouter: () => ({ navigate: state.navigate }) }))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Icon' }))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ colors: { text: '#111', textSecondary: '#666' }, isDark: false }) }))
vi.mock('../components/useMobileModuleBack', () => ({ useMobileModuleBack: () => vi.fn() }))
vi.mock('../components/AppPageHeader', () => ({ AppPageHeader: 'Header', HeaderIconButton: 'HeaderButton' }))
vi.mock('../hooks/useAppConnectivityStatus', () => ({ useAppConnectivityStatus: () => ({}) }))
vi.mock('../features/machines/machineAccountClient', () => ({ machineAccountClient: { listMachines: vi.fn() } }))
vi.mock('../features/personal-workspace/usePrimaryMachine', () => ({ usePrimaryMachine: () => ({ record: { machine: { id: 'mac' } }, loading: false, refresh: state.refresh }) }))
vi.mock('../features/machines/components/FirstMachineSetupPanel', () => ({ FirstMachineSetupPanel: 'Setup' }))
vi.mock('../features/machines/components/MachineListStateNotice', () => ({ MachineListStateNotice: 'Notice' }))
vi.mock('../features/machines/hooks/useMachineCardActions', () => ({ useMachineCardActions: () => ({ editing: false }) }))
vi.mock('../features/machines/components/VersionBadge', () => ({ VersionBadge: 'Version' }))
vi.mock('@shennian/shared', () => ({
  useMachinesStore: (select: (s: unknown) => unknown) => select({ machines: [{ id: 'mac', name: 'Mac', online: true, os: 'darwin', agentList: [] }], remoteResolved: true, loading: false }),
  useSheetsStore: (select: (s: unknown) => unknown) => select({ openAddMachine: state.add }),
}))
import MachinesScreen from '../features/machines/screens/MachinesScreen'
import { MachineCard } from '../features/machines/components/MachineCard'
import { MachineNameRow } from '../features/machines/components/MachineNameRow'
function nodes(node: ReactNode): ReactElement<Record<string, any>>[] {
  if (Array.isArray(node)) return node.flatMap(nodes)
  if (!isValidElement<Record<string, any>>(node)) return []
  return [node, ...nodes(node.props.children)]
}
beforeEach(() => vi.clearAllMocks())
it('keeps only add in the header; a row opens details and its shortcut opens the existing settings page', () => {
  const screen = nodes(MachinesScreen())
  const header = screen.find(n => n.type === 'Header')!
  const buttons = nodes(header.props.trailing)
  expect(buttons).toHaveLength(1)
  expect(buttons[0]!.props.icon).toBe('add')
  buttons[0]!.props.onPress()
  expect(state.add).toHaveBeenCalledOnce()
  const card = screen.find(n => n.type === MachineCard)!
  expect(card.props.primary).toBe(true)
  card.props.onExpand()
  expect(state.navigate).toHaveBeenLastCalledWith('/(main)/machine/mac')
  card.props.onPrimaryPress()
  expect(state.navigate).toHaveBeenLastCalledWith('/(main)/primary-computer')
})
it('enlarges the badge and prevents a shortcut tap from also opening computer details', () => {
  const shortcut = vi.fn()
  const props = { machine: { id: 'mac', name: 'Mac', os: 'darwin', online: true } as Machine,
    actions: { editing: false } as Parameters<typeof MachineNameRow>[0]['actions'], compact: true, primary: true, onPrimaryPress: shortcut }
  const row = nodes(MachineNameRow(props))
  const badge = row.find(n => n.props.accessibilityLabel === 'personal_primary_manage')!
  const event = { stopPropagation: vi.fn() }
  badge.props.onPress(event)
  expect(event.stopPropagation).toHaveBeenCalledOnce()
  expect(shortcut).toHaveBeenCalledOnce()
  expect(badge.props.style.minHeight).toBeGreaterThanOrEqual(48)
  expect(nodes(badge)[1]!.props.style[0].fontSize).toBe(15)
  expect(nodes(MachineNameRow({ ...props, primary: false })).some(n => n.props.accessibilityLabel === 'personal_primary_manage')).toBe(false)
})
it('exposes the shortcut as an accessibility action on the computer row', () => {
  const shortcut = vi.fn()
  const card = MachineCard({ machine: { id: 'mac', name: 'Mac', os: 'darwin', agentList: [] } as unknown as Machine, compact: true, mode: 'manage', primary: true, onPrimaryPress: shortcut, onExpand: vi.fn() })
  expect(card.props.accessibilityActions).toEqual([{ name: 'changePrimary', label: 'personal_primary_manage' }])
  card.props.onAccessibilityAction({ nativeEvent: { actionName: 'changePrimary' } })
  expect(shortcut).toHaveBeenCalledOnce()
})
