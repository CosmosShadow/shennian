// @arch docs/architecture/app/modular-features.md#聊天-feature
// @test src/__tests__/chat-webview-script.test.ts

;(function () {
  'use strict'

  function decodeHtmlAttr(text) {
    return String(text || '')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
  }

  function install(config) {
    var longPressTimer = null
    var longPressRow = null
    var longPressStartX = 0
    var longPressStartY = 0
    var didLongPress = false

    function closeMessageActions() {
      var openRow = document.querySelector('.msg-row.msg-actions-open')
      if (openRow && openRow.classList) openRow.classList.remove('msg-actions-open')
    }

    function cancelLongPress() {
      if (longPressTimer != null) clearTimeout(longPressTimer)
      longPressTimer = null
      longPressRow = null
    }

    function openMessageActions(row, clientX, clientY) {
      closeMessageActions()
      if (!row || !row.classList || !row.querySelector) return
      var button = row.querySelector('.msg-copy-btn')
      if (!button || !button.style) return
      row.classList.add('msg-actions-open')

      var viewport = window.visualViewport
      var viewportWidth = (viewport && viewport.width) || window.innerWidth || 320
      var viewportHeight = (viewport && viewport.height) || window.innerHeight || 568
      var offsetLeft = (viewport && viewport.offsetLeft) || 0
      var offsetTop = (viewport && viewport.offsetTop) || 0
      var buttonWidth = button.offsetWidth || 72
      var buttonHeight = button.offsetHeight || 44
      var margin = 8
      var gap = 12
      var left = clientX - buttonWidth / 2
      var top = clientY - buttonHeight - gap

      left = Math.max(
        offsetLeft + margin,
        Math.min(left, offsetLeft + viewportWidth - buttonWidth - margin),
      )
      if (top < offsetTop + margin) top = clientY + gap
      top = Math.max(
        offsetTop + margin,
        Math.min(top, offsetTop + viewportHeight - buttonHeight - margin),
      )

      button.style.left = Math.round(left) + 'px'
      button.style.right = 'auto'
      button.style.top = Math.round(top) + 'px'
    }

    function installMessageLongPress() {
      document.addEventListener(
        'touchstart',
        function (event) {
          var target = event.target
          var row = target && target.closest ? target.closest('.msg-row') : null
          if (!row || !row.querySelector || !row.querySelector('.msg-copy-btn')) {
            closeMessageActions()
            return
          }
          // Let the platform-owned text selection interaction handle long
          // presses inside message content. The message-level action is only
          // for the non-text part of the bubble, so it never competes with
          // the native Copy/Look Up/Translate menu or its selection handles.
          if (target && target.closest && target.closest('.md')) {
            closeMessageActions()
            cancelLongPress()
            return
          }
          var touch = event.touches && event.touches[0]
          if (!touch) return
          cancelLongPress()
          didLongPress = false
          longPressRow = row
          longPressStartX = touch.clientX
          longPressStartY = touch.clientY
          longPressTimer = setTimeout(function () {
            didLongPress = true
            openMessageActions(longPressRow, longPressStartX, longPressStartY)
            longPressTimer = null
          }, 450)
        },
        { passive: true },
      )
      document.addEventListener(
        'touchmove',
        function (event) {
          var touch = event.touches && event.touches[0]
          if (!touch) return
          if (
            Math.abs(touch.clientX - longPressStartX) > 10 ||
            Math.abs(touch.clientY - longPressStartY) > 10
          ) {
            cancelLongPress()
          }
        },
        { passive: true },
      )
      document.addEventListener('touchend', cancelLongPress, { passive: true })
      document.addEventListener('touchcancel', cancelLongPress, { passive: true })
      document.addEventListener('click', function (event) {
        var target = event.target
        if (didLongPress) {
          didLongPress = false
          if (!target || !target.closest || !target.closest('.msg-copy-btn')) {
            if (event.preventDefault) event.preventDefault()
            if (event.stopPropagation) event.stopPropagation()
            return
          }
        }
        if (!target || !target.closest || !target.closest('.msg-copy-btn')) {
          closeMessageActions()
        }
      })
    }

    function flashCopied(button) {
      if (!button || typeof button.getAttribute !== 'function') return
      var original = button.getAttribute('data-copy-label') || button.textContent || 'Copy'
      if (!button.getAttribute('data-copy-label') && typeof button.setAttribute === 'function') {
        button.setAttribute('data-copy-label', original)
      }
      button.textContent = '✓ ' + config.i18n('copied', 'Copied')
      setTimeout(function () {
        button.textContent = original
      }, 2000)
    }

    function copyText(type, text) {
      if (window.ReactNativeWebView) {
        config.postToRN(type === 'copyCode' ? { type: type, code: text } : { type: type, text: text })
      } else if (
        typeof navigator !== 'undefined' &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === 'function'
      ) {
        navigator.clipboard.writeText(text)
      }
    }

    window._copyCode = function (button) {
      if (!button || typeof button.getAttribute !== 'function') return
      var codeId = button.getAttribute('data-code-id') || ''
      var code =
        codeId && window._codeBlockCopyStore
          ? window._codeBlockCopyStore[codeId] || ''
          : decodeHtmlAttr(button.getAttribute('data-code') || '')
      copyText('copyCode', code)
      flashCopied(button)
    }

    window._copyMessage = function (button) {
      if (!button || typeof button.getAttribute !== 'function') return
      var text = button.getAttribute('data-copy-text') || ''
      if (!text || !text.trim()) return
      copyText('copyMessage', text)
      flashCopied(button)
      setTimeout(closeMessageActions, 500)
    }

    window._resend = function () {
      config.postToRN({ type: 'resend' })
    }
    window._editQueued = function (queueMessageId) {
      config.postToRN({ type: 'editQueued', queueMessageId: queueMessageId })
    }
    window._deleteQueued = function (queueMessageId) {
      config.postToRN({ type: 'deleteQueued', queueMessageId: queueMessageId })
    }
    installMessageLongPress()
  }

  window.ShennianChatCopy = { install: install }
})()
