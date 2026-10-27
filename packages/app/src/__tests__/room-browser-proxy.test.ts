// @covers packages/app/scripts/room-browser-proxy.cjs
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
const { createRoomBrowserOriginRewriter } = createRequire(import.meta.url)(
  '../../scripts/room-browser-proxy.cjs',
)
const rewrite = createRoomBrowserOriginRewriter('https://api.example')
const { desktopMetroBlockList } = createRequire(import.meta.url)('../../scripts/desktop-metro-watch.cjs')

describe('Desktop Metro watch boundary', () => {
  it('excludes only this repository runtime artifacts and preserves existing exclusions', () => {
    const root = path.resolve('/workspace/project.with+[symbols]')
    const previous = /existing-exclusion/
    const entries = desktopMetroBlockList(previous, root, true) as RegExp[]
    const blocked = (file: string) => entries.some(pattern => pattern.test(file))
    expect(entries[0]).toBe(previous)
    expect(blocked(path.join(root, '.dev-runtime'))).toBe(true)
    expect(blocked(path.join(root, '.dev-runtime/ios-build/app.js'))).toBe(true)
    expect(blocked(path.join(root, '.dev-runtime-other/source.js'))).toBe(false)
    expect(blocked(path.join(root, 'packages/app/src/app.tsx'))).toBe(false)
    expect(blocked(path.join(root, 'open-source/packages/shared/dist/index.js'))).toBe(false)
    expect(blocked(path.join(root, 'node_modules/example/index.js'))).toBe(false)
    expect(blocked(path.join(root, 'packages/app/.dev-runtime/source.js'))).toBe(false)
    expect(blocked('/different/.dev-runtime/log.js')).toBe(false)
  })
  it('does not change mobile/browser exclusions or mutate the defaults', () => {
    const previous = [/existing-exclusion/]
    expect(desktopMetroBlockList(previous, '/workspace/project', false)).toBe(previous)
    expect(desktopMetroBlockList(undefined, '/workspace/project', false)).toEqual([])
    desktopMetroBlockList(previous, '/workspace/project', true)
    expect(previous).toHaveLength(1)
  })
})

describe('first-party Metro room proxy', () => {
  it.each([
    '/api/room-browser/identity',
    '/api/room-browser/events?roomId=room_1',
    '/api/room-invites/scoped/join',
  ])('translates only a matching local Origin for %s', (url) => {
    const proxy = { setHeader: vi.fn() }
    rewrite(proxy, { url, headers: { origin: 'http://localhost:8081', host: 'localhost:8081' } })
    expect(proxy.setHeader).toHaveBeenCalledWith('origin', 'https://api.example')
  })
  it.each([
    'https://evil.example',
    'http://evil.localhost:8081',
    'http://localhost:9999',
    'https://localhost:8081',
    'null',
  ])('does not launder an untrusted Origin: %s', (origin) => {
    const proxy = { setHeader: vi.fn() }
    rewrite(proxy, { url: '/api/room-browser/logout', headers: { origin, host: 'localhost:8081' } })
    expect(proxy.setHeader).not.toHaveBeenCalled()
  })
  it('does not change unrelated API or relay requests', () => {
    const proxy = { setHeader: vi.fn() }
    rewrite(proxy, {
      url: '/api/machines',
      headers: { origin: 'http://localhost:8081', host: 'localhost:8081' },
    })
    expect(proxy.setHeader).not.toHaveBeenCalled()
  })
})
