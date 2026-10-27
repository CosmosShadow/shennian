// @arch docs/architecture/app/modular-features.md#移动端长对话渲染
// @test src/__tests__/chat-webview-scroll.test.ts
;(function () {
  'use strict'
  var scrollRoot = document.getElementById('scroll-root')
  var container = document.getElementById('messages')
  var _messages = []
  var _runPhase = 'idle'
  var _activeToolCallCount = null
  var _streamingMsgId = null
  var _pendingStreamingRenders = {}
  var _lastStreamingRenderAt = {}
  var _lastStreamingContent = {}
  var _messageVersions = {}
  var _virtualRenderer = null
  var _chatHooks = null
  var STREAM_RENDER_MIN_INTERVAL_MS = 120
  function streamingRenderInterval(contentLength) {
    if (contentLength > 32000) return 420
    if (contentLength > 12000) return 260
    if (contentLength > 4000) return 180
    return STREAM_RENDER_MIN_INTERVAL_MS
  }
  var messageRendering = window.ShennianChatMessageRendering.create({
    nowMs: nowMs,
    getMessages: function () { return _messages },
    getRunPhase: function () { return _runPhase },
    getActiveToolCallCount: function () { return _activeToolCallCount },
  })
  var escapeHtml = messageRendering.escapeHtml
  var renderMarkdown = messageRendering.renderMarkdown
  var isLocalResourceHref = messageRendering.isLocalResourceHref
  var normalizeLocalResourceHref = messageRendering.normalizeLocalResourceHref
  var getOpenableExternalUrl = messageRendering.getOpenableExternalUrl
  var isToolMsg = messageRendering.isToolMsg
  var i18n = messageRendering.i18n
  var summarizeToolGroup = messageRendering.summarizeToolGroup
  var toolGroupItemsHtml = messageRendering.toolGroupItemsHtml
  var toolGroupMoreHtml = messageRendering.toolGroupMoreHtml
  var isTimeSeparated = messageRendering.isTimeSeparated
  var messageHtml = messageRendering.messageHtml
  var buildProcessRenderItems = messageRendering.buildProcessRenderItems
  var buildRenderItems = messageRendering.buildRenderItems
  var renderItemHtml = messageRendering.renderItemHtml
  var isActiveToolGroup = messageRendering.isActiveToolGroup
  var timeSeparatorHtml = messageRendering.timeSeparatorHtml
  var typingHtml = messageRendering.typingHtml
  var shouldShowTypingIndicator = messageRendering.shouldShowTypingIndicator
  function nowMs() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now()
    }
    return Date.now()
  }
  var scrollController = window.ShennianChatScroll.create({
    scrollRoot: scrollRoot,
    container: container,
    nowMs: nowMs,
    postToRN: postToRN,
    ensureBottomWindow: function () { if (_virtualRenderer) _virtualRenderer.ensureBottomWindow() },
    handleHistoryScroll: function () { if (_virtualRenderer) _virtualRenderer.handleScroll() },
  })
  var canAutoFollow = scrollController.canFollow
  var lockProgrammaticScroll = scrollController.lockProgrammaticScroll
  var scheduleScrollToBottom = scrollController.schedule
  function renderAll(opts) {
    if (!_virtualRenderer) return
    _virtualRenderer.refresh({
      preserveViewport: !!(opts && opts.preserveViewport),
      shouldStickToBottom: !!(opts && opts.shouldStickToBottom),
      preferBottom: !!(opts && opts.preferBottom),
    })
  }
  function appendTailToolsToVisibleGroup(added, previousTailId, previousGroupCount) {
    if (!previousTailId || previousGroupCount < 2 || !_virtualRenderer) return false
    var groups = container.querySelectorAll('.tool-group[data-tool-group-ids]')
    var group = null
    for (var i = 0; i < groups.length; i++) {
      var ids = String(groups[i].getAttribute('data-tool-group-ids') || '')
        .split(',')
        .filter(Boolean)
      if (ids[ids.length - 1] === previousTailId) {
        group = groups[i]
        break
      }
    }
    if (!group) return false

    var nextIds = String(group.getAttribute('data-tool-group-ids') || '')
      .split(',')
      .filter(Boolean)
    for (var j = 0; j < added.length; j++) nextIds.push(added[j].id)
    group.setAttribute('data-tool-group-ids', nextIds.join(','))
    var title = group.querySelector('.tool-title')
    if (title) refreshToolGroupTitle(title, nextIds, true)

    _virtualRenderer.syncModel()
    var content = group.querySelector('.tool-group-content')
    if (!group.open || !content || content.getAttribute('data-loaded') !== 'true') return true

    var rendered = Number(content.getAttribute('data-rendered-count') || '0')
    var more = content.querySelector('[data-tool-group-more]')
    if (more) more.remove()
    if (rendered === previousGroupCount) {
      var appendCount = Math.min(20, added.length)
      content.insertAdjacentHTML('beforeend', toolGroupItemsHtml(added, 0, appendCount))
      rendered += appendCount
      content.setAttribute('data-rendered-count', String(rendered))
    }
    content.insertAdjacentHTML(
      'beforeend',
      toolGroupMoreHtml(Math.min(20, Math.max(0, nextIds.length - rendered))),
    )
    var nextMore = content.querySelector('[data-tool-group-more]')
    if (nextMore && typeof group._loadToolGroup === 'function') {
      nextMore.addEventListener('click', function (event) {
        event.preventDefault()
        event.stopPropagation()
        group._loadToolGroup(rendered + 20)
      })
    }
    _chatHooks.hookToolDetails()
    return true
  }
  function refreshToolGroupTitle(title, ids, isActiveRun) {
    if (!title || typeof summarizeToolGroup !== 'function') return
    var toolCalls = []
    for (var i = 0; i < ids.length; i++) {
      var message = findMsg(ids[i])
      if (message && message.toolCalls && message.toolCalls[0]) {
        toolCalls.push(message.toolCalls[0])
      }
    }
    if (toolCalls.length > 0) {
      title.textContent = summarizeToolGroup(toolCalls, isActiveRun, _activeToolCallCount).title
    }
  }
  function refreshActiveToolGroupTitle() {
    var lastMessage = _messages[_messages.length - 1]
    if (!lastMessage || !isToolMsg(lastMessage)) return
    var groups = container.querySelectorAll('.tool-group[data-tool-group-ids]')
    for (var i = 0; i < groups.length; i++) {
      var ids = String(groups[i].getAttribute('data-tool-group-ids') || '')
        .split(',')
        .filter(Boolean)
      if (ids[ids.length - 1] !== lastMessage.id) continue
      refreshToolGroupTitle(groups[i].querySelector('.tool-title'), ids, true)
      return
    }
  }
  function updateToolMessageDom(msg) {
    var groups = container.querySelectorAll('.tool-group[data-tool-group-ids]')
    for (var i = 0; i < groups.length; i++) {
      var ids = String(groups[i].getAttribute('data-tool-group-ids') || '')
        .split(',')
        .filter(Boolean)
      if (ids.indexOf(msg.id) < 0) continue
      bumpMessageVersion(msg.id)
      _virtualRenderer.invalidateMessage(msg.id)
      var item = groups[i].querySelector(
        '.tool-group-item[data-tool-message-id="' + cssEscape(msg.id) + '"]',
      )
      if (!item) return
      var wasOpen = Boolean(item.open)
      var tmp = document.createElement('div')
      tmp.innerHTML = toolGroupItemsHtml([msg], 0, 1)
      var replacement = tmp.firstChild
      if (replacement && wasOpen) replacement.open = true
      item.replaceWith(replacement)
      refreshToolGroupTitle(
        groups[i].querySelector('.tool-title'),
        ids,
        isActiveToolGroup(ids.map(findMsg).filter(Boolean)),
      )
      _chatHooks.hookToolDetails()
      return
    }
    updateMessageDom(msg)
  }
  function updateMessageDom(msg) {
    bumpMessageVersion(msg.id)
    var visibleInWindow = _virtualRenderer && _virtualRenderer.invalidateMessage(msg.id)
    var el = container.querySelector('[data-id="' + msg.id + '"]')
    if (!el) {
      if (visibleInWindow) renderAll({ preserveViewport: true })
      return
    }
    var expandedDetails = _chatHooks.snapshotExpandedDetails(el)
    var tmp = document.createElement('div')
    tmp.innerHTML = messageHtml(msg)
    var nextEl = tmp.firstChild
    _chatHooks.restoreExpandedDetails(nextEl, expandedDetails)
    el.replaceWith(nextEl)
    _chatHooks.hookAll()
  }
  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value)
    return String(value).replace(/["\\\]]/g, '\\$&')
  }
  function captureLongScreenshot(requestId, brandUrl, brandLogoDataUrl, brandQrSvg) {
    if (typeof window._captureLongScreenshot === 'function') {
      window._captureLongScreenshot(requestId, brandUrl, brandLogoDataUrl, brandQrSvg)
      return
    }
    postToRN({ type: 'longScreenshotError', requestId: requestId, error: 'capture unavailable' })
  }
  function postToRN(data) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(data))
    }
  }
  function bumpMessageVersion(messageId) {
    _messageVersions[messageId] = (_messageVersions[messageId] || 0) + 1
  }
  function resetMessageVersions() {
    _messageVersions = {}
    for (var i = 0; i < _messages.length; i++) _messageVersions[_messages[i].id] = 1
  }
  window.ShennianChatCopy.install({ postToRN: postToRN, i18n: i18n })
  _chatHooks = window.ShennianChatHooks.createChatHooks({
    container: container,
    postToRN: postToRN,
    isLocalResourceHref: isLocalResourceHref,
    normalizeLocalResourceHref: normalizeLocalResourceHref,
    getOpenableExternalUrl: getOpenableExternalUrl,
    findMsg: findMsg,
    buildProcessRenderItems: buildProcessRenderItems,
    renderItemHtml: renderItemHtml,
    toolGroupItemsHtml: toolGroupItemsHtml,
    toolGroupMoreHtml: toolGroupMoreHtml,
    updateMessageDom: updateMessageDom,
  })
  _virtualRenderer = window.ShennianChatVirtualization.createVirtualRenderer({
    container: container,
    scrollRoot: scrollRoot,
    getMessages: function () {
      return _messages
    },
    getMessageVersion: function (messageId) {
      return _messageVersions[messageId] || 0
    },
    buildRenderItems: buildRenderItems,
    renderItemHtml: renderItemHtml,
    timeSeparatorHtml: timeSeparatorHtml,
    typingHtml: typingHtml,
    shouldShowTypingIndicator: shouldShowTypingIndicator,
    isTimeSeparated: isTimeSeparated,
    escapeHtml: escapeHtml,
    cssEscape: cssEscape,
    snapshotExpandedDetails: _chatHooks.snapshotExpandedDetails,
    restoreExpandedDetails: _chatHooks.restoreExpandedDetails,
    lockProgrammaticScroll: lockProgrammaticScroll,
    scheduleScrollToBottom: scheduleScrollToBottom,
    scrollToBottomDom: function (animated) {
      scrollController.resume(animated)
    },
    afterRender: function () {
      _chatHooks.hookAll()
    },
  })
  window._buildChatCaptureHtml = function () {
    return _virtualRenderer.buildFullHtml()
  }
  window.addEventListener('message', handleMessage)
  document.addEventListener('message', handleMessage)
  if (window._shennianPerfEnabled) {
    setInterval(function () {
      postToRN({ type: 'perfSnapshot', metrics: window._shennianPerf || {} })
    }, 60000)
  }
  function handleMessage(e) {
    var data
    try {
      data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
    } catch (_) {
      return
    }
    if (!data || !data.type) return
    switch (data.type) {
      case 'init':
        applyTheme(data.theme)
        _messages = data.messages || []
        _chatHooks.resetImagePreviewRequests()
        resetMessageVersions()
        _runPhase = data.runPhase || 'idle'
        _activeToolCallCount =
          Number(data.activeToolCallCount) > 0 ? Number(data.activeToolCallCount) : null
        _streamingMsgId = null
        _lastStreamingContent = {}
        scrollController.reset(!data.initialScroll || data.initialScroll.kind !== 'position')
        _virtualRenderer.reset(data.initialScroll || { kind: 'bottom' })
        scheduleScrollToBottom()
        break
      case 'addMessage':
        var msg = data.message
        var wasNearBottom = canAutoFollow()
        var preserveViewport = !wasNearBottom
        var oldTail = _messages.length > 0 ? _messages[_messages.length - 1] : null
        var oldToolGroupCount = 0
        if (oldTail && isToolMsg(oldTail)) {
          for (var oi = _messages.length - 1; oi >= 0; oi--) {
            if (!isToolMsg(_messages[oi])) break
            if (oi < _messages.length - 1 && isTimeSeparated(_messages[oi].ts, _messages[oi + 1].ts)) {
              break
            }
            oldToolGroupCount += 1
          }
        }
        insertMessageByTimestamp(msg)
        _messageVersions[msg.id] = 1
        if (
          oldTail &&
          oldToolGroupCount >= 2 &&
          isToolMsg(msg) &&
          msg.ts >= oldTail.ts &&
          !isTimeSeparated(oldTail.ts, msg.ts) &&
          appendTailToolsToVisibleGroup([msg], oldTail.id, oldToolGroupCount)
        ) {
          if (canAutoFollow()) scheduleScrollToBottom()
          break
        }
        renderAll({
          preserveViewport: preserveViewport,
          preferBottom: wasNearBottom,
          shouldStickToBottom: canAutoFollow(),
        })
        break
      case 'addMessages':
        var added = data.messages || []
        if (added.length === 0) break
        var batchWasNearBottom = canAutoFollow()
        var previousTail = _messages.length > 0 ? _messages[_messages.length - 1] : null
        var previousGroupCount = 0
        if (previousTail && isToolMsg(previousTail)) {
          for (var pi = _messages.length - 1; pi >= 0; pi--) {
            if (!isToolMsg(_messages[pi])) break
            if (pi < _messages.length - 1 && isTimeSeparated(_messages[pi].ts, _messages[pi + 1].ts)) {
              break
            }
            previousGroupCount += 1
          }
        }
        var isTailToolBatch = Boolean(previousTail && previousGroupCount >= 2)
        for (var ai = 0; ai < added.length; ai++) {
          if (
            !isToolMsg(added[ai]) ||
            !previousTail ||
            (ai === 0 &&
              (added[ai].ts < previousTail.ts || isTimeSeparated(previousTail.ts, added[ai].ts))) ||
            (ai > 0 && isTimeSeparated(added[ai - 1].ts, added[ai].ts))
          ) {
            isTailToolBatch = false
          }
          _messageVersions[added[ai].id] = 1
        }
        _messages = mergeMessagesByTimestamp(_messages, added)
        if (
          isTailToolBatch &&
          appendTailToolsToVisibleGroup(added, previousTail.id, previousGroupCount)
        ) {
          if (canAutoFollow()) scheduleScrollToBottom()
          break
        }
        renderAll({
          preserveViewport: !batchWasNearBottom,
          preferBottom: batchWasNearBottom,
          shouldStickToBottom: canAutoFollow(),
        })
        break
      case 'streamToken':
        var target = findMsg(data.msgId)
        if (target) {
          target.content = (target.content || '') + data.token
          bumpMessageVersion(data.msgId)
          _virtualRenderer.invalidateMessage(data.msgId)
          _streamingMsgId = data.msgId
          scheduleStreamingContentUpdate(data.msgId, target.content)
        }
        break
      case 'updateContent':
        var contentTarget = findMsg(data.msgId)
        if (contentTarget) {
          contentTarget.content = String(data.content || '')
          bumpMessageVersion(data.msgId)
          _virtualRenderer.invalidateMessage(data.msgId)
          _streamingMsgId = data.msgId
          scheduleStreamingContentUpdate(data.msgId, contentTarget.content)
        }
        break
      case 'streamEnd':
        _streamingMsgId = null
        var ended = findMsg(data.msgId)
        if (ended) {
          finalizeStreamingContent(data.msgId, ended.content)
        }
        break
      case 'updateTimestamp':
        var timedMessage = findMsg(data.msgId)
        if (timedMessage && Number.isFinite(data.ts) && timedMessage.ts !== data.ts) {
          var timeWasNearBottom = canAutoFollow()
          timedMessage.ts = data.ts
          _messages.sort(function (left, right) { return left.ts - right.ts })
          bumpMessageVersion(timedMessage.id)
          _virtualRenderer.invalidateMessage(timedMessage.id)
          // Dispatch changes a user's position and therefore the surrounding
          // turn boundaries; repainting only its bubble leaves replies folded
          // under the wrong user even though the React store is already sorted.
          renderAll({
            preserveViewport: !timeWasNearBottom,
            preferBottom: timeWasNearBottom,
            shouldStickToBottom: timeWasNearBottom,
          })
        }
        break
      case 'updateStatus':
        var sm = findMsg(data.msgId)
        if (sm) {
          sm.status = typeof data.status === 'string' ? data.status : undefined
          sm.ephemeralFailure = data.ephemeralFailure === true
          updateMessageDom(sm)
        }
        break
      case 'updateThinking':
        var tm = findMsg(data.msgId)
        if (tm) {
          tm.thinking = data.thinking
          updateMessageDom(tm)
        }
        break
      case 'updateToolCall':
        var tcm = findMsg(data.msgId)
        if (tcm) {
          tcm.toolCalls = data.toolCalls
          updateToolMessageDom(tcm)
        }
        break
      case 'updateToolDetail':
        var tdm = findMsg(data.msgId)
        if (tdm && tdm.toolCalls) {
          var idx = typeof data.toolIndex === 'number' ? data.toolIndex : 0
          var original = tdm.toolCalls[idx] || {}
          tdm.toolCalls[idx] = {
            name: data.name || original.name,
            durationMs: original.durationMs,
            toolCallId: original.toolCallId,
            detailRevision: original.detailRevision,
            args: original.args,
            result: data.result != null ? data.result : original.result,
            status: data.status || original.status,
            resultOmitted: data.resultOmitted != null ? data.resultOmitted : original.resultOmitted,
            detailAvailable: original.detailAvailable,
            detailRef: original.detailRef,
            toolIndex: idx,
            command: data.command,
            argsSummary: data.argsSummary,
            detailStatus: data.detailStatus || 'loaded',
            detailMessage: data.detailMessage,
          }
          updateToolMessageDom(tdm)
        }
        break
      case 'updateAttachments':
        var am = findMsg(data.msgId)
        if (am) {
          am.attachments = data.attachments
          _chatHooks.resetImagePreviewRequests(data.msgId)
          updateMessageDom(am)
        }
        break
      case 'updateAttachmentPreview':
        var previewMessage = findMsg(data.msgId)
        if (!previewMessage || !data.path || !data.previewUrl) break
        var previewAttachments = previewMessage.attachments || []
        var previewAttachment = null
        for (var previewIndex = 0; previewIndex < previewAttachments.length; previewIndex++) {
          if (previewAttachments[previewIndex].path === data.path) {
            previewAttachment = previewAttachments[previewIndex]
            break
          }
        }
        if (previewAttachment) {
          previewAttachment.previewData = data.previewUrl
        } else {
          previewAttachments.push({
            path: data.path,
            name: data.name || String(data.path).split(/[\\/]/).pop() || 'image',
            mimeType: data.mimeType || 'image/png',
            kind: 'image',
            previewData: data.previewUrl,
          })
          previewMessage.attachments = previewAttachments
        }
        updateMessageDom(previewMessage)
        break
      case 'viewportChanged':
        scrollController.layoutChanged()
        break
      case 'setTheme':
        applyTheme(data.theme)
        break
      case 'setRunPhase':
        var prevPhase = _runPhase
        var prevToolCallCount = _activeToolCallCount
        if (
          prevPhase === 'streaming_text' &&
          data.runPhase !== 'streaming_text' &&
          _streamingMsgId
        ) {
          // The following structural render performs the one final Markdown
          // parse. Only cancel the pending plain-text update here.
          clearPendingStreamingRender(_streamingMsgId)
          delete _lastStreamingContent[_streamingMsgId]
          _streamingMsgId = null
        }
        _runPhase = data.runPhase
        _activeToolCallCount =
          Number(data.activeToolCallCount) > 0 ? Number(data.activeToolCallCount) : null
        if (prevPhase !== _runPhase) {
          var phaseNearBottom = canAutoFollow()
          renderAll({
            preserveViewport: !phaseNearBottom,
            preferBottom: phaseNearBottom,
            shouldStickToBottom: canAutoFollow(),
          })
        } else if (prevToolCallCount !== _activeToolCallCount) {
          refreshActiveToolGroupTitle()
        }
        break
      case 'scrollToBottom':
        _virtualRenderer.scrollToBottom(data.animated !== false)
        break
      case 'scrollToTop':
        scrollController.pause()
        _virtualRenderer.scrollToTop(data.animated !== false)
        break
      case 'scrollToMessage':
        scrollController.pause()
        _virtualRenderer.scrollToMessage(data.messageId, data.animated !== false)
        break
      case 'captureLongScreenshot':
        captureLongScreenshot(data.requestId, data.brandUrl, data.brandLogoDataUrl, data.brandQrSvg)
        break
      case 'prependMessages':
        var newMsgs = data.messages || []
        _messages = newMsgs.concat(_messages)
        for (var ni = 0; ni < newMsgs.length; ni++) _messageVersions[newMsgs[ni].id] = 1
        _virtualRenderer.prepend()
        scheduleScrollToBottom()
        break
      case 'ackPresentation':
        var presentationToken = String(data.presentationToken || '')
        if (!presentationToken) break
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            postToRN({ type: 'messagesPresented', presentationToken: presentationToken })
          })
        })
        break
      case 'clear':
        _messages = []
        _runPhase = 'idle'
        _activeToolCallCount = null
        _streamingMsgId = null
        _lastStreamingContent = {}
        scrollController.reset(true)
        resetMessageVersions()
        _virtualRenderer.reset({ kind: 'bottom' })
        break
    }
  }
  function findMsg(id) {
    for (var i = _messages.length - 1; i >= 0; i--) {
      if (_messages[i].id === id) return _messages[i]
    }
    return null
  }
  function insertMessageByTimestamp(msg) {
    for (var i = 0; i < _messages.length; i++) {
      if (_messages[i].ts > msg.ts) {
        _messages.splice(i, 0, msg)
        return
      }
    }
    _messages.push(msg)
  }
  function mergeMessagesByTimestamp(existing, added) {
    if (!added || added.length === 0) return existing
    if (!existing || existing.length === 0) {
      return added.slice().sort(function (left, right) {
        return left.ts - right.ts
      })
    }

    var ordered = added.slice()
    for (var orderIndex = 1; orderIndex < ordered.length; orderIndex++) {
      if (ordered[orderIndex - 1].ts <= ordered[orderIndex].ts) continue
      ordered.sort(function (left, right) {
        return left.ts - right.ts
      })
      break
    }
    if (existing[existing.length - 1].ts <= ordered[0].ts) {
      return existing.concat(ordered)
    }

    var merged = []
    var existingIndex = 0
    var addedIndex = 0
    while (existingIndex < existing.length && addedIndex < ordered.length) {
      // Match insertMessageByTimestamp's stable tie behavior: existing
      // messages stay before newly received messages with the same timestamp.
      if (existing[existingIndex].ts <= ordered[addedIndex].ts) {
        merged.push(existing[existingIndex++])
      } else {
        merged.push(ordered[addedIndex++])
      }
    }
    while (existingIndex < existing.length) merged.push(existing[existingIndex++])
    while (addedIndex < ordered.length) merged.push(ordered[addedIndex++])
    return merged
  }
  function clearPendingStreamingRender(msgId) {
    var pending = _pendingStreamingRenders[msgId]
    if (pending && pending.timer != null) clearTimeout(pending.timer)
    delete _pendingStreamingRenders[msgId]
  }
  function scheduleStreamingContentUpdate(msgId, content) {
    var now = nowMs()
    var last = Object.prototype.hasOwnProperty.call(_lastStreamingRenderAt, msgId)
      ? _lastStreamingRenderAt[msgId]
      : -Infinity
    var elapsed = now - last
    var interval = streamingRenderInterval(String(content || '').length)
    var pending = _pendingStreamingRenders[msgId]
    if (!pending && elapsed >= interval) {
      updateStreamingContentNow(msgId, content)
      return
    }
    if (pending) {
      pending.content = content
      return
    }
    _pendingStreamingRenders[msgId] = {
      content: content,
      timer: setTimeout(
        function () {
          var next = _pendingStreamingRenders[msgId]
          delete _pendingStreamingRenders[msgId]
          updateStreamingContentNow(msgId, next ? next.content : content)
        },
        Math.max(16, interval - elapsed),
      ),
    }
  }
  function updateStreamingContentNow(msgId, content) {
    if (_lastStreamingContent[msgId] === content) return
    clearPendingStreamingRender(msgId)
    _lastStreamingRenderAt[msgId] = nowMs()
    updateStreamingContent(msgId, content)
  }
  function updateStreamingContent(msgId, content) {
    var el = container.querySelector('.md[data-msg-id="' + msgId + '"]')
    if (el) {
      var previous = _lastStreamingContent[msgId]
      var caret = el.querySelector && el.querySelector('.streaming-caret')
      if (caret) caret.remove()
      if (
        typeof previous === 'string' &&
        String(content || '').indexOf(previous) === 0 &&
        typeof document.createTextNode === 'function'
      ) {
        el.appendChild(document.createTextNode(String(content || '').slice(previous.length)))
      } else {
        el.textContent = String(content || '')
      }
      el.classList.add('md-streaming-plain')
      _lastStreamingContent[msgId] = String(content || '')
      var copyBtn = container.querySelector('.msg-copy-btn[data-msg-id="' + msgId + '"]')
      if (copyBtn) copyBtn.setAttribute('data-copy-text', String(content || '').trim())
      appendCaret(el)
      if (canAutoFollow()) {
        scheduleScrollToBottom()
      }
    } else {
      var msgEl = container.querySelector('[data-id="' + msgId + '"]')
      if (msgEl) {
        updateMessageDom(findMsg(msgId))
      }
    }
  }
  function finalizeStreamingContent(msgId, content) {
    clearPendingStreamingRender(msgId)
    delete _lastStreamingContent[msgId]
    var el = container.querySelector('.md[data-msg-id="' + msgId + '"]')
    if (el) {
      el.classList.remove('md-streaming-plain')
      el.innerHTML = renderMarkdown(content)
      var copyBtn = container.querySelector('.msg-copy-btn[data-msg-id="' + msgId + '"]')
      if (copyBtn) copyBtn.setAttribute('data-copy-text', String(content || '').trim())
      return
    }
    var msg = findMsg(msgId)
    if (msg) updateMessageDom(msg)
  }
  function removeCaret(msgId) {
    var el = container.querySelector('.md[data-msg-id="' + msgId + '"] .streaming-caret')
    if (el) el.remove()
  }
  function lastMeaningfulChild(node) {
    if (!node) return null
    var child = node.lastChild
    while (child) {
      if (child.nodeType === 3 && child.textContent && child.textContent.trim() !== '') return child
      if (child.nodeType === 1 && !child.classList.contains('streaming-caret')) return child
      child = child.previousSibling
    }
    return null
  }
  function findCaretAnchor(root) {
    var node = lastMeaningfulChild(root)
    while (node && node.nodeType === 1) {
      var child = lastMeaningfulChild(node)
      if (!child) return node
      node = child
    }
    if (node && node.parentNode && node.parentNode.nodeType === 1) {
      return node.parentNode
    }
    return root
  }
  function appendCaret(root) {
    if (!root) return
    var anchor = findCaretAnchor(root)
    if (!anchor) return
    var caret = document.createElement('span')
    caret.className = 'streaming-caret'
    anchor.appendChild(caret)
  }
  function applyTheme(theme) {
    if (!theme) return
    if (theme.isDark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    if (theme.colors) {
      var root = document.documentElement.style
      var map = {
        bg: '--bg',
        surface: '--surface',
        surfaceHover: '--surface-hover',
        border: '--border',
        text: '--text',
        textSecondary: '--text-secondary',
        textTertiary: '--text-tertiary',
        brand: '--brand',
        brandDark: '--brand-dark',
        brandLight: '--brand-light',
        ownMessage: '--own-message',
        error: '--error',
        success: '--success',
        warning: '--warning',
      }
      for (var key in map) {
        if (theme.colors[key]) root.setProperty(map[key], theme.colors[key])
      }
    }
  }
  postToRN({ type: 'ready' })
})()
