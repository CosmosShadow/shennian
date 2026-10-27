// @arch docs/architecture/app/modular-features.md#移动端长对话渲染
// @test src/__tests__/chat-webview-script.test.ts

;(function () {
  'use strict'

  var MAX_RENDERED_ITEMS = 48
  var INITIAL_BOTTOM_RENDERED_ITEMS = 16
  var WINDOW_SHIFT_ITEMS = 16
  var WINDOW_OVERSCAN_PX = 640
  var MAX_HTML_CACHE_ITEMS = 160

  function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max))
  }

  function createVirtualRenderer(config) {
    var container = config.container
    var scrollRoot = config.scrollRoot
    var items = []
    var start = 0
    var end = 0
    var heightCache = {}
    var htmlCache = {}
    var htmlCacheOrder = []
    var rendering = false

    function itemMessages(item) {
      if (!item) return []
      if (item.type === 'message') return item.message ? [item.message] : []
      var messages = item.messages ? item.messages.slice() : []
      if (item.finalMessage) messages.push(item.finalMessage)
      return messages
    }

    function itemSignature(item) {
      var messages = itemMessages(item)
      var parts = [item.type, item.key]
      for (var i = 0; i < messages.length; i++) {
        parts.push(messages[i].id + ':' + config.getMessageVersion(messages[i].id))
      }
      return parts.join('|')
    }

    function rememberHtml(key, entry) {
      htmlCache[key] = entry
      var existingIndex = htmlCacheOrder.indexOf(key)
      if (existingIndex >= 0) htmlCacheOrder.splice(existingIndex, 1)
      htmlCacheOrder.push(key)
      while (htmlCacheOrder.length > MAX_HTML_CACHE_ITEMS) {
        var oldest = htmlCacheOrder.shift()
        if (oldest != null) delete htmlCache[oldest]
      }
    }

    function renderItemCached(item) {
      var signature = itemSignature(item)
      var cached = htmlCache[item.key]
      if (cached && cached.signature === signature) {
        rememberHtml(item.key, cached)
        return cached.html
      }
      var html = config.renderItemHtml(item)
      rememberHtml(item.key, { signature: signature, html: html })
      return html
    }

    function estimatedHeight(item, index) {
      var signature = itemSignature(item)
      var cached = heightCache[item.key]
      var separator = hasTimeSeparator(index)
      if (cached && cached.signature === signature && cached.separator === separator) {
        return cached.height
      }

      var messages = itemMessages(item)
      var characters = 0
      var attachments = 0
      for (var i = 0; i < messages.length; i++) {
        var message = messages[i]
        if (item.type === 'collapsed-run' && message !== item.finalMessage) continue
        characters += String(message.content || '').length
        characters += String(message.thinking || '').length
        attachments += message.attachments ? message.attachments.length : 0
      }
      var textLines = Math.ceil(characters / 28)
      var estimate = clamp(72 + textLines * 22 + attachments * 92, 72, 1800)
      if (item.type === 'tool-group') estimate = clamp(54 + messages.length * 38, 72, 720)
      if (item.type === 'collapsed-run') {
        if (item.leadingMessages && item.leadingMessages.length > 0) estimate += 44
        if (item.trailingTools && item.trailingTools.length > 0) estimate += 44
      }
      if (separator) estimate += 40
      return estimate
    }

    function hasTimeSeparator(index) {
      if (index === 0) return true
      if (items[index].continuesTurn) return false
      return config.isTimeSeparated(items[index - 1].lastTs, items[index].ts)
    }

    function sumHeights(from, to) {
      var total = 0
      for (var i = from; i < to; i++) total += estimatedHeight(items[i], i)
      return Math.max(0, Math.round(total))
    }

    function itemBlockHtml(item, index) {
      var separator = hasTimeSeparator(index) ? config.timeSeparatorHtml(item.ts) : ''
      return (
        '<div class="chat-virtual-item" data-virtual-key="' +
        config.escapeHtml(item.key) +
        '">' +
        separator +
        renderItemCached(item) +
        '</div>'
      )
    }

    function measureRenderedItems() {
      if (!container || typeof container.querySelectorAll !== 'function') return
      var nodes = container.querySelectorAll('.chat-virtual-item')
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i]
        var key = node.getAttribute('data-virtual-key')
        var index = findItemIndexByKey(key)
        var height = Number(node.offsetHeight)
        if (!key || index < 0 || !isFinite(height) || height <= 0) continue
        heightCache[key] = {
          signature: itemSignature(items[index]),
          separator: hasTimeSeparator(index),
          height: height,
        }
      }
    }

    function captureAnchor() {
      if (!container || typeof container.querySelectorAll !== 'function') return null
      var nodes = container.querySelectorAll('.chat-virtual-item')
      if (!nodes || nodes.length === 0) return null
      var viewportTop = scrollRoot.scrollTop
      var anchor = nodes[0]
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i]
        var top = Number(node.offsetTop) || 0
        var height = Number(node.offsetHeight) || 0
        if (top + height > viewportTop + 1) {
          anchor = node
          break
        }
      }
      return {
        key: anchor.getAttribute('data-virtual-key'),
        offset: viewportTop - (Number(anchor.offsetTop) || 0),
      }
    }

    function restoreAnchor(anchor, fallbackScrollTop) {
      if (!anchor || !anchor.key) {
        if (typeof fallbackScrollTop === 'number') scrollRoot.scrollTop = fallbackScrollTop
        return
      }
      var selector = '[data-virtual-key="' + config.cssEscape(anchor.key) + '"]'
      var node = container.querySelector(selector)
      if (!node) {
        if (typeof fallbackScrollTop === 'number') scrollRoot.scrollTop = fallbackScrollTop
        return
      }
      config.lockProgrammaticScroll()
      scrollRoot.scrollTop = Math.max(0, (Number(node.offsetTop) || 0) + anchor.offset)
    }

    function renderWindow(options) {
      if (window._shennianPerfEnabled) {
        var metrics = window._shennianPerf || (window._shennianPerf = {})
        var current = metrics['webview.render_window'] || { count: 0, totalMs: 0, maxMs: 0 }
        metrics['webview.render_window'] = {
          count: current.count + 1,
          totalMs: current.totalMs,
          maxMs: current.maxMs,
        }
      }
      var opts = options || {}
      var anchor = opts.anchor || (opts.preserveViewport ? captureAnchor() : null)
      var fallbackScrollTop = scrollRoot.scrollTop
      var expanded = config.snapshotExpandedDetails(container)
      measureRenderedItems()

      start = clamp(start, 0, Math.max(0, items.length - 1))
      end = clamp(end, start, items.length)
      if (items.length > 0 && end === start) end = Math.min(items.length, start + MAX_RENDERED_ITEMS)

      var topHeight = sumHeights(0, start)
      var bottomHeight = sumHeights(end, items.length)
      var html =
        '<div class="chat-virtual-spacer" data-virtual-spacer="top" style="height:' +
        topHeight +
        'px"></div><div class="chat-virtual-window">'
      for (var i = start; i < end; i++) html += itemBlockHtml(items[i], i)
      if (end === items.length && config.shouldShowTypingIndicator()) html += config.typingHtml()
      html +=
        '</div><div class="chat-virtual-spacer" data-virtual-spacer="bottom" style="height:' +
        bottomHeight +
        'px"></div>'

      rendering = true
      container.innerHTML = html
      config.restoreExpandedDetails(container, expanded)
      config.afterRender()
      measureRenderedItems()
      if (anchor) restoreAnchor(anchor, fallbackScrollTop)
      if (opts.shouldStickToBottom) config.scheduleScrollToBottom()
      rendering = false
    }

    function rebuildItems() {
      items = config.buildRenderItems(config.getMessages())
    }

    function selectBottomWindow(limit) {
      var windowSize = Math.max(1, Number(limit) || MAX_RENDERED_ITEMS)
      end = items.length
      start = Math.max(0, end - Math.min(MAX_RENDERED_ITEMS, windowSize))
    }

    function findItemIndexByKey(key) {
      if (!key) return -1
      for (var i = 0; i < items.length; i++) {
        if (items[i].key === key) return i
      }
      return -1
    }

    function findItemIndexByMessageId(messageId) {
      for (var i = 0; i < items.length; i++) {
        var messages = itemMessages(items[i])
        for (var j = 0; j < messages.length; j++) {
          if (messages[j].id === messageId) return i
        }
      }
      return -1
    }

    function findItemIndexAtOffset(offset) {
      var target = Math.max(0, Number(offset) || 0)
      var total = 0
      for (var i = 0; i < items.length; i++) {
        total += estimatedHeight(items[i], i)
        if (total > target) return i
      }
      return Math.max(0, items.length - 1)
    }

    function reset(initialScroll) {
      items = []
      start = 0
      end = 0
      heightCache = {}
      htmlCache = {}
      htmlCacheOrder = []
      rebuildItems()
      var restoreIndex = -1
      if (initialScroll && initialScroll.kind === 'position') {
        var restoreOffset = initialScroll.scrollTop
        if (
          items.length > MAX_RENDERED_ITEMS &&
          typeof initialScroll.distanceFromBottom === 'number' &&
          isFinite(initialScroll.distanceFromBottom)
        ) {
          restoreOffset = Math.max(
            0,
            sumHeights(0, items.length) -
              scrollRoot.clientHeight -
              Math.max(0, initialScroll.distanceFromBottom),
          )
        }
        restoreIndex = findItemIndexAtOffset(restoreOffset)
        start = Math.max(0, restoreIndex - WINDOW_SHIFT_ITEMS)
        end = Math.min(items.length, start + MAX_RENDERED_ITEMS)
      } else {
        // Cold-open only needs enough latest content to fill the screen. A
        // smaller first window lets WebKit paint promptly even when the loaded
        // history contains many long Markdown replies. Scrolling upward grows
        // the regular window on demand; the full model is already available.
        selectBottomWindow(INITIAL_BOTTOM_RENDERED_ITEMS)
      }
      renderWindow()
      config.lockProgrammaticScroll()
      if (initialScroll && initialScroll.kind === 'position') {
        var restoreTarget = restoreIndex >= 0 && items[restoreIndex]
          ? container.querySelector(
              '[data-virtual-key="' + config.cssEscape(items[restoreIndex].key) + '"]',
            )
          : null
        var restoredTop = items.length > MAX_RENDERED_ITEMS && restoreTarget
          ? Number(restoreTarget.offsetTop) || 0
          : initialScroll.scrollTop
        scrollRoot.scrollTop = clamp(
          restoredTop,
          0,
          Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight),
        )
      } else {
        scrollRoot.scrollTop = scrollRoot.scrollHeight
      }
    }

    function refresh(options) {
      var opts = options || {}
      var anchor = opts.preserveViewport ? captureAnchor() : null
      var oldStartKey = items[start] ? items[start].key : null
      var oldWindowSize = Math.max(1, end - start)
      rebuildItems()

      if (opts.preferBottom) {
        selectBottomWindow()
      } else {
        var nextStart = findItemIndexByKey(oldStartKey)
        if (nextStart >= 0) {
          start = nextStart
          end = Math.min(items.length, start + Math.min(MAX_RENDERED_ITEMS, oldWindowSize))
        } else {
          start = clamp(start, 0, Math.max(0, items.length - MAX_RENDERED_ITEMS))
          end = Math.min(items.length, start + MAX_RENDERED_ITEMS)
        }
      }
      renderWindow({
        anchor: anchor,
        preserveViewport: opts.preserveViewport,
        shouldStickToBottom: opts.shouldStickToBottom,
      })
    }

    function prepend() {
      var anchor = captureAnchor()
      rebuildItems()
      var anchorIndex = anchor ? findItemIndexByKey(anchor.key) : -1
      if (anchorIndex >= 0) {
        start = Math.max(0, anchorIndex - WINDOW_SHIFT_ITEMS)
        end = Math.min(items.length, start + MAX_RENDERED_ITEMS)
      } else {
        start = 0
        end = Math.min(items.length, MAX_RENDERED_ITEMS)
      }
      renderWindow({ anchor: anchor, preserveViewport: true })
    }

    function syncModel() {
      rebuildItems()
    }

    function shiftWindow(nextStart, preserveAbsolutePosition) {
      var absoluteScrollTop = scrollRoot.scrollTop
      var anchor = preserveAbsolutePosition ? null : captureAnchor()
      start = clamp(nextStart, 0, Math.max(0, items.length - MAX_RENDERED_ITEMS))
      end = Math.min(items.length, start + MAX_RENDERED_ITEMS)
      renderWindow({ anchor: anchor, preserveViewport: !preserveAbsolutePosition })
      if (preserveAbsolutePosition) {
        config.lockProgrammaticScroll()
        scrollRoot.scrollTop = clamp(
          absoluteScrollTop,
          0,
          Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight),
        )
      }
    }

    function handleScroll() {
      if (rendering || (start === 0 && end === items.length)) return
      var nodes = container.querySelectorAll('.chat-virtual-item')
      if (!nodes || nodes.length === 0) return
      var first = nodes[0]
      var last = nodes[nodes.length - 1]
      var viewportTop = scrollRoot.scrollTop
      var viewportBottom = viewportTop + scrollRoot.clientHeight
      var firstTop = Number(first.offsetTop) || 0
      var lastBottom = (Number(last.offsetTop) || 0) + (Number(last.offsetHeight) || 0)

      if (start > 0 && viewportTop < firstTop + WINDOW_OVERSCAN_PX) {
        var landedAboveWindow = viewportTop < firstTop
        var upwardTarget = landedAboveWindow
          ? findItemIndexAtOffset(viewportTop)
          : start - WINDOW_SHIFT_ITEMS
        shiftWindow(
          Math.max(0, upwardTarget - (landedAboveWindow ? WINDOW_SHIFT_ITEMS : 0)),
          landedAboveWindow,
        )
        return
      }
      if (end < items.length && viewportBottom > lastBottom - WINDOW_OVERSCAN_PX) {
        var landedBelowWindow = viewportBottom > lastBottom
        var downwardTarget = landedBelowWindow
          ? findItemIndexAtOffset(viewportTop)
          : start + WINDOW_SHIFT_ITEMS
        shiftWindow(downwardTarget, landedBelowWindow)
      }
    }

    function scrollToTop(animated) {
      start = 0
      end = Math.min(items.length, MAX_RENDERED_ITEMS)
      renderWindow()
      config.lockProgrammaticScroll()
      if (animated !== false && scrollRoot.scrollTo) {
        scrollRoot.scrollTo({ top: 0, behavior: 'smooth' })
      } else {
        scrollRoot.scrollTop = 0
      }
    }

    function ensureBottomWindow() {
      if (end === items.length) return
      selectBottomWindow()
      renderWindow()
    }

    function scrollToBottom(animated) {
      selectBottomWindow()
      renderWindow()
      config.scrollToBottomDom(animated)
    }

    function scrollToMessage(messageId, animated) {
      var index = findItemIndexByMessageId(messageId)
      if (index < 0) return
      start = clamp(index - WINDOW_SHIFT_ITEMS, 0, Math.max(0, items.length - MAX_RENDERED_ITEMS))
      end = Math.min(items.length, start + MAX_RENDERED_ITEMS)
      renderWindow()
      var target = container.querySelector('[data-id="' + config.cssEscape(messageId) + '"]')
      if (!target) return
      config.lockProgrammaticScroll()
      var top = Math.max(0, target.offsetTop - 28)
      if (animated !== false && scrollRoot.scrollTo) {
        scrollRoot.scrollTo({ top: top, behavior: 'smooth' })
      } else {
        scrollRoot.scrollTop = top
      }
    }

    function invalidateMessage(messageId) {
      var index = findItemIndexByMessageId(messageId)
      if (index < 0) return false
      var key = items[index].key
      delete htmlCache[key]
      delete heightCache[key]
      var orderIndex = htmlCacheOrder.indexOf(key)
      if (orderIndex >= 0) htmlCacheOrder.splice(orderIndex, 1)
      return index >= start && index < end
    }

    function buildFullHtml() {
      rebuildItems()
      var html = ''
      for (var i = 0; i < items.length; i++) html += itemBlockHtml(items[i], i)
      return html
    }

    return {
      reset: reset,
      refresh: refresh,
      prepend: prepend,
      syncModel: syncModel,
      handleScroll: handleScroll,
      scrollToTop: scrollToTop,
      scrollToBottom: scrollToBottom,
      ensureBottomWindow: ensureBottomWindow,
      scrollToMessage: scrollToMessage,
      invalidateMessage: invalidateMessage,
      buildFullHtml: buildFullHtml,
    }
  }

  window.ShennianChatVirtualization = {
    createVirtualRenderer: createVirtualRenderer,
    maxRenderedItems: MAX_RENDERED_ITEMS,
  }
})()
