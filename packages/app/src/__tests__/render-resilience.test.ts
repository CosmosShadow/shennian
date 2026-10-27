// @vitest-environment happy-dom
// @covers ../components/RenderErrorBoundary.tsx
// @covers ../components/RecoverableSection.tsx
// @covers ../components/RecoverableScreen.tsx
// @covers ../features/chat/components/ComposerInputCard.tsx
// @covers ../features/chat/screens/ChatScreenColumn.tsx
// @covers ../../app/_layout.tsx
// @covers ../../app/(main)/_layout.tsx
// @covers ../../app/(auth)/_layout.tsx
import { act, createElement as h, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const mocks = vi.hoisted(() => ({ report: vi.fn(), back: vi.fn(), replace: vi.fn(), canGoBack: vi.fn(() => true), focused: true }))
vi.mock('../config/log', () => ({ reportLog: mocks.report }))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ colors: { bg: '#fff', text: '#111', textSecondary: '#666', brand: '#44f', border: '#ddd' } }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => mocks.focused }))
vi.mock('expo-router', () => ({ useRouter: () => ({ canGoBack: mocks.canGoBack, back: mocks.back, replace: mocks.replace }) }))
vi.mock('react-native', () => ({
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
  View: ({ children, testID }: { children: ReactNode; testID?: string }) => h('div', { 'data-testid': testID }, children),
  Text: ({ children }: { children: ReactNode }) => h('span', null, children),
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => h('button', { onClick: onPress }, children),
}))
import { RenderErrorBoundary } from '../components/RenderErrorBoundary'
import { RecoverableSection } from '../components/RecoverableSection'
import { renderRecoverableScreen } from '../components/RecoverableScreen'

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.spyOn(console, 'error').mockImplementation(() => {}) // expected React exception-injection diagnostics
  mocks.focused = true
  mocks.report.mockReset(); mocks.back.mockClear(); mocks.replace.mockClear(); mocks.canGoBack.mockReturnValue(true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const fail = () => { throw new Error('private fixture payload') }
const button = (label: string) => Array.from(host.querySelectorAll('button')).find((node) => node.textContent === label)!
const click = async (node: HTMLButtonElement) => { await act(() => node.click()) }

describe('local render failure containment (real React client reconciliation)', () => {
  it('contains an illegal object child and retains sibling navigation/content', async () => {
    await act(() => root.render(h('main', null,
      h('nav', null, 'navigation'), h('article', null, 'history'),
      h(RecoverableSection, { scope: 'composer' }, h('span', null, { id: 'x', name: 'Model' } as unknown as ReactNode)),
    )))
    expect(host.querySelector('nav')?.textContent).toBe('navigation')
    expect(host.querySelector('article')?.textContent).toBe('history')
    expect(host.querySelector('[data-testid="render-fallback-composer"]')).not.toBeNull()
    expect(mocks.report).toHaveBeenCalledWith({ level: 'error', errorMessage: 'Local render failure', metadata: { scope: 'composer' } })
    expect(JSON.stringify(mocks.report.mock.calls)).not.toContain('private fixture')
  })

  it('keeps recovery controls through repeated failure and restores parent-held draft on retry', async () => {
    let broken = true
    function Composer() { if (broken) fail(); return h('span', null, 'composer ready') }
    function Parent() {
      const [draft] = useState('unsent draft')
      return h('main', null, h('input', { value: draft, readOnly: true }),
        h(RecoverableSection, { scope: 'composer' }, h(Composer)))
    }
    await act(() => root.render(h(Parent)))
    await click(button('render_failure_retry'))
    expect(button('render_failure_retry')).toBeTruthy()
    expect(host.querySelector('input')?.value).toBe('unsent draft')
    broken = false
    await click(button('render_failure_retry'))
    expect(host.textContent).toContain('composer ready')
    expect(host.querySelector('input')?.value).toBe('unsent draft')
  })

  it('clears failed state when a different route instance is shown', async () => {
    await act(() => root.render(renderRecoverableScreen({ route: { key: 'failed' }, children: h(fail) })))
    await click(button('render_failure_leave'))
    expect(mocks.back).toHaveBeenCalledOnce()
    await act(() => root.render(renderRecoverableScreen({ route: { key: 'other' }, children: h('p', null, 'other screen') })))
    expect(host.textContent).toBe('other screen')
  })

  it('provides an escape for a directly linked failing screen without history', async () => {
    mocks.canGoBack.mockReturnValue(false)
    await act(() => root.render(renderRecoverableScreen({ route: { key: 'deep-link' }, children: h(fail) })))
    await click(button('render_failure_leave'))
    expect(mocks.replace).toHaveBeenCalledWith('/(main)')
  })

  it('does not let a throwing diagnostics handler escape the boundary', async () => {
    await act(() => root.render(h(RenderErrorBoundary, { fallback: () => h('p', null, 'safe fallback'), onError: fail }, h(fail))))
    expect(host.textContent).toBe('safe fallback')
  })

  it('does not mount a failure UI for valid content', async () => {
    await act(() => root.render(h(RecoverableSection, { scope: 'timeline', fill: true }, h('p', null, 'messages'))))
    expect(host.innerHTML).toBe('<p>messages</p>')
    expect(mocks.report).not.toHaveBeenCalled()
  })
})

it('installs protection on every maintained native navigator and chat region', () => {
  const read = (file: string) => readFileSync(resolve(__dirname, file), 'utf8')
  for (const file of ['../../app/_layout.tsx', '../../app/(auth)/_layout.tsx']) {
    expect(read(file)).toContain('screenLayout={renderRecoverableScreen}')
  }
  expect(read('../../app/(main)/_layout.tsx')).toContain('screenLayout={renderMobileRootScreen}')
  expect(read('../components/MobileRootScreenFrame.tsx')).toContain('return renderRecoverableScreen(')
  const column = read('../features/chat/screens/ChatScreenColumn.tsx')
  for (const scope of ['header', 'timeline', 'composer']) expect(column).toContain(`scope="${scope}"`)
  expect(read('../features/chat/components/ComposerInputCard.tsx')).toContain('<RecoverableSection scope="composer">')
})

it('resets a reused route instance when its params change, without serializing user data', async () => {
  const params = { agentId: 'broken' }
  await act(() => root.render(renderRecoverableScreen({ route: { key: 'same-route', params }, children: h(fail) })))
  expect(button('render_failure_retry')).toBeTruthy()
  await act(() => root.render(renderRecoverableScreen({ route: { key: 'same-route', params: { agentId: 'valid' } }, children: h('p', null, 'valid route') })))
  expect(host.textContent).toBe('valid route')
  expect(JSON.stringify(mocks.report.mock.calls)).not.toContain('agentId')
})

it('does not let the actual section diagnostics reporter break its fallback', async () => {
  mocks.report.mockImplementationOnce(fail)
  await act(() => root.render(h(RecoverableSection, { scope: 'message' }, h(fail))))
  expect(button('render_failure_retry')).toBeTruthy()
})


describe('automatic screen recovery', () => {
  it('returns after three seconds, only once even after a manual return', async () => {
    vi.useFakeTimers()
    await act(() => root.render(renderRecoverableScreen({ route: { key: 'timed' }, children: h(fail) })))
    await act(() => vi.advanceTimersByTime(2999))
    expect(mocks.back).not.toHaveBeenCalled()
    await click(button('render_failure_leave'))
    await act(() => vi.advanceTimersByTime(10000))
    expect(mocks.back).toHaveBeenCalledOnce()
  })

  it('automatically escapes deep links without history', async () => {
    vi.useFakeTimers()
    mocks.canGoBack.mockReturnValue(false)
    await act(() => root.render(renderRecoverableScreen({ route: { key: 'timed-link' }, children: h(fail) })))
    await act(() => vi.advanceTimersByTime(3000))
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith('/(main)')
  })

  it('cancels pending return after a successful retry', async () => {
    vi.useFakeTimers()
    let broken = true
    function Screen() { if (broken) fail(); return h('p', null, 'recovered') }
    await act(() => root.render(renderRecoverableScreen({ route: { key: 'retry-timer' }, children: h(Screen) })))
    await act(() => vi.advanceTimersByTime(2000))
    broken = false
    await click(button('render_failure_retry'))
    await act(() => vi.advanceTimersByTime(10000))
    expect(host.textContent).toBe('recovered')
    expect(mocks.back).not.toHaveBeenCalled()
  })

  it('cancels a failed screen timer when it loses focus', async () => {
    vi.useFakeTimers()
    const render = () => root.render(renderRecoverableScreen({ route: { key: 'background' }, children: h(fail) }))
    await act(render)
    await act(() => vi.advanceTimersByTime(1000))
    mocks.focused = false
    await act(render)
    await act(() => vi.advanceTimersByTime(10000))
    expect(mocks.back).not.toHaveBeenCalled()
    mocks.focused = true
    await act(render)
    await act(() => vi.advanceTimersByTime(3000))
    expect(mocks.back).toHaveBeenCalledOnce()
  })

  it('never leaves automatically for a local section failure', async () => {
    vi.useFakeTimers()
    await act(() => root.render(h(RecoverableSection, { scope: 'composer', onLeave: mocks.back }, h(fail))))
    await act(() => vi.advanceTimersByTime(10000))
    expect(mocks.back).not.toHaveBeenCalled()
  })
})
