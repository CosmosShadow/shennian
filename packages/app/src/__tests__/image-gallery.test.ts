// @covers packages/app/src/features/chat/utils/imageGallery.ts
// @covers packages/app/src/components/chat/webview/chatHooks.js
// @covers packages/app/src/components/MessageImageGallery.tsx

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { createImageBackdropTap, isImageBackdrop } from '../features/chat/utils/imageBackdropTap'
import {
  buildImageGalleryPaths,
  collectMessageImagePaths,
  imagePageIndex,
  parseImageGallery,
} from '../features/chat/utils/imageGallery'

describe('message image gallery snapshot', () => {
  it('keeps modal controls inside provider insets with a full-size close target', () => {
    const gallery = readFileSync(
      resolve(__dirname, '../components/MessageImageGallery.tsx'),
      'utf8',
    )
    const roomAttachment = readFileSync(
      resolve(__dirname, '../features/rooms/components/RoomMessageAttachment.tsx'),
      'utf8',
    )

    expect(gallery).toContain('const insets = safeAreaInsets ?? inheritedInsets')
    expect(gallery).toContain('paddingTop: insets.top')
    expect(gallery).toContain('paddingBottom: insets.bottom')
    expect(gallery).toContain('testID="image-gallery-close"')
    expect(gallery).toMatch(/button:\s*\{ width: 48, height: 48/)
    expect(roomAttachment).toContain('const safeAreaInsets = useSafeAreaInsets()')
    expect(roomAttachment).toContain('safeAreaInsets={safeAreaInsets}')
  })

  it('resolves relative references in display order, de-duplicates paths, and excludes external URLs', () => {
    const paths = buildImageGalleryPaths(
      ['./a.png', '/project/b.png', 'a.png', 'https://example.com/c.png'],
      '/project',
    )
    expect(paths).toEqual(['/project/a.png', '/project/b.png'])
    expect(parseImageGallery(JSON.stringify(paths), paths[1]).map((image) => image.path)).toEqual(
      paths,
    )
    expect(parseImageGallery(JSON.stringify(paths), paths[1])[1].kind).toBe('image')
  })

  it('preserves Windows and extensionless image paths', () => {
    expect(
      buildImageGalleryPaths(['C:\\project\\one.png', 'C:\\project\\two.png'], 'C:\\project'),
    ).toHaveLength(2)
    expect(parseImageGallery('["/project/image","/project/next"]', '/project/image')[0].kind).toBe(
      'image',
    )
  })

  it.each([
    undefined,
    '',
    'oops',
    '{}',
    '[42]',
    '["/a.png"]',
    '["/a.png","/a.png"]',
    '["/a.png","https://example.com/b.png"]',
  ])('falls back safely for an invalid or single-image route: %s', (value) => {
    expect(parseImageGallery(value, '/a.png')).toEqual([])
  })

  it('never substitutes a gallery that does not include the selected image', () => {
    expect(parseImageGallery('["/a.png","/b.png"]', '/other-message.png')).toEqual([])
  })

  it('clamps native bounce offsets and supports resized pages', () => {
    expect(imagePageIndex(-100, 390, 4)).toBe(0)
    expect(imagePageIndex(790, 390, 4)).toBe(2)
    expect(imagePageIndex(3000, 390, 4)).toBe(3)
    expect(imagePageIndex(1688, 844, 4)).toBe(2)
    expect(imagePageIndex(100, 0, 4)).toBe(0)
  })
})

describe('native and web image press context', () => {
  // Narrow DOM unit doubles: execute the actual runtime hook, not a system/E2E data source.
  function imageNode(path: string, image = true, className = 'attachment-thumb-btn') {
    const handlers = new Map<string, (event: { preventDefault(): void }) => void>()
    const node = {
      getAttribute: (name: string) =>
        name === 'data-resource-path'
          ? path
          : name === 'data-resource-kind' && image
            ? 'image'
            : null,
      classList: { contains: (name: string) => image && name === className },
      matches: () => image,
      closest: (_selector: string): unknown => null,
      addEventListener: (type: string, handler: (event: { preventDefault(): void }) => void) =>
        handlers.set(type, handler),
      click: () => handlers.get('click')?.({ preventDefault() {} }),
    }
    return node
  }

  it.each(['attachment-thumb-btn', 'attachment-image-placeholder', 'resource-pill-image'])(
    'scopes a %s click to its own message’s ordered images',
    (className) => {
      const first = imageNode('/same.png')
      const second = imageNode('/second.png', true, className)
      const duplicate = imageNode('/same.png')
      const otherMessage = imageNode('/elsewhere.png')
      const row = { querySelectorAll: () => [first, second, duplicate] }
      for (const node of [first, second, duplicate]) node.closest = () => row
      otherMessage.closest = () => ({ querySelectorAll: () => [otherMessage] })
      const posted: unknown[] = []
      const runtime: {
        ShennianChatHooks?: { createChatHooks(config: unknown): { hookLinks(): void } }
      } = {}
      runInNewContext(
        readFileSync(resolve(__dirname, '../components/chat/webview/chatHooks.js'), 'utf8'),
        { window: runtime },
      )
      runtime
        .ShennianChatHooks!.createChatHooks({
          container: { querySelectorAll: () => [first, second, duplicate, otherMessage] },
          postToRN: (payload: unknown) => posted.push(payload),
        })
        .hookLinks()
      second.click()
      expect(posted).toEqual([
        { type: 'resourcePress', path: '/second.png', imagePaths: ['/same.png', '/second.png'] },
      ])
      expect(collectMessageImagePaths(second as unknown as Element)).toEqual([
        '/same.png',
        '/second.png',
      ])
      expect(
        collectMessageImagePaths(imageNode('/notes.md', false) as unknown as Element),
      ).toBeUndefined()
    },
  )
})


describe('image preview backdrop dismissal', () => {
  const viewport = { width: 400, height: 800 }
  const landscape = { width: 1200, height: 600 }
  const touch = (x = 200, y = 100) => ({ pageX: x, pageY: y, locationX: x, locationY: y })

  it('closes only in contain letterboxing, never image pixels or image edges', () => {
    expect(isImageBackdrop({ x: 200, y: 100 }, viewport, landscape)).toBe(true)
    expect(isImageBackdrop({ x: 200, y: 700 }, viewport, landscape)).toBe(true)
    for (const y of [300, 400, 500]) {
      expect(isImageBackdrop({ x: 200, y }, viewport, landscape)).toBe(false)
    }
    const portrait = { width: 200, height: 800 }
    expect(isImageBackdrop({ x: 50, y: 400 }, viewport, portrait)).toBe(true)
    expect(isImageBackdrop({ x: 350, y: 400 }, viewport, portrait)).toBe(true)
    expect(isImageBackdrop({ x: 100, y: 400 }, viewport, portrait)).toBe(false)
    expect(isImageBackdrop({ x: 200, y: 10 }, viewport, viewport)).toBe(false)
    expect(isImageBackdrop({ x: -1, y: 10 }, viewport, landscape)).toBe(false)
  })

  it('does not guess bounds while dimensions are missing or invalid', () => {
    for (const width of [0, -1, NaN, Infinity]) {
      expect(isImageBackdrop({ x: 20, y: 20 }, viewport, { width, height: 600 })).toBe(false)
      expect(isImageBackdrop({ x: 20, y: 20 }, { width, height: 800 }, landscape)).toBe(false)
    }
  })

  it('accepts a short single-finger background tap with small finger jitter', () => {
    const tap = createImageBackdropTap()
    tap.start(touch(), 1, true, 0)
    tap.move(touch(203, 102), 1)
    expect(tap.end(touch(203, 102), 0, true, 120)).toBe(true)
    expect(tap.end(touch(), 0, true, 121)).toBe(false)
  })

  it('protects image taps, zoomed content and gestures ending over content', () => {
    for (const [start, end] of [[false, false], [true, false], [false, true]]) {
      const tap = createImageBackdropTap()
      tap.start(touch(), 1, start, 0)
      expect(tap.end(touch(), 0, end, 100)).toBe(false)
    }
  })

  it('never closes after a swipe, drag, long press, cancellation or pinch', () => {
    for (const action of ['swipe', 'long', 'cancel', 'pinch', 'move-pinch']) {
      const tap = createImageBackdropTap()
      tap.start(touch(), 1, true, 0)
      if (action === 'swipe') { tap.move(touch(220), 1); tap.move(touch(), 1) }
      if (action === 'cancel') tap.cancel()
      if (action === 'pinch') tap.start(touch(), 2, true, 20)
      if (action === 'move-pinch') tap.move(touch(), 2)
      expect(tap.end(touch(), 0, true, action === 'long' ? 500 : 100)).toBe(false)
    }
    const tap = createImageBackdropTap()
    tap.start(touch(), 1, true, 0)
    expect(tap.end(touch(250), 0, true, 100)).toBe(false)
  })
})
