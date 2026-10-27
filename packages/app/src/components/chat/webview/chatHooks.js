// @arch docs/architecture/app/modular-features.md#移动端长对话渲染
// @test src/__tests__/chat-webview-script.test.ts

;(function () {
  'use strict'

  function createChatHooks(config) {
    var container = config.container
    var imagePreviewRequests = {}
    var imagePreviewObserver =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(
            function (entries) {
              for (var i = 0; i < entries.length; i++) {
                var entry = entries[i]
                if (!entry.isIntersecting) continue
                var node = entry.target
                imagePreviewObserver.unobserve(node)
                requestImagePreview(node)
              }
            },
            { rootMargin: '320px 0px' },
          )
        : null

    function requestImagePreview(node) {
      if (!node) return
      var row = node.closest ? node.closest('[data-id]') : null
      var messageId = row ? row.getAttribute('data-id') || '' : ''
      var path = node.getAttribute('data-resource-path') || ''
      if (!messageId || !path) return
      var key = messageId + ':' + path
      if (imagePreviewRequests[key]) return
      imagePreviewRequests[key] = true
      config.postToRN({
        type: 'attachmentPreviewRequest',
        messageId: messageId,
        path: path,
        name: node.getAttribute('data-resource-name') || '',
        mimeType: node.getAttribute('data-resource-mime') || 'image/png',
      })
    }

    function hookImagePreviews() {
      container.querySelectorAll('.attachment-image-placeholder').forEach(function (node) {
        if (node._previewHooked) return
        node._previewHooked = true
        if (imagePreviewObserver) imagePreviewObserver.observe(node)
        else requestImagePreview(node)
      })
    }

    function resetImagePreviewRequests(messageId) {
      if (!messageId) {
        imagePreviewRequests = {}
        return
      }
      var prefix = String(messageId) + ':'
      for (var key in imagePreviewRequests) {
        if (key.indexOf(prefix) === 0) delete imagePreviewRequests[key]
      }
    }

    function snapshotExpandedDetails(root) {
      var expanded = {}
      if (!root || typeof root.querySelectorAll !== 'function') return expanded
      root.querySelectorAll('details[data-detail-key]').forEach(function (node) {
        if (node.open) {
          var key = node.getAttribute('data-detail-key')
          if (key) expanded[key] = true
        }
      })
      return expanded
    }

    function restoreExpandedDetails(root, expanded) {
      if (!root || typeof root.querySelectorAll !== 'function' || !expanded) return
      root.querySelectorAll('details[data-detail-key]').forEach(function (node) {
        var key = node.getAttribute('data-detail-key')
        if (key && expanded[key]) node.open = true
      })
    }

    function hookLinks() {
      container.querySelectorAll('[data-resource-path], a[href]').forEach(function (node) {
        if (node._hooked) return
        node._hooked = true
        var longPressTimer = null
        var didLongPress = false
        var workerTouchMoved = false
        var workerTouchStart = null
        var lastWorkerTouchAt = 0
        var workerHref = node.classList.contains('worker-session-card')
          ? node.getAttribute('href') || '' : ''
        node.addEventListener(
          'touchstart',
          function (event) {
            didLongPress = false
            if (workerHref) {
              workerTouchMoved = false
              var touch = event.touches && event.touches[0]
              workerTouchStart = touch ? { x: touch.clientX, y: touch.clientY } : null
            }
            var path = node.getAttribute('data-resource-path')
            if (!path) return
            var isImage =
              node.classList.contains('attachment-thumb-btn') ||
              node.classList.contains('attachment-image-placeholder')
            if (!isImage) return
            longPressTimer = setTimeout(function () {
              didLongPress = true
              config.postToRN({ type: 'imageLongPress', path: path })
            }, 500)
          },
          { passive: true },
        )
        node.addEventListener(
          'touchend',
          function (event) {
            if (longPressTimer) {
              clearTimeout(longPressTimer)
              longPressTimer = null
            }
            if (workerHref && !workerTouchMoved) {
              var touch = event.changedTouches && event.changedTouches[0]
              if (touch && workerTouchStart &&
                (Math.abs(touch.clientX - workerTouchStart.x) > 10 ||
                 Math.abs(touch.clientY - workerTouchStart.y) > 10)) return
              event.preventDefault()
              lastWorkerTouchAt = Date.now()
              config.postToRN({ type: 'linkPress', url: workerHref })
            }
          },
          { passive: !workerHref },
        )
        node.addEventListener(
          'touchmove',
          function (event) {
            var touch = event.touches && event.touches[0]
            if (workerHref && touch && workerTouchStart &&
              (Math.abs(touch.clientX - workerTouchStart.x) > 10 ||
               Math.abs(touch.clientY - workerTouchStart.y) > 10)) workerTouchMoved = true
            if (longPressTimer) {
              clearTimeout(longPressTimer)
              longPressTimer = null
            }
          },
          { passive: true },
        )
        node.addEventListener('click', function (event) {
          event.preventDefault()
          if (workerHref && Date.now() - lastWorkerTouchAt < 700) return
          if (didLongPress) {
            didLongPress = false
            return
          }
          var path = node.getAttribute('data-resource-path')
          if (path) {
            var payload = { type: 'resourcePress', path: path }
            var row = node.closest ? node.closest('[data-id]') : null
            var isImage = node.classList.contains('resource-pill-image') || node.classList.contains('attachment-thumb-btn') ||
              node.classList.contains('attachment-image-placeholder') ||
              node.getAttribute('data-resource-kind') === 'image'
            if (isImage && row && typeof row.querySelectorAll === 'function') {
              payload.imagePaths = []
              row.querySelectorAll('.resource-pill-image[data-resource-path], .attachment-thumb-btn[data-resource-path], .attachment-image-placeholder[data-resource-path], [data-resource-kind="image"][data-resource-path]').forEach(function (image) {
                var imagePath = image.getAttribute('data-resource-path')
                if (imagePath && payload.imagePaths.indexOf(imagePath) < 0) payload.imagePaths.push(imagePath)
              })
            }
            config.postToRN(payload)
            return
          }
          var rawHref = node.getAttribute('href') || ''
          if (config.isLocalResourceHref(rawHref)) {
            config.postToRN({
              type: 'resourcePress',
              path: config.normalizeLocalResourceHref(rawHref),
            })
            return
          }
          if (rawHref.indexOf('shennian://session/sess_worker_') === 0) {
            config.postToRN({ type: 'linkPress', url: rawHref })
            return
          }
          var externalUrl = config.getOpenableExternalUrl(node, rawHref)
          if (externalUrl) config.postToRN({ type: 'linkPress', url: externalUrl })
        })
        node.addEventListener('contextmenu', function (event) {
          var path = node.getAttribute('data-resource-path')
          var isImage =
            node.getAttribute('data-resource-kind') === 'image' ||
            node.classList.contains('attachment-thumb-btn') ||
            node.classList.contains('attachment-image-placeholder')
          if (!path || !isImage) return
          event.preventDefault()
          config.postToRN({ type: 'imageLongPress', path: path })
        })
      })
    }

    function hookWorkerSessionRows() {
      container.querySelectorAll('a[href^="shennian://session/"]').forEach(function (link) {
        var row = link.closest ? link.closest('[data-id]') : null
        if (!row || row._workerSessionHooked) return
        row._workerSessionHooked = true
        row.classList.add('worker-session-message')
        row.addEventListener('click', function (event) {
          if (event.target && event.target.closest && event.target.closest('a, button, details, summary, input, textarea, [data-resource-path]')) return
          var href = link.getAttribute('href') || ''
          if (href.indexOf('shennian://session/sess_worker_') !== 0) return
          event.preventDefault()
          config.postToRN({ type: 'linkPress', url: href })
        })
      })
    }

    function hookProcessCollapses() {
      container.querySelectorAll('.process-collapse').forEach(function (node) {
        if (node._processHooked) return
        node._processHooked = true
        node.addEventListener('toggle', function () {
          if (!node.open) return
          var content = node.querySelector('.process-collapse-content')
          if (!content || content.getAttribute('data-loaded') === 'true') return
          var ids = String(node.getAttribute('data-process-ids') || '')
            .split(',')
            .filter(Boolean)
          var messages = []
          for (var i = 0; i < ids.length; i++) {
            var msg = config.findMsg(ids[i])
            if (msg) messages.push(msg)
          }
          var processItems = config.buildProcessRenderItems(messages)
          var html = ''
          for (var j = 0; j < processItems.length; j++) {
            html += config.renderItemHtml(processItems[j])
          }
          content.innerHTML = html
          content.setAttribute('data-loaded', 'true')
          hookLinks()
          hookWorkerSessionRows()
          // Process rows are lazy-rendered and can contain a paged tool group.
          hookToolGroups()
          hookToolDetails()
          hookProcessCollapses()
        })
      })
    }

    function hookToolDetails() {
      container
        .querySelectorAll(
          '.tool-disclosure[data-tool-message-id], .tool-group-item[data-tool-message-id]',
        )
        .forEach(function (node) {
          if (node._toolDetailHooked) return
          node._toolDetailHooked = true
          var request = function () {
            if (node.tagName === 'DETAILS' && !node.open) return
            var messageId = node.getAttribute('data-tool-message-id') || ''
            var toolIndexRaw = node.getAttribute('data-tool-index') || '0'
            var toolName = node.getAttribute('data-tool-name') || ''
            if (!messageId) return
            var msg = config.findMsg(messageId)
            var index = parseInt(toolIndexRaw, 10)
            if (!isFinite(index)) index = 0
            var tc = msg && msg.toolCalls ? msg.toolCalls[index] : null
            var hasInputDetail = tc && (tc.args != null || tc.argsSummary != null || tc.command)
            if (
              !tc ||
              tc.detailStatus === 'loading' ||
              tc.detailStatus === 'loaded' ||
              (hasInputDetail && tc.result != null)
            ) {
              return
            }
            if (
              tc.detailStatus === 'offline' ||
              tc.detailStatus === 'unsupported' ||
              tc.detailStatus === 'unavailable' ||
              tc.detailStatus === 'error'
            ) {
              tc.detailStatus = undefined
            }
            tc.detailStatus = 'loading'
            config.postToRN({
              type: 'toolDetailRequest',
              messageId: messageId,
              toolIndex: index,
              name: toolName || tc.name,
              detailRef: tc.detailRef,
            })
          }
          if (node.tagName === 'DETAILS' || node.classList.contains('tool-disclosure')) {
            node.addEventListener('toggle', function () {
              if (node.open) request()
            })
          } else {
            node.addEventListener('click', request)
          }
        })
    }

    function hookToolGroups() {
      var pageSize = 20
      container.querySelectorAll('.tool-group[data-tool-group-ids]').forEach(function (node) {
        if (node._toolGroupHooked) return
        node._toolGroupHooked = true
        var content = node.querySelector('.tool-group-content')
        var load = function (count) {
          if (!content) return
          var ids = String(node.getAttribute('data-tool-group-ids') || '')
            .split(',')
            .filter(Boolean)
          var messages = []
          for (var i = 0; i < ids.length; i++) {
            var message = config.findMsg(ids[i])
            if (message) messages.push(message)
          }
          var rendered = Math.min(messages.length, Math.max(pageSize, Number(count) || pageSize))
          content.innerHTML =
            config.toolGroupItemsHtml(messages, 0, rendered) +
            config.toolGroupMoreHtml(Math.min(pageSize, messages.length - rendered))
          content.setAttribute('data-loaded', 'true')
          content.setAttribute('data-rendered-count', String(rendered))
          hookToolDetails()
          var more = content.querySelector('[data-tool-group-more]')
          if (more) {
            more.addEventListener('click', function (event) {
              event.preventDefault()
              event.stopPropagation()
              load(rendered + pageSize)
            })
          }
        }
        var unload = function () {
          if (!content) return
          content.innerHTML = ''
          content.setAttribute('data-loaded', 'false')
          content.removeAttribute('data-rendered-count')
        }
        node._loadToolGroup = load
        node.addEventListener('toggle', function () {
          if (node.open) load(pageSize)
          else unload()
        })
        if (node.open) load(pageSize)
      })
    }

    function hookAll() {
      hookLinks()
      hookWorkerSessionRows()
      hookImagePreviews()
      hookToolGroups()
      hookToolDetails()
      hookProcessCollapses()
    }

    return {
      hookAll: hookAll,
      hookLinks: hookLinks,
      hookWorkerSessionRows: hookWorkerSessionRows,
      hookImagePreviews: hookImagePreviews,
      resetImagePreviewRequests: resetImagePreviewRequests,
      hookToolDetails: hookToolDetails,
      hookToolGroups: hookToolGroups,
      hookProcessCollapses: hookProcessCollapses,
      snapshotExpandedDetails: snapshotExpandedDetails,
      restoreExpandedDetails: restoreExpandedDetails,
    }
  }

  window.ShennianChatHooks = { createChatHooks: createChatHooks }
})()
