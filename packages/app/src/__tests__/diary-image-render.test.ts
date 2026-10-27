// @covers packages/app/src/features/personal-workspace/DiaryImage.tsx
import { beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ slots: [] as unknown[], index: 0, effects: [] as (() => (() => void))[], load: vi.fn() }))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useCallback: (fn: unknown) => fn, useMemo: (fn: () => unknown) => fn(),
  useState: (initial: unknown) => { const index = h.index++; if (!(index in h.slots)) h.slots[index] = initial; return [h.slots[index], (v: unknown) => { h.slots[index] = v }] },
  useEffect: (effect: () => (() => void)) => { h.effects.push(effect) },
}))
vi.mock('react-native', () => ({ ActivityIndicator: 'Spinner', Image: 'Image', Text: 'Text', View: 'View', Pressable: 'Pressable', Modal: 'Modal', useWindowDimensions: () => ({ width: 390 }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (s: string) => s }) }))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ colors: {} }) }))
vi.mock('../features/chat/utils/attachmentPreview', () => ({ ensureImageAttachmentPreview: h.load }))
vi.mock('../components/chat/SvgImagePreview', () => ({ SvgImagePreview: 'Svg' }))
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
vi.mock('../components/MessageImageGallery', () => ({ MessageImageGallery: 'Gallery' }))
import { DiaryImage } from '../features/personal-workspace/DiaryImage'
const props = { machineId: 'mac', directory: '/diary', path: '2026/2026-10-24.md', src: '../photos/a.png', alt: 'photo' }
function render(input = props) { h.index = 0; return DiaryImage(input) }
beforeEach(() => { vi.clearAllMocks(); h.slots = []; h.effects = [] })
it('loads a computer photo through the existing authenticated preview and renders its URI', async () => {
  h.load.mockResolvedValue('file:///phone-cache/a.png')
  expect(render().type).toBe('Spinner')
  h.effects[0]()
  await vi.waitFor(() => expect(h.slots[0]).not.toBeNull())
  const image = render().props.children[0].props.children
  expect(h.load).toHaveBeenCalledWith('mac', expect.objectContaining({ path: '/diary/photos/a.png' }))
  expect(image.type).toBe('Image')
  expect(image.props.source).toEqual({ uri: 'file:///phone-cache/a.png' })
  image.props.onError()
  expect(render().type).toBe('Text')
})
it('does not show a previous machine image and ignores a request after unmount', async () => {
  let resolve!: (uri: string) => void
  h.load.mockReturnValue(new Promise<string>(done => { resolve = done }))
  render()
  const cancel = h.effects[0]()
  cancel(); resolve('file:///stale.png')
  await Promise.resolve()
  expect(h.slots[0]).toBeNull()
  h.slots[0] = { key: JSON.stringify(['mac', '/diary', props.path, props.src]), uri: 'file:///old.png' }
  expect(render({ ...props, machineId: 'other' }).type).toBe('Spinner')
})
it('shows a failure label without fetching arbitrary network images', async () => {
  const input = { ...props, src: 'https://example.org/track.png' }
  render(input); h.effects[0]()
  await vi.waitFor(() => expect(h.slots[0]).not.toBeNull())
  expect(render(input).type).toBe('Text')
  expect(h.load).not.toHaveBeenCalled()
})

it('uses the content width and photo aspect ratio, and opens a dismissible full-screen zoom gallery', async () => {
  h.load.mockResolvedValue('file:///phone-cache/a.png')
  render(); h.effects[0]()
  await vi.waitFor(() => expect(h.slots[0]).not.toBeNull())
  let tree = render()
  tree.props.onLayout({ nativeEvent: { layout: { width: 342 } } })
  tree.props.children[0].props.children.props.onLoad({ nativeEvent: { source: { width: 400, height: 900 } } })
  tree = render()
  expect(tree.props.children[0].props.children.props.style).toEqual({ width: '100%', height: 769.5 })
  tree.props.children[0].props.onPress()
  const modal = render().props.children[1]
  expect(modal.type).toBe('Modal')
  const gallery = modal.props.children
  expect(await gallery.props.loadImage()).toBe('file:///phone-cache/a.png')
  expect(gallery.props.images).toEqual([{ key: JSON.stringify(['mac', '/diary', props.path, props.src]), name: 'photo' }])
  expect(render({ ...props, machineId: 'other' }).type).toBe('Spinner')
  gallery.props.onClose()
  expect(render().props.children[1]).toBeNull()
})
