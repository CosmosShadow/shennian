// @covers packages/app/src/components/AppPageHeader.tsx
// @arch docs/design/components.md
import React, { type ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
vi.mock('react-native', () => ({ View: 'View', Text: 'Text', StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 } }))
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: {} }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ colors: { bg: 'white', text: 'black', border: 'gray', separator: 'silver' } }) }))
vi.mock('../components/ActionIconButton', () => ({ ActionIconButton: 'ActionIconButton' }))
import { AppPageHeader, HeaderBackButton } from '../components/AppPageHeader'
import { mobileTypography } from '../theme/mobileTypography'

describe('page header rendered layout', () => {
  it('uses the standard header height, navigation typography, separator and back action', () => {
    const onBack = vi.fn()
    const header = AppPageHeader({ title: 'Settings', onBack })
    expect(Object.assign({}, ...header.props.style)).toMatchObject({ height: 48, borderBottomColor: 'silver' })
    const [left, heading, right] = header.props.children as ReactElement<any>[]
    const [title] = heading!.props.children as ReactElement<any>[]
    expect(Object.assign({}, ...left!.props.style)).toMatchObject({ width: 48, height: 48 })
    expect(Object.assign({}, ...right!.props.style)).toMatchObject({ width: 48, height: 48 })
    expect(Object.assign({}, ...title!.props.style)).toMatchObject(mobileTypography.navigationTitle)
    expect(title!.props.children).toBe('Settings')
    const back = HeaderBackButton((left!.props.children as ReactElement<any>).props)
    expect(back.props.icon).toBe('back')
    back.props.onPress()
    expect(onBack).toHaveBeenCalledOnce()
  })
  it('shows the project subtitle below the title without reducing side hit areas', () => {
    const header = AppPageHeader({ title: '项目经理', subtitle: '测试项目', onBack: vi.fn() })
    expect(Object.assign({}, ...header.props.style)).toMatchObject({ height: 60 })
    const [left, heading, right] = header.props.children as ReactElement<any>[]
    expect((heading!.props.children as ReactElement<any>[]).map(child => child.props.children)).toEqual(['项目经理', '测试项目'])
    expect(Object.assign({}, ...left!.props.style)).toMatchObject({ height: 48 })
    expect(Object.assign({}, ...right!.props.style)).toMatchObject({ height: 48 })
  })
  it('centers the unread badge next to the arrow without intercepting input or accessibility', () => {
    const button = HeaderBackButton({ onPress: vi.fn(), badge: React.createElement('span', null, '3') })
    const badge = button.props.children as ReactElement<any>
    expect(badge.props.style).toMatchObject({ top: 0, bottom: 0, left: 32, width: 44, alignItems: 'flex-start', justifyContent: 'center' })
    expect(badge.props.style.right).toBeUndefined()
    expect(badge.props.pointerEvents).toBe('none')
    expect(badge.props.accessibilityElementsHidden).toBe(true)
    expect(badge.props.accessible).toBe(false)
  })
})
