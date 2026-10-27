// @vitest-environment happy-dom
// @covers packages/app/src/features/steward/components/StewardMessageRow.tsx
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withStewardContext } from '../features/steward/contextualSteward'
import type { ChatAttachment } from '@shennian/shared'
import { StewardMessageRow } from '../features/steward/components/StewardMessageRow'

const { copy, actionSheet } = vi.hoisted(() => ({ copy: vi.fn(), actionSheet: vi.fn() }))
vi.mock('expo-clipboard', () => ({ setStringAsync: copy }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ colors: {}, isDark: false }) }))
vi.mock('../hooks/useChatFontSize', () => ({ useChatFontSize: () => ({ typography: { body: {} } }) }))
vi.mock('react-native', () => ({
  ActionSheetIOS: { showActionSheetWithOptions: actionSheet },
  Platform: { OS: 'ios' }, StyleSheet: { create: (styles: unknown) => styles },
  View: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  Text: ({ children }: { children: ReactNode }) => createElement('span', null, children),
  Pressable: ({ children, onPress, onLongPress, accessibilityLabel }: { children: ReactNode; onPress?: () => void; onLongPress?: () => void; accessibilityLabel?: string }) =>
    createElement('button', { onClick: onPress, onContextMenu: onLongPress, 'aria-label': accessibilityLabel }, children),
}))
vi.mock('../components/chat/SimpleMessageMarkdown', () => ({
  SimpleMessageMarkdown: ({ content, onResourcePress }: { content: string; onResourcePress?: (path: string) => void }) =>
    createElement('div', { 'data-markdown': true }, content,
      onResourcePress ? createElement('button', { onClick: () => onResourcePress('/test.txt') }, 'resource') : null),
}))
vi.mock('../features/steward/components/StewardImageAttachment', () => ({
  StewardImageAttachment: ({ attachment, onOpen }: { attachment: ChatAttachment; onOpen?: (path: string) => void }) =>
    createElement('img', { alt: attachment.name, 'data-path': attachment.path, onClick: () => onOpen?.(attachment.path) }),
}))
vi.mock('../components/BottomSheet', () => ({
  default: ({ children, onClose, headerRight }: { children: ReactNode; onClose: () => void; headerRight: ReactNode }) =>
    createElement('div', { role: 'dialog' }, headerRight, children, createElement('button', { onClick: onClose }, 'close')),
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | undefined
let container: HTMLDivElement
function render(content: string, role: 'user' | 'agent' = 'agent', onResourcePress?: (path: string) => void, attachments?: ChatAttachment[]) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root!.render(createElement(StewardMessageRow, {
    message: { id: 'preview', role, ts: 1, content, attachments }, onResourcePress,
  })))
}
afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  vi.clearAllMocks()
})

describe('steward long message reading', () => {
  it.each(['user', 'agent'] as const)('opens the complete %s message, copies it intact, and closes', (role) => {
    const content = '内容'.repeat(300) + '最后一行'
    render(content, role)
    expect(container.textContent).toContain('steward_message_view_more')
    expect(container.textContent).not.toContain('最后一行')
    act(() => container.querySelector('button')!.click())
    const dialog = container.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain(content)
    act(() => (dialog.querySelector('[aria-label="copy"]') as HTMLButtonElement).click())
    expect(copy).toHaveBeenCalledWith(content)
    act(() => Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'close')!.click())
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })
  it('keeps short messages fully rendered with their resource action', () => {
    const resource = vi.fn()
    render('短消息', 'agent', resource)
    expect(container.querySelector('[data-markdown]')?.textContent).toContain('短消息')
    expect(container.textContent).not.toContain('steward_message_view_more')
    act(() => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'resource')!.click())
    expect(resource).toHaveBeenCalledWith('/test.txt')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })
})

// These tests render the same persisted turn used by the send/retry path.
describe('contextual user message presentation', () => {
  const context = { page: 'personal modules', route: 'personal-modules', details: { tab: 'reminders' } }
  it('shows and copies only the request, without a context block or a spurious expand button', () => {
    const text = '那个明天早上8点提醒我起床。'
    render(withStewardContext(text, context), 'user')
    expect(container.textContent).toBe(text)
    act(() => container.querySelector('button')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    act(() => actionSheet.mock.calls[0][1](0))
    expect(copy).toHaveBeenCalledWith(text)
  })
  it('keeps full user text in expansion and copy, but not the hidden context', () => {
    const text = '提醒事项'.repeat(150) + '最后一行'
    render(withStewardContext(text, context), 'user')
    expect(container.textContent).not.toContain('App page context')
    act(() => container.querySelector('button')!.click())
    const dialog = container.querySelector('[role="dialog"]')!
    expect(dialog.querySelector('[data-markdown]')?.textContent).toBe(text)
    act(() => (dialog.querySelector('[aria-label="copy"]') as HTMLButtonElement).click())
    expect(copy).toHaveBeenCalledWith(text)
  })
  it('does not strip an agent explaining the context format', () => {
    const text = withStewardContext('Example', context)
    render(text, 'agent')
    expect(container.textContent).toBe(text)
  })
})

it('shows image metadata as an inline thumbnail without a duplicate filename link', () => {
  const open = vi.fn()
  const attachment = { path: '/uploads/IMG_0933.png', name: 'IMG_0933.png', mimeType: 'image/png', kind: 'image' as const }
  render('![IMG_0933.png](</uploads/IMG_0933.png>)\n添加一个任务', 'user', open, [attachment])
  expect(container.querySelector('img')?.getAttribute('data-path')).toBe(attachment.path)
  expect(container.querySelector('[data-markdown]')?.textContent).toBe('添加一个任务resource')
  act(() => container.querySelector('img')!.click())
  expect(open).toHaveBeenCalledWith(attachment.path)
})
it('does not hide image-only messages with an empty body', () => {
  render('', 'user', undefined, [{ path: '/x.png', name: 'x.png', mimeType: 'image/png', kind: 'image' }])
  expect(container.querySelector('img')).not.toBeNull()
})
