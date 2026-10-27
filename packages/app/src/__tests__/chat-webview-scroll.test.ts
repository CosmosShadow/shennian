// @covers packages/app/src/components/chat/webview/chatScroll.js
// @covers packages/app/src/components/chat/webview/chat.js
// @covers packages/app/src/components/chat/webview/chatVirtualization.js
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { URL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { createHarness, createMessages } from './chat-webview-harness'

type Handler = (event?: { touches?: { clientY: number }[]; deltaY?: number }) => void
function scrollHarness() {
  let now = 0
  let id = 0
  let top = 400
  const frames = new Map<number, () => void>()
  const timers = new Map<number, () => void>()
  const events: Record<string, Handler> = {}
  const windows: Record<string, Handler> = {}
  const loads: Record<string, Handler> = {}
  let resize: Handler = () => {}
  const root = {
    clientHeight: 600,
    scrollHeight: 1000,
    get scrollTop() {
      return top
    },
    set scrollTop(value: number) {
      top = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight))
    },
    addEventListener(type: string, handler: Handler) {
      events[type] = handler
    },
  }
  const ensureBottomWindow = vi.fn()
  const handleHistoryScroll = vi.fn()
  const postToRN = vi.fn()
  const window: Record<string, any> = {
    // Runtime modules deliberately have no package dependency.
    addEventListener(type: string, handler: Handler) {
      windows[type] = handler
    },
  }
  runInNewContext(
    readFileSync(new URL('../components/chat/webview/chatScroll.js', import.meta.url), 'utf8'),
    {
      window,
      ResizeObserver: class {
        constructor(callback: Handler) {
          resize = callback
        }
        observe() {}
      },
      requestAnimationFrame(callback: () => void) {
        const key = ++id
        frames.set(key, callback)
        return key
      },
      cancelAnimationFrame(key: number) {
        frames.delete(key)
      },
      setTimeout(callback: () => void) {
        const key = ++id
        timers.set(key, callback)
        return key
      },
      clearTimeout(key: number) {
        timers.delete(key)
      },
    },
  )
  const controller = window.ShennianChatScroll.create({
    scrollRoot: root,
    container: {
      addEventListener(type: string, handler: Handler) {
        loads[type] = handler
      },
    },
    nowMs: () => now,
    ensureBottomWindow,
    handleHistoryScroll,
    postToRN,
  })
  function frame(ms = 16) {
    now += ms
    const pending = [...frames.values()]
    frames.clear()
    pending.forEach((callback) => callback())
  }
  function settle() {
    now += 200
    const pending = [...timers.values()]
    timers.clear()
    pending.forEach((callback) => callback())
  }
  function dragUp(to = 50) {
    events.touchstart({ touches: [{ clientY: 100 }] })
    events.touchmove({ touches: [{ clientY: 200 }] })
    root.scrollTop = to
    events.scroll()
    events.touchend()
  }
  return {
    controller,
    root,
    events,
    windows,
    loads,
    frame,
    settle,
    dragUp,
    resize: () => resize(),
    frames,
    ensureBottomWindow,
    postToRN,
  }
}

describe('native bottom-follow intent and layout', () => {
  it('keeps cold entry at the actual end after delayed Markdown and viewport layout', () => {
    const h = scrollHarness()
    h.controller.reset(true)
    h.controller.schedule()
    h.frame()
    h.root.scrollHeight += 1200
    h.root.clientHeight -= 70
    h.resize()
    // Correct before the next paint, rather than flash the previous offset.
    expect(h.root.scrollTop).toBe(1670)
    h.frame()
    expect(h.root.scrollTop).toBe(1670)
    expect(h.controller.canFollow()).toBe(true)
  })

  it('does not drop a final update inside the programmatic scroll protection window', () => {
    const h = scrollHarness()
    h.controller.resume(false)
    h.root.scrollHeight += 500
    h.controller.schedule()
    h.frame(20)
    expect(h.root.scrollTop).toBe(900)
  })

  it('does not mistake a geometry-generated scroll event for user reading history', () => {
    const h = scrollHarness()
    h.frame(300)
    h.root.scrollHeight += 800
    h.events.scroll()
    h.frame()
    expect(h.controller.canFollow()).toBe(true)
    expect(h.root.scrollTop).toBe(1200)
  })

  it('resolves send animation against changing keyboard, composer and message geometry', () => {
    const h = scrollHarness()
    h.dragUp()
    h.settle()
    h.controller.resume(true)
    h.frame(100)
    h.root.scrollHeight += 900
    h.root.clientHeight += 260 // Keyboard dismissed; composer also shrinks.
    h.resize()
    h.frame(150)
    expect(h.root.scrollTop).toBe(1040)
    h.root.scrollHeight += 60 // Final Markdown layout after the animation.
    h.resize()
    h.frame()
    expect(h.root.scrollTop).toBe(1100)
  })

  it('cancels queued and animated bottom scrolling immediately on a user drag', () => {
    const h = scrollHarness()
    h.controller.resume(true)
    h.frame(50)
    h.dragUp(80)
    h.root.scrollHeight += 500
    h.resize()
    h.frame(250)
    h.settle()
    h.frame()
    expect(h.root.scrollTop).toBe(80)
    expect(h.controller.canFollow()).toBe(false)
  })

  it('does not pull a historical reader down on image load or keyboard resize', () => {
    const h = scrollHarness()
    h.dragUp(20)
    h.settle()
    h.root.scrollHeight += 1000
    h.loads.load()
    h.windows.resize()
    h.frame()
    expect(h.root.scrollTop).toBe(20)
  })

  it('a tap does not lose follow intent if content grows while the finger is down', () => {
    const h = scrollHarness()
    h.events.touchstart()
    h.root.scrollHeight += 500
    h.resize()
    h.events.touchend()
    h.frame()
    expect(h.root.scrollTop).toBe(900)
  })

  it('reattaches after the reader scrolls back to the latest content', () => {
    const h = scrollHarness()
    h.dragUp()
    h.settle()
    h.events.touchstart({ touches: [{ clientY: 200 }] })
    h.events.touchmove({ touches: [{ clientY: 100 }] })
    h.root.scrollTop = 400
    h.events.scroll()
    h.events.touchend()
    h.settle()
    h.root.scrollHeight += 500
    h.resize()
    h.frame()
    expect(h.root.scrollTop).toBe(900)
  })

  it('does not snap a near-bottom drag to the end without new messages', () => {
    const h = scrollHarness()
    h.dragUp(250) // 150 px above the end.
    h.settle()
    h.events.touchstart({ touches: [{ clientY: 200 }] })
    h.events.touchmove({ touches: [{ clientY: 100 }] })
    h.root.scrollTop = 385 // Still 15 px above the end.
    h.events.scroll()
    h.events.touchend()
    h.settle()
    h.frame()
    expect(h.root.scrollTop).toBe(385)
    expect(h.controller.canFollow()).toBe(false)

    h.root.scrollHeight += 300
    h.resize()
    h.frame()
    expect(h.root.scrollTop).toBe(385)
  })

  it('stops scheduling work once the layout is settled and reports the final distance', () => {
    const h = scrollHarness()
    h.controller.resume(false)
    h.resize()
    h.frame()
    expect(h.frames.size).toBe(0)
    h.settle()
    expect(h.postToRN).toHaveBeenLastCalledWith(expect.objectContaining({ distanceFromBottom: 0 }))
  })

  it('keeps explicit historical restoration detached until resume is requested', () => {
    const h = scrollHarness()
    h.controller.reset(false)
    h.root.scrollTop = 40
    h.resize()
    h.frame()
    expect(h.root.scrollTop).toBe(40)
    h.controller.resume(false)
    expect(h.root.scrollTop).toBe(400)
  })
})

describe('bottom-follow integration with virtual messages', () => {
  it('reanchors cold entry when native viewport layout arrives after initial positioning', () => {
    const h = createHarness()
    h.dispatch({ type: 'init', messages: createMessages(30), runPhase: 'idle' })
    h.flushAnimationFrames()
    h.scrollRoot.scrollHeight += 1000
    h.dispatch({ type: 'viewportChanged' })
    h.flushAnimationFrames()
    expect(h.scrollRoot.scrollTop).toBe(h.scrollRoot.scrollHeight)
  })

  it('materializes the new tail even if content grew more than the near-bottom threshold', () => {
    const h = createHarness()
    h.dispatch({ type: 'init', messages: createMessages(100), runPhase: 'idle' })
    h.flushAnimationFrames()
    h.scrollRoot.scrollHeight += 1000
    h.dispatch({
      type: 'addMessages',
      messages: [{ id: 'new-tail', role: 'agent', ts: 999999999, content: 'Newest actual answer' }],
    })
    h.flushAnimationFrames()
    expect(h.getHtml()).toContain('Newest actual answer')
    expect(h.scrollRoot.scrollTop).toBe(h.scrollRoot.scrollHeight)
  })

  it('explicit send/resume leaves a historical window and remains attached through native layout', () => {
    const h = createHarness()
    h.dispatch({ type: 'init', messages: createMessages(100), runPhase: 'idle' })
    h.flushAnimationFrames()
    h.setScrollTop(100)
    h.dispatch({ type: 'scrollToBottom', animated: false })
    h.dispatch({
      type: 'addMessage',
      message: { id: 'outgoing', role: 'user', ts: 999999999, content: 'New local send' },
    })
    h.dispatch({ type: 'viewportChanged' })
    h.flushAnimationFrames()
    expect(h.getHtml()).toContain('New local send')
    expect(h.scrollRoot.scrollTop).toBe(h.scrollRoot.scrollHeight)
  })
})
