// @vitest-environment happy-dom
// @covers packages/app/src/features/steward/components/StewardImageAttachment.tsx
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { StewardImageAttachment } from '../features/steward/components/StewardImageAttachment'
vi.mock('react-native', () => ({
  Image: ({ source, accessibilityLabel }: { source: { uri: string }; accessibilityLabel: string }) => createElement('img', { src: source.uri, alt: accessibilityLabel }),
  Text: ({ children }: { children: ReactNode }) => createElement('span', null, children),
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => createElement('button', { onClick: onPress }, children),
}))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
let container: HTMLDivElement
const attachment = { path: '/uploads/photo.png', name: 'photo.png', mimeType: 'image/png', kind: 'image' as const }
function mount(props: Parameters<typeof StewardImageAttachment>[0]) {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  act(() => root.render(createElement(StewardImageAttachment, props)))
}
afterEach(() => { act(() => root?.unmount()); container?.remove() })
it('renders the uploaded image inline and opens the original path on tap', () => {
  const onOpen = vi.fn(); const requestPreview = vi.fn()
  mount({ attachment: { ...attachment, previewData: 'YWJj' }, onOpen, requestPreview })
  expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,YWJj')
  expect(requestPreview).not.toHaveBeenCalled()
  act(() => container.querySelector('button')!.click())
  expect(onOpen).toHaveBeenCalledWith(attachment.path)
})
it('loads historical images using the authenticated preview callback', async () => {
  const requestPreview = vi.fn().mockResolvedValue('data:image/png;base64,YWJj')
  await act(async () => mount({ attachment, requestPreview }))
  expect(requestPreview).toHaveBeenCalledWith({ path: attachment.path, name: attachment.name, mimeType: attachment.mimeType })
  expect(container.querySelector('img')).not.toBeNull()
})
it('keeps offline images openable without an unhandled rejection', async () => {
  const onOpen = vi.fn()
  await act(async () => mount({ attachment, onOpen, requestPreview: vi.fn().mockRejectedValue(new Error('offline')) }))
  expect(container.textContent).toBe('photo.png')
  act(() => container.querySelector('button')!.click())
  expect(onOpen).toHaveBeenCalledWith(attachment.path)
})
