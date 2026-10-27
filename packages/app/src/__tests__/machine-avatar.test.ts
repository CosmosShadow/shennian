// @covers packages/app/src/features/machines/components/MachineAvatar.tsx
// @covers packages/app/src/features/machines/utils/machinePlatformAppearance.ts
// @covers packages/app/src/features/machines/components/MachineNameRow.tsx
import { beforeEach, expect, it, vi } from 'vitest'
import { isValidElement, type ReactNode, type ReactElement } from 'react'
import type { Machine } from '@shennian/wire'
const theme = vi.hoisted(() => ({ isDark: false, colors: { success: 'green', warning: 'orange', textTertiary: 'gray', bg: 'white' } }))
vi.mock('react-native', () => ({ View: 'View', Text: 'Text', Pressable: 'Pressable', Platform: { OS: 'ios', select: (v: Record<string, unknown>) => v.ios }, StyleSheet: { create: (s: unknown) => s } }))
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Icon' }))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => theme }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../features/machines/components/VersionBadge', () => ({ VersionBadge: 'Version' }))
import { MachineAvatar } from '../features/machines/components/MachineAvatar'
import { MachineNameRow } from '../features/machines/components/MachineNameRow'
import { machineStyles } from '../features/machines/styles'
import { machinePlatformAppearance } from '../features/machines/utils/machinePlatformAppearance'
beforeEach(() => { theme.isDark = false })
it.each(['darwin', 'macOS', 'win32', 'Windows', 'linux', 'unknown'])('uses the same platform appearance in both themes for %s', os => {
  for (const isDark of [false, true]) {
    theme.isDark = isDark
    const result = MachineAvatar({ machine: { os, online: true } })
    const appearance = machinePlatformAppearance(os, isDark)
    expect(result.props.style[0]).toMatchObject({ width: 44, height: 44, borderRadius: 12, flexShrink: 0 })
    expect(result.props.style[2]).toMatchObject({ backgroundColor: appearance.background, opacity: 1 })
    const [icon, status] = result.props.children
    expect(icon.props).toMatchObject({ name: appearance.icon, color: appearance.color, size: 24 })
    expect(status.props.style[1]).toMatchObject({ backgroundColor: 'green', borderColor: 'white' })
  }
})
it('distinguishes offline and paused states, while retaining the same icon shape', () => {
  const offline = MachineAvatar({ machine: { os: 'darwin', online: false } })
  expect(offline.props.style[2].opacity).toBe(0.55)
  expect(offline.props.children[1].props.style[1].backgroundColor).toBe('gray')
  const paused = MachineAvatar({ machine: { os: 'darwin', online: true, remoteAccessDisabledAt: 'unit' } })
  expect(paused.props.children[1].props.style[1].backgroundColor).toBe('orange')
})
it('uses an explicit larger instance only for the computer details hero', () => {
  const hero = MachineAvatar({ machine: { os: 'linux', online: true }, hero: true })
  expect(hero.props.style[1]).toMatchObject({ width: 56, height: 56 })
  expect(hero.props.children[0].props.size).toBe(32)
})
it('renders the compact computer identity with its platform avatar, name and metadata', () => {
  const machine = { id: 'unit-machine', name: 'Unit Mac', os: 'darwin', online: true, agentList: [] } as unknown as Machine
  const row = MachineNameRow({ machine, actions: { editing: false } as Parameters<typeof MachineNameRow>[0]['actions'], compact: true, agentCount: 3 })
  const flatten = (node: ReactNode): ReactElement<Record<string, any>>[] => Array.isArray(node)
    ? node.flatMap(flatten) : isValidElement<Record<string, any>>(node) ? [node, ...flatten(node.props.children)] : []
  const nodes = flatten(row)
  expect(row.props.style).toBe(machineStyles.compactMachineIdentity)
  expect(nodes.find(node => node.type === MachineAvatar)?.props.machine).toBe(machine)
  const name = nodes.find(node => node.props.children === 'Unit Mac')!
  expect(name.props.style).toContain(machineStyles.compactMachineName)
  expect(nodes.some(node => Array.isArray(node.props.style) && node.props.style.includes(machineStyles.compactMachineMetadata))).toBe(true)
})
