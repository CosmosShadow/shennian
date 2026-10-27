// @arch docs/architecture/app/modular-features.md#移动端长对话渲染
// @test src/__tests__/chat-webview-script.test.ts
;(function () {
  window.ShennianChatMessageRendering = {
    create: function (config) {
      var nowMs = config.nowMs
      function escapeHtml(s) {
        return String(s || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
      }
      var chatMarkdown = window.ShennianChatMarkdown || {}
      var rawRenderMarkdown = chatMarkdown.renderMarkdown
      function recordWebMetric(name, duration) {
        if (!window._shennianPerfEnabled) return
        var metrics = window._shennianPerf || (window._shennianPerf = {})
        var current = metrics[name] || { count: 0, totalMs: 0, maxMs: 0 }
        var elapsed = typeof duration === 'number' ? duration : 0
        metrics[name] = {
          count: current.count + 1,
          totalMs: current.totalMs + elapsed,
          maxMs: Math.max(current.maxMs, elapsed),
        }
      }
      function renderMarkdown(content) {
        var startedAt = nowMs()
        var html = rawRenderMarkdown(content)
        recordWebMetric('markdown.parse', nowMs() - startedAt)
        return html
      }
      var isLocalResourceHref = chatMarkdown.isLocalResourceHref
      var normalizeLocalResourceHref = chatMarkdown.normalizeLocalResourceHref
      var isExternalOpenHref = chatMarkdown.isExternalOpenHref
      var getOpenableExternalUrl = chatMarkdown.getOpenableExternalUrl
      function pad(n) {
        return n < 10 ? '0' + n : '' + n
      }
      function formatTime(ts) {
        var d = new Date(ts)
        var now = new Date()
        var time = pad(d.getHours()) + ':' + pad(d.getMinutes())
        var yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        yesterday.setDate(yesterday.getDate() - 1)
        if (d.getFullYear() !== now.getFullYear()) {
          return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + time
        }
        if (
          d.getFullYear() === yesterday.getFullYear() &&
          d.getMonth() === yesterday.getMonth() &&
          d.getDate() === yesterday.getDate()
        ) {
          return i18n('timeYesterday', '昨天') + ' ' + time
        }
        if (d.getMonth() !== now.getMonth() || d.getDate() !== now.getDate()) {
          return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + time
        }
        return time
      }
      function isToolMsg(msg) {
        return (
          msg.role === 'agent' &&
          msg.toolCalls &&
          msg.toolCalls.length > 0 &&
          !msg.content &&
          msg.status !== 'error'
        )
      }
      function toolCallWithMessage(msg, index) {
        var tc = msg.toolCalls && msg.toolCalls[index || 0] ? msg.toolCalls[index || 0] : null
        if (!tc) return tc
        if (!tc.messageId) tc.messageId = msg.id
        if (tc.toolIndex == null) tc.toolIndex = index || 0
        return tc
      }
      function i18n(key, fallback) {
        return (window._i18n && window._i18n[key]) || fallback
      }
      function i18nCount(key, fallback, count) {
        return i18n(key, fallback).replace(/__COUNT__/g, String(count))
      }
      function i18nProcessLabel(messageCount, toolCount) {
        if (messageCount > 0 && toolCount > 0) {
          return i18n('processMessagesWithTools', '__MESSAGES__ 条消息 · __TOOLS__ 个工具')
            .replace(/__MESSAGES__/g, String(messageCount))
            .replace(/__TOOLS__/g, String(toolCount))
        }
        if (toolCount > 0) return i18nCount('processTools', '__COUNT__ 个工具', toolCount)
        return i18nCount('processMessages', '__COUNT__ 条消息', messageCount)
      }
      function statusHtml(status, queueMessageId) {
        // Queueing is an internal delivery detail. Keep the user's bubble stable
        // and quiet; if execution ultimately fails, the failure is rendered as
        // the Agent result rather than as stale edit/cancel controls.
        if (queueMessageId) return ''
        if (!status) return ''
        // Keep delivery uncertainty as an internal recovery state. The UI uses
        // the same calm sending feedback until a definitive result arrives.
        if (status === 'sending' || status === 'uncertain')
          return (
            '<div class="msg-status sending-status"><span class="sending"></span><span class="sending-label">' +
            escapeHtml(i18n('msgSending', '发送中…')) +
            '</span><span class="still-sending-label">' +
            escapeHtml(i18n('msgStillSending', '发送中…')) +
            '</span></div>'
          )
        if (status === 'error')
          return (
            '<div class="msg-status"><span class="ephemeral-error">' +
            escapeHtml(i18n('msgSendFailed', '发送失败')) +
            '</span></div>'
          )
        return ''
      }
      function messageCopyHtml(msg, text) {
        var copyText = String(text || '').trim()
        if (!copyText) return ''
        var label = i18n('copyFullText', 'Copy full text')
        return (
          '<button class="msg-copy-btn" type="button" data-msg-id="' +
          escapeHtml(msg.id) +
          '" data-copy-label="' +
          escapeHtml(label) +
          '" data-copy-text="' +
          escapeHtml(copyText) +
          '" onclick="window._copyMessage(this)">' +
          escapeHtml(label) +
          '</button>'
        )
      }
      function thinkingHtml(thinking, hasContent) {
        if (!thinking) return ''
        var label = hasContent ? '已深度思考' : '思考中...'
        return (
          '<details class="thinking-block">' +
          '<summary>' +
          label +
          '</summary>' +
          '<div class="thinking-content">' +
          escapeHtml(thinking) +
          '</div>' +
          '</details>'
        )
      }
      function approvalCardHtml(approval) {
        if (!approval) return ''
        var title = approval.title || i18n('approvalPendingTitle', '需要用户确认')
        var content =
          approval.content || i18n('approvalPendingContent', 'Codex 正在等待用户确认后继续。')
        var hint =
          approval.actionHint ||
          i18n(
            'approvalPendingHint',
            '当前神念暂不支持远程确认，请回到运行 Codex 的电脑/终端完成确认。',
          )
        return (
          '<div class="approval-card">' +
          '<div class="approval-card-kicker">' +
          escapeHtml(i18n('approvalPendingKicker', '等待确认')) +
          '</div>' +
          '<div class="approval-card-title">' +
          escapeHtml(title) +
          '</div>' +
          '<div class="approval-card-content">' +
          escapeHtml(content) +
          '</div>' +
          '<div class="approval-card-hint">' +
          escapeHtml(hint) +
          '</div>' +
          '</div>'
        )
      }
      function deliveryTitle(delivery) {
        if (!delivery) return ''
        if (delivery.status === 'manual_review') {
          return i18n('wechatDeliveryManualReviewTitle', '发送状态不确定，请检查微信')
        }
        if (
          delivery.reasonCode === 'user_active_timeout' ||
          delivery.status === 'failed:user_active_timeout'
        ) {
          return i18n('wechatDeliveryTimeoutTitle', '你持续使用电脑超过 10 分钟，未能自动发送')
        }
        return i18n('wechatDeliveryFailedTitle', '未能自动发送到微信')
      }
      function deliveryStatusCardHtml(msg) {
        var delivery = msg && msg.channelDelivery ? msg.channelDelivery : null
        if (!delivery) return ''
        var title = deliveryTitle(delivery)
        var copyText = String(delivery.copyText || '').trim()
        var detail =
          !copyText && delivery.content && delivery.content !== title
            ? String(delivery.content)
            : ''
        var copyButton = copyText
          ? '<button class="delivery-copy-btn" type="button" data-msg-id="' +
            escapeHtml(msg.id) +
            '" data-copy-label="' +
            escapeHtml(i18n('wechatDeliveryCopyOriginal', '复制原消息')) +
            '" data-copy-text="' +
            escapeHtml(copyText) +
            '" onclick="window._copyMessage(this)">' +
            escapeHtml(i18n('wechatDeliveryCopyOriginal', '复制原消息')) +
            '</button>'
          : ''
        return (
          '<div class="delivery-card">' +
          '<div class="delivery-kicker">' +
          escapeHtml(i18n('wechatDeliveryKicker', '微信发送状态')) +
          '</div>' +
          '<div class="delivery-title">' +
          escapeHtml(title) +
          '</div>' +
          (detail ? '<div class="delivery-detail">' + escapeHtml(detail) + '</div>' : '') +
          (copyText
            ? '<div class="delivery-original-label">' +
              escapeHtml(i18n('wechatDeliveryOriginalContent', '原消息内容')) +
              '</div><div class="delivery-original">' +
              escapeHtml(copyText) +
              '</div>' +
              copyButton
            : '') +
          '</div>'
        )
      }
      function wechatRpaInlineDeliveryText(delivery) {
        if (!delivery) return ''
        if (delivery.status === 'sending')
          return i18n('wechatDeliveryInlineSending', '正在发送到微信')
        if (delivery.status === 'sent_unconfirmed')
          return i18n('wechatDeliveryInlineConfirming', '已交给微信，正在确认')
        var reason = delivery.reasonCode || ''
        if (
          reason === 'recent_mouse_activity' ||
          reason === 'recent_mouse_click' ||
          reason === 'recent_scroll_activity' ||
          reason === 'recent_keyboard_activity' ||
          reason === 'frontmost_app_changed'
        ) {
          return i18n('wechatDeliveryInlineWaitingIdle', '等待你停止操作后发送到微信')
        }
        return i18n('wechatDeliveryInlineQueued', '等待发送到微信')
      }
      function wechatRpaInlineDeliveryHtml(delivery) {
        var text = wechatRpaInlineDeliveryText(delivery)
        if (!text) return ''
        return (
          '<div class="delivery-inline" aria-label="' +
          escapeHtml(i18n('wechatDeliveryKicker', '微信发送状态')) +
          '"><span class="delivery-inline-dot"></span><span>' +
          escapeHtml(text) +
          '</span></div>'
        )
      }
      var renderHelpers = window.ShennianChatRender || {}
      var attachmentsHtml = renderHelpers.attachmentsHtml
      var getInlinePreviewAttachments = renderHelpers.getInlinePreviewAttachments
      var summarizeToolGroup = renderHelpers.summarizeToolGroup
      var singleToolHtml = renderHelpers.singleToolHtml
      var stripAttachmentRefs = renderHelpers.stripAttachmentRefs
      var toolGroupHtml = renderHelpers.toolGroupHtml
      var toolGroupItemsHtml = renderHelpers.toolGroupItemsHtml
      var toolGroupMoreHtml = renderHelpers.toolGroupMoreHtml
      function stripMarkdownImageRefs(content) {
        return String(content || '')
          .split('\n')
          .filter(function (line) {
            return (
              !/^!\[[^\]]*\]\(<[^>]+>\)\s*$/.test(line.trim()) &&
              !/^!\[[^\]]*\]\([^\s)]+\)\s*$/.test(line.trim())
            )
          })
          .join('\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
      }
      function isTimeSeparated(prevTs, nextTs) {
        // A separator at every displayed-minute boundary between items. Items that
        // continue an agent turn never get one (see hasTimeSeparator).
        return Math.floor(prevTs / 60000) !== Math.floor(nextTs / 60000)
      }
      function messageHtml(msg) {
        if (msg.divider) {
          return (
            '<div class="msg-row msg-divider" data-id="' +
            escapeHtml(msg.id) +
            '"><span class="divider-line"></span><span class="divider-label">' +
            escapeHtml(msg.divider) +
            '</span><span class="divider-line"></span></div>'
          )
        }
        if (isToolMsg(msg)) {
          return (
            '<div class="msg-row msg-agent msg-tool" data-id="' +
            msg.id +
            '">' +
            '<div class="agent-wrap">' +
            singleToolHtml(
              toolCallWithMessage(msg, 0),
              'tool:' + msg.id,
              isActiveToolMessage(msg),
            ) +
            '</div>' +
            '</div>'
          )
        }
        if (msg.channelDelivery) {
          return (
            '<div class="msg-row msg-agent msg-delivery" data-id="' +
            msg.id +
            '"><div class="agent-wrap">' +
            deliveryStatusCardHtml(msg) +
            '</div></div>'
          )
        }
        if (msg.approval) {
          return (
            '<div class="msg-row msg-agent msg-approval" data-id="' +
            msg.id +
            '"><div class="agent-wrap">' +
            approvalCardHtml(msg.approval) +
            '</div></div>'
          )
        }
        var worker = window.ShennianWorkerCard && window.ShennianWorkerCard.parseWorkerCard(msg.content)
        if (worker) {
          return '<div class="msg-row msg-agent worker-session-message" data-id="' + escapeHtml(msg.id) +
            '"><div class="agent-wrap"><a class="worker-session-card" data-worker-kind="' + worker.kind + '" href="' + escapeHtml(worker.href) +
            '">' + window.ShennianWorkerCard.workerCardInnerHtml(worker) +
            '</a></div></div>'
        }
        if (msg.role === 'user') {
          var errorClass = msg.status === 'error' ? ' error' : ''
          var displayContent = stripAttachmentRefs(
            msg.content,
            getInlinePreviewAttachments(msg.attachments),
          )
          if ((!msg.attachments || msg.attachments.length === 0) && attachmentsHtml(msg)) {
            displayContent = stripMarkdownImageRefs(displayContent)
          }
          var contentHtml = displayContent
            ? '<div class="md md-user">' + renderMarkdown(displayContent) + '</div>'
            : ''
          return (
            '<div class="msg-row msg-user" data-id="' +
            msg.id +
            '">' +
            '<div class="user-wrap">' +
            '<div class="bubble-user' +
            errorClass +
            '">' +
            attachmentsHtml(msg) +
            contentHtml +
            '</div>' +
            (displayContent.trim() ? messageCopyHtml(msg, displayContent) : '') +
            '</div>' +
            statusHtml(msg.status, msg.queueMessageId) +
            '</div>'
          )
        }
        var previewAttachments = getInlinePreviewAttachments(msg.attachments)
        var displayContent = stripAttachmentRefs(msg.content, previewAttachments)
        var renderedContent = displayContent ? renderMarkdown(displayContent) : ''
        var thinking = thinkingHtml(msg.thinking, !!msg.content || previewAttachments.length > 0)
        var isError = msg.status === 'error'
        var contentHtml =
          renderedContent || previewAttachments.length > 0 || isError
            ? '<div class="bubble-agent' +
              (isError ? ' bubble-agent-error' : '') +
              '">' +
              attachmentsHtml(msg) +
              '<div class="md" data-msg-id="' +
              msg.id +
              '">' +
              renderedContent +
              '</div>' +
              (isError ? '<div class="agent-error-label">⚠ 出错了</div>' : '') +
              '</div>'
            : ''
        return (
          '<div class="msg-row msg-agent" data-id="' +
          msg.id +
          '">' +
          '<div class="agent-wrap">' +
          thinking +
          contentHtml +
          wechatRpaInlineDeliveryHtml(msg.wechatRpaDelivery) +
          (displayContent.trim() ? messageCopyHtml(msg, displayContent) : '') +
          '</div>' +
          '</div>'
        )
      }
      function isFinalAgentMsg(msg) {
        return (
          msg.role === 'agent' &&
          !isToolMsg(msg) &&
          (!!msg.content ||
            !!(msg.attachments && msg.attachments.length) ||
            msg.status === 'error' ||
            !!msg.approval ||
            !!msg.channelDelivery ||
            !!msg.wechatRpaDelivery)
        )
      }
      function isWorkerSessionMessage(msg) {
        // The internal Worker Session URL is the stable contract. Link text is
        // human/AI-readable presentation and may be localized or evolve.
        return (
          msg.role === 'agent' &&
          typeof msg.content === 'string' &&
          /^\[(?:\\.|[^\]])+\]\(shennian:\/\/session\/sess_worker_[^)]+\)/.test(
            msg.content.trim(),
          )
        )
      }
      function buildProcessRenderItems(messages) {
        var items = []
        for (var i = 0; i < messages.length; i++) {
          var message = messages[i]
          if (!isToolMsg(message)) {
            items.push({
              key: message.id,
              type: 'message',
              message: message,
              ts: message.ts,
              lastTs: message.ts,
            })
            continue
          }
          var grouped = [message]
          var lastTs = message.ts
          while (i + 1 < messages.length) {
            var next = messages[i + 1]
            if (!isToolMsg(next)) break
            grouped.push(next)
            lastTs = next.ts
            i += 1
          }
          if (grouped.length === 1) {
            items.push({
              key: message.id,
              type: 'message',
              message: message,
              ts: message.ts,
              lastTs: message.ts,
            })
          } else {
            items.push({
              // The first tool is the identity of this contiguous run. Keeping the
              // key stable lets the visible group accept tail tools incrementally
              // without replacing the outer virtual item.
              key: 'tool-group-' + grouped[0].id,
              type: 'tool-group',
              messages: grouped,
              ts: grouped[0].ts,
              lastTs: lastTs,
            })
          }
        }
        return items
      }
      function collapseProcessMessages(messages) {
        if (messages.length === 0) return []
        if (messages.every(isToolMsg)) return buildProcessRenderItems(messages)
        return [{
          key: 'collapsed-process-' + messages[0].id,
          type: 'collapsed-process',
          messages: messages,
          ts: messages[0].ts,
          lastTs: messages[messages.length - 1].ts,
        }]
      }
      function buildWorkerTimelineItems(runMessages) {
        var items = []
        var finalMessage = null
        for (var i = runMessages.length - 1; i >= 0; i--) {
          if (!isWorkerSessionMessage(runMessages[i]) && isFinalAgentMsg(runMessages[i])) {
            finalMessage = runMessages[i]
            break
          }
        }
        var segment = []
        function flushSegment() {
          var finalIndex = finalMessage ? segment.indexOf(finalMessage) : -1
          if (finalIndex < 0) {
            items = items.concat(collapseProcessMessages(segment))
          } else {
            items = items.concat(collapseProcessMessages(segment.slice(0, finalIndex)))
            items.push({
              key: finalMessage.id,
              type: 'message',
              message: finalMessage,
              ts: finalMessage.ts,
              lastTs: finalMessage.ts,
            })
            items = items.concat(collapseProcessMessages(segment.slice(finalIndex + 1)))
          }
          segment = []
        }
        for (var j = 0; j < runMessages.length; j++) {
          var message = runMessages[j]
          if (!isWorkerSessionMessage(message)) {
            segment.push(message)
            continue
          }
          flushSegment()
          items.push({
            key: message.id,
            type: 'message',
            message: message,
            ts: message.ts,
            lastTs: message.ts,
          })
        }
        flushSegment()
        return items
      }
      function buildAgentRunItems(runMessages, userMessageId, running) {
        if (running) {
          // The latest turn stays expanded while it runs so progress text is
          // never swallowed by a summary; it collapses once the run is idle.
          return buildProcessRenderItems(runMessages)
        }
        var finalIndex = -1
        for (var j = runMessages.length - 1; j >= 0; j--) {
          if (isFinalAgentMsg(runMessages[j])) {
            finalIndex = j
            break
          }
        }
        if (finalIndex >= 0) {
          var leadingMessages = runMessages.slice(0, finalIndex)
          var finalMessage = runMessages[finalIndex]
          var trailingTools = runMessages.slice(finalIndex + 1).filter(isToolMsg)
          var hiddenMessages = leadingMessages.concat(trailingTools)
          if (hiddenMessages.length > 0) {
            return [{
              key: 'collapsed-run-' + userMessageId,
              type: 'collapsed-run',
              messages: hiddenMessages,
              leadingMessages: leadingMessages,
              trailingTools: trailingTools,
              finalMessage: finalMessage,
              ts: leadingMessages.length > 0 ? leadingMessages[0].ts : finalMessage.ts,
              lastTs:
                trailingTools.length > 0
                  ? trailingTools[trailingTools.length - 1].ts
                  : finalMessage.ts,
            }]
          }
          return [{
            key: finalMessage.id,
            type: 'message',
            message: finalMessage,
            ts: finalMessage.ts,
            lastTs: finalMessage.ts,
          }]
        }
        if (runMessages.length > 0 && runMessages.every(isToolMsg)) {
          return [{
            key: 'tool-group-' + userMessageId,
            type: 'tool-group',
            messages: runMessages,
            ts: runMessages[0].ts,
            lastTs: runMessages[runMessages.length - 1].ts,
          }]
        }
        return buildProcessRenderItems(runMessages)
      }
      function buildRenderItems(messages) {
        var items = []
        var pendingOrphans = []
        for (var i = 0; i < messages.length; i++) {
          var message = messages[i]
          if (message.role !== 'user') {
            pendingOrphans.push(message)
            continue
          }
          if (pendingOrphans.length > 0) {
            // A bounded history window can begin in the middle of the previous
            // agent run. Those leading fragments still precede this user message;
            // grouping must never reverse canonical transcript order.
            items = items.concat(buildProcessRenderItems(pendingOrphans))
            items.push({
              key: message.id,
              type: 'message',
              message: message,
              ts: message.ts,
              lastTs: message.ts,
            })
            pendingOrphans = []
          } else {
            items.push({
              key: message.id,
              type: 'message',
              message: message,
              ts: message.ts,
              lastTs: message.ts,
            })
          }
          var runMessages = []
          var cursor = i + 1
          while (cursor < messages.length && messages[cursor].role !== 'user') {
            runMessages.push(messages[cursor])
            cursor += 1
          }
          if (runMessages.some(isWorkerSessionMessage)) {
            items = items.concat(buildWorkerTimelineItems(runMessages))
            i = cursor - 1
            continue
          }
          var runItems = buildAgentRunItems(
            runMessages,
            message.id,
            cursor >= messages.length && config.getRunPhase() !== 'idle',
          )
          // One agent turn reads as a single reply: no time separator inside it.
          for (var r = 0; r < runItems.length; r++) runItems[r].continuesTurn = true
          items = items.concat(runItems)
          i = cursor - 1
        }
        if (pendingOrphans.length > 0) {
          items = items.concat(buildProcessRenderItems(pendingOrphans))
        }
        return items
      }
      function processCollapseHtml(messages) {
        var toolCount = 0
        var messageCount = 0
        var messageIds = []
        for (var i = 0; i < messages.length; i++) {
          messageIds.push(messages[i].id)
          toolCount += messages[i].toolCalls
            ? messages[i].toolCalls.length
            : 0
          if (String(messages[i].content || '').trim()) messageCount += 1
        }
        if (messages.length === 0) return ''
        return (
            '<details class="process-collapse" data-process-ids="' +
            escapeHtml(messageIds.join(',')) +
            '" data-detail-key="process:' +
            escapeHtml(messageIds[0] || '') +
            '">' +
            '<summary>' +
            escapeHtml(i18nProcessLabel(messageCount, toolCount)) +
            '</summary>' +
            '<div class="process-collapse-content" data-loaded="false"></div>' +
            '</details>'
        )
      }
      function collapsedRunHtml(item) {
        var leading = processCollapseHtml(item.leadingMessages)
        var trailing = ''
        if (item.trailingTools.length > 0) {
          trailing =
            '<div class="msg-row msg-agent msg-tool trailing-tool-summary"><div class="agent-wrap">' +
            toolGroupHtml(item.trailingTools, false, null) +
            '</div></div>'
        }
        return leading + messageHtml(item.finalMessage) + trailing
      }
      function renderItemHtml(item) {
        if (item.type === 'collapsed-run') return collapsedRunHtml(item)
        if (item.type === 'collapsed-process') return processCollapseHtml(item.messages)
        if (item.type === 'tool-group') {
          return (
            '<div class="msg-row msg-agent msg-tool"><div class="agent-wrap">' +
            toolGroupHtml(
              item.messages,
              isActiveToolGroup(item.messages),
              config.getActiveToolCallCount(),
            ) +
            '</div></div>'
          )
        }
        return messageHtml(item.message)
      }
      function isActiveToolMessage(message) {
        var messages = config.getMessages()
        var lastMessage = messages[messages.length - 1]
        return config.getRunPhase() !== 'idle' && lastMessage && lastMessage.id === message.id
      }
      function isActiveToolGroup(messages) {
        return Boolean(
          messages && messages.length > 0 && isActiveToolMessage(messages[messages.length - 1]),
        )
      }
      function timeSeparatorHtml(ts) {
        return '<div class="time-separator"><span>' + formatTime(ts) + '</span></div>'
      }
      function typingHtml() {
        return (
          '<div class="typing-row" id="typing-indicator">' +
          '<div class="typing-bubble">' +
          '<span class="dot"></span><span class="dot"></span><span class="dot"></span>' +
          '</div></div>'
        )
      }
      function shouldKeepIndicatorDuringStreaming() {
        var messages = config.getMessages()
        var lastMsg = messages.length > 0 ? messages[messages.length - 1] : null
        return !lastMsg || lastMsg.role === 'user'
      }
      function shouldShowTypingIndicator() {
        return (
          config.getRunPhase() === 'thinking' ||
          config.getRunPhase() === 'tool_running' ||
          (config.getRunPhase() === 'streaming_text' && shouldKeepIndicatorDuringStreaming())
        )
      }
      return {
        escapeHtml: escapeHtml,
        renderMarkdown: renderMarkdown,
        isLocalResourceHref: isLocalResourceHref,
        normalizeLocalResourceHref: normalizeLocalResourceHref,
        getOpenableExternalUrl: getOpenableExternalUrl,
        isToolMsg: isToolMsg,
        i18n: i18n,
        summarizeToolGroup: summarizeToolGroup,
        toolGroupItemsHtml: toolGroupItemsHtml,
        toolGroupMoreHtml: toolGroupMoreHtml,
        isTimeSeparated: isTimeSeparated,
        messageHtml: messageHtml,
        buildProcessRenderItems: buildProcessRenderItems,
        buildRenderItems: buildRenderItems,
        renderItemHtml: renderItemHtml,
        isActiveToolGroup: isActiveToolGroup,
        timeSeparatorHtml: timeSeparatorHtml,
        typingHtml: typingHtml,
        shouldShowTypingIndicator: shouldShowTypingIndicator,
      }
    },
  }
})()
