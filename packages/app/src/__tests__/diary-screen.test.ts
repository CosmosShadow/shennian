// @covers packages/app/src/features/personal-workspace/DiaryScreen.tsx
import { createRequire } from 'node:module'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ slots: [] as unknown[], index: 0, effects: [] as (() => unknown)[], status: {} as any, save: vi.fn(), refresh: vi.fn(), load: vi.fn(), details: vi.fn() }))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const index = h.index++; if (!(index in h.slots)) h.slots[index] = initial; return [h.slots[index], (v: unknown) => { h.slots[index] = v }] },
  useEffect: (effect: () => unknown) => { h.effects.push(effect) }, useCallback: (fn: unknown) => fn,
  useSyncExternalStore: () => h.status,
}))
vi.mock('react-native', () => ({ ActivityIndicator: 'Spinner', Alert: { alert: vi.fn() }, FlatList: 'List', Pressable: 'Button', ScrollView: 'Scroll', Text: 'Text', TextInput: 'Input', View: 'View' }))
vi.mock('../features/personal-workspace/DiaryMenu', () => ({ DiaryMenu: 'Menu' }))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'Safe' }))
vi.mock('react-native-markdown-display', () => ({ default: 'Markdown', MarkdownIt: createRequire(import.meta.url)('markdown-it') }))
vi.mock('../features/personal-workspace/DiaryImage', () => ({ DiaryImage: 'DiaryImage' }))
vi.mock('expo-router', () => ({ useLocalSearchParams: () => ({}), useRouter: () => ({ navigate: vi.fn() }), useFocusEffect: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (s: string) => s }) }))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ colors: {} }) }))
vi.mock('../config/auth', () => ({ useAuthStore: (fn: (s: unknown) => unknown) => fn({ user: { id: 'alice' } }) }))
vi.mock('../components/useMobileModuleBack', () => ({ useMobileModuleBack: () => vi.fn() }))
vi.mock('../components/ConnectedAppPageHeader', () => ({ AppPageHeader: 'Header', HeaderIconButton: 'Refresh' }))
vi.mock('../features/personal-workspace/client', () => ({ personalErrorKey: (error: Error) => error.message }))
vi.mock('../features/personal-workspace/diaryRuntime', () => ({ diaryStatus: vi.fn(), subscribeDiary: () => () => {}, refreshDiary: h.refresh, diaryDocuments: h.load, diaryDocument: h.load, diaryScope: (v: { revision: number }) => String(v.revision), saveDiary: h.save }))
vi.mock('../features/steward/ContextualStewardContext', () => ({ useContextualSteward: () => ({ setDetails: h.details }) }))
import DiaryScreen from '../features/personal-workspace/DiaryScreen'
const target = { machine: { id: 'mac', name: 'Mac', online: true }, revision: 1 }, scope = '["alice","1"]'
const doc = { path: '2026/2026-10-23.md', date: '2026-10-23', content: 'cached body', revision: 'v1' }
function nodes(node: ReactNode): ReactElement<Record<string, any>>[] {
  if (Array.isArray(node)) return node.flatMap(nodes)
  if (!isValidElement<Record<string, any>>(node)) return []
  return [node, ...nodes(node.props.children)]
}
function render() { h.index = 0; return nodes(DiaryScreen()) }
function button(tree: ReturnType<typeof nodes>, label: string) { return tree.find(n => n.type === 'Button' && nodes(n.props.children).some(c => c.props.children === label))! }
beforeEach(() => { vi.clearAllMocks(); h.slots = []; h.index = 0; h.effects = []; h.status = { target, editable: true, busy: false }; h.load.mockResolvedValue([]) })
it('shows a cached list during an offline sync without a blocking spinner or network read on entry tap', () => {
  h.status = { ...h.status, busy: true, error: 'personal_diary_offline' }
  h.slots = [null, { scope, entries: [doc], document: null }]
  const tree = render(), list = tree.find(n => n.type === 'List')!
  expect(list.props.data).toEqual([doc])
  const entry = nodes(list.props.renderItem({ item: doc })).find(n => n.type === 'Button')!
  entry.props.onPress(); expect(h.slots[0]).toBe(doc.path)
  expect(h.refresh).not.toHaveBeenCalled()
})
it('shows read-only content, metadata below the body, and authenticated image components without a detail menu', () => {
  h.slots = [doc.path, { scope, entries: [doc], document: doc }]
  const tree = render(), markdown = tree.find(n => n.type === 'Markdown')!
  expect(markdown.props.children).toBe(doc.content)
  expect(markdown.props.onLinkPress('https://example.org')).toBe(false)
  const image = markdown.props.rules.image({ key: 'image', attributes: { src: '../photos/a.png' }, content: 'photo' })
  expect(image.props).toMatchObject({ src: '../photos/a.png', path: doc.path, machineId: 'mac' })
  expect(tree.some(n => n.type === 'Input')).toBe(false)
  expect(button(tree, 'personal_diary_edit')).toBeUndefined()
  expect(tree.find(n => n.type === 'Header')!.props.trailing).toBeUndefined()
  const body = tree.indexOf(markdown)
  expect(tree.slice(body + 1).some(n => n.type === 'Text' && n.props.children.includes('personal_diary_characters'))).toBe(true)
})

it('keeps background sync quiet and shows source only in the list menu without manual sync', () => {
  h.status = { ...h.status, busy: true, directory: '/diary' }
  h.slots = [null, { scope, entries: [doc], document: null }]
  const tree = render()
  expect(tree.some(n => n.type === 'Text' && ['personal_diary_syncing', 'personal_diary_cached', 'personal_primary_named'].includes(n.props.children))).toBe(false)
  const more = tree.find(n => n.type === 'Header')!.props.trailing
  expect(more.props.icon).toBe('ellipsis-horizontal')
  more.props.onPress()
  const menu = render().find(n => n.type === 'Menu')!
  expect(menu.props.visible).toBe(true)
  expect(menu.props.status.directory).toBe('/diary')
  expect(menu.props.refresh).toBeUndefined()
})

it('places each entry date, character count and photos after its summary without totals', () => {
  h.slots = [null, { scope, entries: [doc], document: null }]
  const tree = render()
  expect(tree.some(n => n.props.children === 'personal_diary_totals')).toBe(false)
  const list = tree.find(n => n.type === 'List')!
  const card = nodes(list.props.renderItem({ item: { path: doc.path, date: doc.date, revision: doc.revision, title: '标题', summary: '概要', characterCount: 123, photoCount: 2 } }))
  const texts = card.filter(n => n.type === 'Text').map(n => n.props.children)
  expect(texts).toEqual(['标题', '概要', '2026-10-23 · personal_diary_characters · personal_diary_photos'])
})

it('gives the bottom conversation the currently opened diary path without sending the body', () => {
  h.slots = [doc.path, { scope, entries: [doc], document: doc }]
  render()
  h.effects[0]()
  expect(h.details).toHaveBeenCalledWith({ kind: 'diary', machineId: 'mac', path: doc.path })
})

it('keeps diary and date on one header line, with explicit readable title leading and paragraph rhythm', () => {
  h.slots = [doc.path, { scope, entries: [doc], document: { ...doc, content: '# 2026-10-23｜一个需要换行的日记标题\n\n> 概要：摘要\n\n## 正文\n段落' } }]
  const tree = render(), header = tree.find(n => n.type === 'Header')!, markdown = tree.find(n => n.type === 'Markdown')!
  expect(header.props.title).toBe('personal_diary 2026-10-23')
  expect(header.props.subtitle).toBeUndefined()
  expect(markdown.props.children.startsWith('# 一个需要换行的日记标题')).toBe(true)
  expect(markdown.props.style.heading1).toMatchObject({ fontSize: 26, lineHeight: 38, marginBottom: 20 })
  expect(markdown.props.style.heading2).toMatchObject({ lineHeight: 31, marginTop: 20 })
  expect(markdown.props.style.paragraph.marginBottom).toBe(16)
  const footer = tree.filter(n => n.type === 'Text' && typeof n.props.children === 'string').at(-1)!
  expect(footer.props.children).toBe('personal_diary_characters')
})
