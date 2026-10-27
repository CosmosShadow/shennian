// @covers packages/app/src/components/chat/webview/chat.js

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'

type RootHandler = (() => void) | null
type MessageHandler = ((event: { data: string }) => void) | null

export function loadChatScript() {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const webviewDir = resolve(__dirname, '../components/chat/webview')
  return [
    'workerCard.js',
    'chatCapture.js',
    'chatRender.js',
    'chatMarkdown.js',
    'chatCopy.js',
    'chatHooks.js',
    'chatVirtualization.js',
    'chatMessageRendering.js',
    'chatScroll.js',
    'chat.js',
  ]
    .map((filename) => readFileSync(resolve(webviewDir, filename), 'utf-8'))
    .join('\n')
}

export function createHarness(opts?: {
  includeNativeBridge?: boolean
  i18n?: Record<string, string>
}) {
  let touching = false
  let now = 0
  let nextRafId = 1
  let nextTimerId = 1
  const rafQueue = new Map<number, () => void>()
  const timerQueue = new Map<number, () => void>()
  const documentHandlers = new Map<string, Array<(event: Record<string, unknown>) => void>>()
  let windowMessageHandler: MessageHandler = null
  const rootHandlers: Record<string, RootHandler> = {
    scroll: null,
    touchstart: null,
    touchend: null,
    touchcancel: null,
  }
  const postedMessages: Array<Record<string, unknown>> = []
  const copiedTexts: string[] = []
  const parsedMarkdownInputs: string[] = []
  const renderedMath: Array<{ latex: string; displayMode: boolean }> = []
  const hookedNodes: MockNode[] = []
  let openMessageActionRow: {
    classList: {
      contains(name: string): boolean
      add(name: string): void
      remove(name: string): void
    }
  } | null = null
  let markedRenderer: {
    link?: (token: { href: string; text: string; tokens: Array<{ text: string }> }) => string
    codespan?: (token: { text: string }) => string
    heading?: (token: { depth: number; text: string; tokens: Array<{ text: string }> }) => string
  } = {}

  type MockNode = {
    _hooked?: boolean
    _processHooked?: boolean
    _toolDetailHooked?: boolean
    href?: string
    open?: boolean
    tagName?: string
    classList: { contains(name: string): boolean }
    getAttribute(name: string): string | null
    closest(selector: string): { getAttribute(name: string): string | null } | null
    addEventListener(type: string, handler: (event?: { preventDefault?: () => void }) => void): void
    trigger(type: string): void
  }

  type MockElement = {
    _html: string
    innerHTML: string
    offsetTop: number
    offsetHeight: number
    open?: boolean
    firstChild?: MockElement | null
    getAttribute(name: string): string | null
    querySelectorAll(selector?: string): MockElement[]
    replaceWith(next: MockElement | null | undefined): void
  }

  function createMockElement(
    html: string,
    options?: {
      container?: typeof container
      start?: number
      end?: number
      offsetTop?: number
      offsetHeight?: number
    },
  ): MockElement {
    return {
      _html: html,
      offsetTop: options?.offsetTop ?? 0,
      offsetHeight: options?.offsetHeight ?? 100,
      get innerHTML() {
        return this._html
      },
      set innerHTML(value: string) {
        this._html = value
      },
      open: /^\s*<details\b[^>]*\sopen(?:\s|>|=)/.test(html),
      get firstChild() {
        return this._html ? createMockElement(this._html) : null
      },
      getAttribute(name: string) {
        const match = new RegExp(`${name}="([^"]*)"`).exec(this._html)
        return match?.[1] ?? null
      },
      querySelectorAll(selector?: string) {
        if (String(selector || '') !== 'details[data-detail-key]') return []
        return findDetailElements(this._html, this)
      },
      replaceWith(next) {
        if (!options?.container || options.start == null || options.end == null || !next) return
        options.container.innerHTML =
          options.container.innerHTML.slice(0, options.start) +
          next._html +
          options.container.innerHTML.slice(options.end)
      },
    }
  }

  function findDetailElements(html: string, target: { innerHTML: string }): MockElement[] {
    const details: MockElement[] = []
    const re = /<details\b[^>]*data-detail-key="([^"]+)"[^>]*>/g
    let match: RegExpExecArray | null
    while ((match = re.exec(html))) {
      const tag = match[0]
      const key = match[1]
      const index = match.index
      const element = createMockElement(tag)
      element.open = /\sopen(?:\s|>|=)/.test(tag)
      element.getAttribute = (name: string) => (name === 'data-detail-key' ? key : null)
      Object.defineProperty(element, 'open', {
        get() {
          return /\sopen(?:\s|>|=)/.test(tag)
        },
        set(value: boolean) {
          if (!value || tag.includes(' open')) return
          const before = target.innerHTML
          target.innerHTML =
            before.slice(0, index) +
            tag.replace('<details', '<details open') +
            before.slice(index + tag.length)
        },
      })
      details.push(element)
    }
    return details
  }

  function createMockNode(
    attrs: Record<string, string>,
    classes: string[],
    href?: string,
    tagName?: string,
  ): MockNode {
    const handlers = new Map<string, (event?: { preventDefault?: () => void }) => void>()
    return {
      href,
      tagName,
      open: false,
      classList: { contains: (name: string) => classes.includes(name) },
      getAttribute: (name: string) => attrs[name] ?? null,
      closest(selector) {
        if (selector !== '[data-id]' || !attrs['data-message-id']) return null
        return {
          getAttribute: (name: string) =>
            name === 'data-id' ? attrs['data-message-id'] ?? null : null,
        }
      },
      addEventListener(type, handler) {
        handlers.set(type, handler)
      },
      trigger(type) {
        if (type === 'toggle') this.open = true
        handlers.get(type)?.({ preventDefault() {} })
      },
    }
  }

  const computeHeight = (html: string) => {
    const virtualItemCount = (html.match(/class="chat-virtual-item"/g) ?? []).length
    if (virtualItemCount > 0 || html.includes('data-virtual-spacer=')) {
      const spacerHeight = [...html.matchAll(/data-virtual-spacer="(?:top|bottom)" style="height:(\d+)px"/g)]
        .reduce((sum, match) => sum + Number(match[1]), 0)
      return virtualItemCount * 100 + spacerHeight + 16
    }
    const messageCount = (html.match(/data-id="/g) ?? []).length
    const separatorCount = (html.match(/time-separator/g) ?? []).length
    return messageCount * 100 + separatorCount * 24 + 16
  }

  const decodeHtmlAttr = (value: string) =>
    value
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')

  const scrollRoot = {
    scrollHeight: 0,
    clientHeight: 400,
    scrollTop: 0,
    addEventListener(type: string, handler: () => void) {
      if (type in rootHandlers) rootHandlers[type] = handler
    },
    scrollTo({ top }: { top: number }) {
      this.scrollTop = top
      rootHandlers.scroll?.()
    },
  }

  const container = {
    addEventListener() {},
    _html: '',
    get innerHTML() {
      return this._html
    },
    set innerHTML(value: string) {
      this._html = value
      scrollRoot.scrollHeight = computeHeight(value)
    },
    insertAdjacentHTML(_position: string, value: string) {
      this.innerHTML = this._html + value
    },
    querySelector(selector?: string) {
      const selectorText = String(selector || '')
      const virtualKeyMatch = /^\[data-virtual-key="([^"]+)"\]$/.exec(selectorText)
      if (virtualKeyMatch) {
        return getVirtualElements().find(
          (element) => element.getAttribute('data-virtual-key') === virtualKeyMatch[1],
        ) ?? null
      }
      const idMatch = /^\[data-id="([^"]+)"\]$/.exec(selectorText)
      if (!idMatch) return null
      const startToken = `<div class="msg-row`
      let start = this._html.indexOf(`data-id="${idMatch[1]}"`)
      if (start < 0) return null
      start = this._html.lastIndexOf(startToken, start)
      if (start < 0) return null
      const nextStart = this._html.indexOf(startToken, start + startToken.length)
      const end = nextStart >= 0 ? nextStart : this._html.length
      const owner = getVirtualElements().find((element) => element._html.includes(`data-id="${idMatch[1]}"`))
      return createMockElement(this._html.slice(start, end), {
        container: this,
        start,
        end,
        offsetTop: owner?.offsetTop,
        offsetHeight: owner?.offsetHeight,
      })
    },
    querySelectorAll(selector?: string) {
      const selectorText = String(selector || '')
      if (selectorText === '.chat-virtual-item') return getVirtualElements()
      if (selectorText === 'details[data-detail-key]') {
        return findDetailElements(this._html, this)
      }
      if (selectorText.includes('tool-disclosure') || selectorText.includes('tool-group-item')) {
        const nextHookedNodes: MockNode[] = []
        if (selectorText.includes('tool-disclosure')) {
          const detailRe = /<details[^>]*class="([^"]*tool-disclosure[^"]*)"[^>]*data-tool-message-id="([^"]*)"[^>]*data-tool-index="([^"]*)"[^>]*data-tool-name="([^"]*)"[^>]*>/g
          let match: RegExpExecArray | null
          while ((match = detailRe.exec(this._html))) {
            nextHookedNodes.push(
              createMockNode(
                {
                  'data-tool-message-id': match[2],
                  'data-tool-index': match[3],
                  'data-tool-name': decodeHtmlAttr(match[4]),
                },
                match[1].split(/\s+/),
                undefined,
                'DETAILS',
              ),
            )
          }
        }
        if (selectorText.includes('tool-group-item')) {
          const itemRe = /<details[^>]*class="([^"]*tool-group-item[^"]*)"[^>]*data-tool-message-id="([^"]*)"[^>]*data-tool-index="([^"]*)"[^>]*data-tool-name="([^"]*)"[^>]*>/g
          let match: RegExpExecArray | null
          while ((match = itemRe.exec(this._html))) {
            nextHookedNodes.push(
              createMockNode(
                {
                  'data-tool-message-id': match[2],
                  'data-tool-index': match[3],
                  'data-tool-name': decodeHtmlAttr(match[4]),
                },
                match[1].split(/\s+/),
                undefined,
                'DETAILS',
              ),
            )
          }
        }
        if (nextHookedNodes.length > 0) {
          hookedNodes.length = 0
          hookedNodes.push(...nextHookedNodes)
          return hookedNodes
        }
        return []
      }
      if (selectorText === '.attachment-image-placeholder') {
        const nodes: MockNode[] = []
        const placeholderRe = /<button[^>]*class="[^"]*attachment-image-placeholder[^"]*"[^>]*>/g
        let match: RegExpExecArray | null
        while ((match = placeholderRe.exec(this._html))) {
          const tag = match[0]
          const before = this._html.slice(0, match.index)
          const messageIds = [...before.matchAll(/data-id="([^"]+)"/g)]
          const attrs: Record<string, string> = {
            'data-message-id': messageIds[messageIds.length - 1]?.[1] ?? '',
          }
          for (const name of [
            'data-resource-path',
            'data-resource-kind',
            'data-resource-name',
            'data-resource-mime',
          ]) {
            attrs[name] = new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? ''
          }
          nodes.push(createMockNode(attrs, ['attachment-image-placeholder']))
        }
        return nodes
      }
      if (!selectorText.includes('data-resource-path') && !selectorText.includes('a[href]')) {
        return []
      }
      const nextHookedNodes: MockNode[] = []
      if (selectorText.includes('data-resource-path')) {
        const resourceRe = /<button[^>]*data-resource-path="([^"]+)"[^>]*>/g
        let match: RegExpExecArray | null
        while ((match = resourceRe.exec(this._html))) {
          const tag = match[0]
          const classMatch = /class="([^"]+)"/.exec(tag)
          const kindMatch = /data-resource-kind="([^"]+)"/.exec(tag)
          nextHookedNodes.push(
            createMockNode(
              {
                'data-resource-path': match[1],
                'data-resource-kind': kindMatch?.[1] ?? '',
              },
              classMatch?.[1].split(/\s+/) ?? [],
            ),
          )
        }
      }
      if (selectorText.includes('a[href]')) {
        const linkRe = /<a[^>]*href="([^"]+)"[^>]*>/g
        let match: RegExpExecArray | null
        while ((match = linkRe.exec(this._html))) {
          nextHookedNodes.push(
            createMockNode(
              { href: match[1] },
              [],
              match[1].startsWith('http') ? match[1] : `http://localhost/${match[1]}`,
            ),
          )
        }
      }
      if (nextHookedNodes.length > 0) {
        hookedNodes.length = 0
        hookedNodes.push(...nextHookedNodes)
      }
      return hookedNodes
    },
  }

  function getTopVirtualSpacerHeight() {
    const match = /data-virtual-spacer="top" style="height:(\d+)px"/.exec(container.innerHTML)
    return Number(match?.[1] ?? 0)
  }

  function getVirtualElements(): MockElement[] {
    const elements: MockElement[] = []
    const matches = [...container.innerHTML.matchAll(/<div class="chat-virtual-item" data-virtual-key="([^"]+)">/g)]
    const top = getTopVirtualSpacerHeight()
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index]
      const start = match.index ?? 0
      const end = matches[index + 1]?.index ?? container.innerHTML.indexOf('</div><div class="chat-virtual-spacer"', start)
      const html = container.innerHTML.slice(start, end > start ? end : undefined)
      const element = createMockElement(html, {
        offsetTop: top + index * 100,
        offsetHeight: 100,
      })
      element.getAttribute = (name: string) =>
        name === 'data-virtual-key' ? match[1] : null
      elements.push(element)
    }
    return elements
  }
  const typingIndicator = {
    remove() {
      container.innerHTML = container.innerHTML.replace(
        /<div class="typing-row" id="typing-indicator">.*?<\/div><\/div>/,
        '',
      )
    },
  }

  const context = {
    console,
    katex: {
      renderToString(latex: string, options: { displayMode?: boolean }) {
        renderedMath.push({ latex, displayMode: options.displayMode === true })
        const escaped = String(latex)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
        return `<math data-display="${options.displayMode === true}"><mtext>${escaped}</mtext></math>`
      },
    },
    marked: {
      setOptions() {},
      use(options: { renderer?: typeof markedRenderer }) {
        markedRenderer = options.renderer ?? {}
      },
      parse(content: string) {
        parsedMarkdownInputs.push(content)
        const escape = (value: string) =>
          value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        const inline = (value: string) =>
          escape(value)
            .replace(/`([^`]+)`/g, (_match, code) => {
              if (markedRenderer.codespan) {
                return markedRenderer.codespan({ text: code })
              }
              return `<code>${code}</code>`
            })
            .replace(/\*\*([^*]+)\*\*/g, (_match, text) => `<strong>${text}</strong>`)
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text, href) => {
              const rawHref = String(href).replace(/&lt;/g, '<').replace(/&gt;/g, '>')
              if (markedRenderer.link) {
                return markedRenderer.link.call(
                  {
                    parser: {
                      parseInline: (tokens: Array<{ text: string }>) =>
                        tokens.map((token) => token.text).join(''),
                    },
                  },
                  { href: rawHref, text, tokens: [{ text }] },
                )
              }
              return `<a href="${rawHref}">${escape(text)}</a>`
            })
        const lines = content.split('\n')
        let html = ''
        let paragraph: string[] = []
        const closeParagraph = () => {
          if (!paragraph.length) return
          html += `<p>${inline(paragraph.join('\n'))}</p>`
          paragraph = []
        }
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i]
          if (!line.trim()) {
            closeParagraph()
            continue
          }
          const heading = /^(#{1,6})\s+(.+)$/.exec(line)
          if (heading) {
            closeParagraph()
            const depth = heading[1].length
            const text = heading[2]
            html += markedRenderer.heading
              ? markedRenderer.heading.call(
                  { parser: { parseInline: (tokens: Array<{ text: string }>) => tokens.map((token) => inline(token.text)).join('') } },
                  { depth, text, tokens: [{ text }] },
                )
              : `<h${depth}>${inline(text)}</h${depth}>`
            continue
          }
          const bullet = /^-\s+(.+)$/.exec(line)
          if (bullet) {
            closeParagraph()
            html += `<ul><li>${inline(bullet[1])}`
            while (i + 1 < lines.length) {
              const nested = /^\s{2,}-\s+(.+)$/.exec(lines[i + 1])
              if (!nested) break
              html += `<ul><li>${inline(nested[1])}</li></ul>`
              i += 1
            }
            html += '</li></ul>'
            continue
          }
          paragraph.push(line)
        }
        closeParagraph()
        return html
      },
    },
    performance: { now: () => now },
    requestAnimationFrame(callback: (ts: number) => void) {
      const id = nextRafId++
      rafQueue.set(id, () => callback(now))
      return id
    },
    cancelAnimationFrame(id: number) {
      rafQueue.delete(id)
    },
    setTimeout(callback?: () => void) {
      const id = nextTimerId++
      if (typeof callback === 'function') timerQueue.set(id, callback)
      return id
    },
    clearTimeout(id: number) {
      timerQueue.delete(id)
    },
    navigator: {
      clipboard: {
        writeText(text: string) {
          copiedTexts.push(text)
          return Promise.resolve()
        },
      },
    },
    window: {
      _i18n: opts?.i18n,
      addEventListener(type: string, handler: MessageHandler) {
        if (type === 'message') windowMessageHandler = handler
      },
      ...(opts?.includeNativeBridge !== false
        ? {
            ReactNativeWebView: {
              postMessage(payload: string) {
                postedMessages.push(JSON.parse(payload) as Record<string, unknown>)
              },
            },
          }
        : {}),
    },
    document: {
      documentElement: {
        classList: { add() {}, remove() {} },
        style: { setProperty() {} },
      },
      getElementById(id: string) {
        if (id === 'scroll-root') return scrollRoot
        if (id === 'messages') return container
        if (id === 'typing-indicator' && container.innerHTML.includes('typing-indicator')) {
          return typingIndicator
        }
        return null
      },
      createElement() {
        return createMockElement('')
      },
      querySelector(selector: string) {
        if (
          selector === '.msg-row.msg-actions-open' &&
          openMessageActionRow?.classList.contains('msg-actions-open')
        ) {
          return openMessageActionRow
        }
        return null
      },
      addEventListener(type: string, handler: (event: Record<string, unknown>) => void) {
        const handlers = documentHandlers.get(type) ?? []
        handlers.push(handler)
        documentHandlers.set(type, handlers)
      },
    },
  }

  runInNewContext(loadChatScript(), context)

  const dispatch = (payload: unknown) => {
    const event = { data: JSON.stringify(payload) }
    windowMessageHandler?.(event)
  }

  const flushAnimationFrames = () => {
    while (rafQueue.size > 0) {
      now += 16
      const pending = [...rafQueue.entries()]
      rafQueue.clear()
      for (const [, callback] of pending) callback()
    }
  }

  const flushTimers = () => {
    while (timerQueue.size > 0) {
      const pending = [...timerQueue.entries()]
      timerQueue.clear()
      for (const [, callback] of pending) callback()
    }
  }

  return {
    dispatch,
    flushAnimationFrames,
    flushTimers,
    scrollRoot,
    getHtml: () => container.innerHTML,
    getParsedMarkdownInputs: () => parsedMarkdownInputs,
    getRenderedMath: () => renderedMath,
    getPostedMessages: () => postedMessages,
    editQueued(queueMessageId: string) {
      ;(context.window as { _editQueued?: (id: string) => void })._editQueued?.(queueMessageId)
    },
    getCopiedTexts: () => copiedTexts,
    renderToolGroupItems(messages: unknown[], start?: number, limit?: number) {
      return (
        context.window as {
          ShennianChatRender?: {
            toolGroupItemsHtml?: (items: unknown[], start?: number, limit?: number) => string
          }
        }
      ).ShennianChatRender?.toolGroupItemsHtml?.(messages, start, limit) ?? ''
    },
    getFullCaptureHtml: () =>
      (context.window as { _buildChatCaptureHtml?: () => string })._buildChatCaptureHtml?.() ?? '',
    getTopVirtualSpacerHeight,
    getFirstVisibleVirtualKey() {
      const viewportTop = scrollRoot.scrollTop
      const element = getVirtualElements().find(
        (candidate) => candidate.offsetTop + candidate.offsetHeight > viewportTop + 1,
      )
      return element?.getAttribute('data-virtual-key') ?? null
    },
    setScrollTop(top: number) {
      // This helper represents a user scroll, not a layout-generated event.
      if (!touching) rootHandlers.touchstart?.()
      now += 200
      scrollRoot.scrollTop = top
      rootHandlers.scroll?.()
      if (!touching) rootHandlers.touchend?.()
    },
    triggerRootEvent(type: 'touchstart' | 'touchend' | 'touchcancel') {
      touching = type === 'touchstart'
      rootHandlers[type]?.()
    },
    triggerCopy(code: string) {
      type MockCopyButton = {
        textContent: string
        getAttribute(name: string): string | null
        setAttribute(name: string, value: string): void
      }
      const attrs = new Map<string, string>([['data-code', code]])
      const btn: MockCopyButton = {
        textContent: 'Copy',
        getAttribute(name: string) {
          return attrs.get(name) ?? null
        },
        setAttribute(name: string, value: string) {
          attrs.set(name, value)
        },
      }
      ;(context.window as { _copyCode?: (btn: MockCopyButton) => void })._copyCode?.(btn)
      return btn
    },
    triggerRenderedMessageCopy(messageId: string) {
      type MockMessageCopyButton = {
        textContent: string
        getAttribute(name: string): string | null
        setAttribute(name: string, value: string): void
      }
      const buttonRe = new RegExp(
        `<button class="msg-copy-btn"[^>]*data-msg-id="${messageId}"[^>]*>`,
      )
      const tag = buttonRe.exec(container.innerHTML)?.[0] ?? ''
      const attrs = new Map<string, string>()
      for (const attr of ['data-copy-text', 'data-copy-label']) {
        const value = new RegExp(`${attr}="([^"]*)"`).exec(tag)?.[1]
        if (value != null) attrs.set(attr, decodeHtmlAttr(value))
      }
      const btn: MockMessageCopyButton = {
        textContent: attrs.get('data-copy-label') ?? 'Copy',
        getAttribute(name: string) {
          return attrs.get(name) ?? null
        },
        setAttribute(name: string, value: string) {
          attrs.set(name, value)
        },
      }
      ;(context.window as { _copyMessage?: (btn: MockMessageCopyButton) => void })._copyMessage?.(
        btn,
      )
      return btn
    },
    triggerMessageLongPress(x = 160, y = 240) {
      const classes = new Set(['msg-row'])
      const style: Record<string, string> = {}
      const button = { style, offsetWidth: 72, offsetHeight: 44 }
      const row = {
        classList: {
          contains(name: string) {
            return classes.has(name)
          },
          add(name: string) {
            classes.add(name)
          },
          remove(name: string) {
            classes.delete(name)
          },
        },
        querySelector(selector: string) {
          return selector === '.msg-copy-btn' ? button : null
        },
      }
      openMessageActionRow = row
      const target = {
        closest(selector: string) {
          if (selector === '.msg-row') return row
          return null
        },
      }
      const touchEvent = { target, touches: [{ clientX: x, clientY: y }] }
      for (const handler of documentHandlers.get('touchstart') ?? []) handler(touchEvent)
      flushTimers()
      for (const handler of documentHandlers.get('touchend') ?? []) handler({ target })
      let clickPrevented = false
      for (const handler of documentHandlers.get('click') ?? []) {
        handler({
          target,
          preventDefault() {
            clickPrevented = true
          },
          stopPropagation() {},
        })
      }
      return {
        isOpen: () => classes.has('msg-actions-open'),
        style,
        clickPrevented: () => clickPrevented,
      }
    },
    triggerFirstHookedNode(type: string) {
      hookedNodes[0]?.trigger(type)
    },
    triggerHookedNode(index: number, type: string) {
      hookedNodes[index]?.trigger(type)
    },
    triggerFirstToolDetail(type: 'toggle' | 'click' = 'toggle') {
      const node = hookedNodes.find(
        (item) =>
          item.getAttribute('data-tool-message-id') != null &&
          (item.classList.contains('tool-disclosure') || item.classList.contains('tool-group-item')),
      )
      node?.trigger(type)
    },
    openDetail(key: string) {
      const safeKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      container.innerHTML = container.innerHTML.replace(
        new RegExp(`<details(?![^>]*\\sopen)[^>]*data-detail-key="${safeKey}"[^>]*>`),
        (tag) => tag.replace('<details', '<details open'),
      )
    },
  }
}

export function createMessages(count: number, startTs = 1_000) {
  return Array.from({ length: count }, (_, index) => ({
    id: `m-${startTs + index}`,
    role: index % 2 === 0 ? 'user' : 'agent',
    ts: startTs + index * 60_000,
    content: `message-${index}`,
  }))
}
