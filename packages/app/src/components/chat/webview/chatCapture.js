/* global ReactNativeWebView */

;(function () {
  'use strict'

  function postToRN(data) {
    if (!window.ReactNativeWebView) return
    window.ReactNativeWebView.postMessage(JSON.stringify(data))
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function collectStyleText() {
    var chunks = []
    for (var i = 0; i < document.styleSheets.length; i++) {
      var sheet = document.styleSheets[i]
      try {
        var rules = sheet.cssRules || []
        for (var j = 0; j < rules.length; j++) chunks.push(rules[j].cssText)
      } catch (_) {
        // Ignore inaccessible stylesheets, such as cross-origin CSS.
      }
    }
    return chunks.join('\n')
  }

  function normalizeCaptureBrandUrl(value) {
    var raw = String(value || '').trim()
    if (!raw) return 'shennian.net'
    try {
      return new URL(raw.indexOf('://') >= 0 ? raw : 'https://' + raw).host || raw
    } catch (_) {
      return raw.replace(/^https?:\/\//i, '').replace(/\/.*$/, '') || 'shennian.net'
    }
  }

  function createCaptureBrandFooter(brandUrl, brandLogoDataUrl, brandQrSvg) {
    var brandHost = normalizeCaptureBrandUrl(brandUrl)
    var footer = document.createElement('div')
    footer.className = 'capture-brand-footer'
    footer.innerHTML =
      '<div class="capture-brand-lockup">' +
      '<img class="capture-brand-icon" src="' +
      escapeHtml(brandLogoDataUrl || '') +
      '" alt="" />' +
      '<div class="capture-brand-copy">' +
      '<div class="capture-brand-name">神念</div>' +
      '</div>' +
      '</div>' +
      '<div class="capture-brand-link">' +
      (brandQrSvg || '') +
      '<div class="capture-brand-url">' +
      escapeHtml(brandHost) +
      '</div>' +
      '</div>'
    return footer
  }

  window._captureLongScreenshot = function (requestId, brandUrl, brandLogoDataUrl, brandQrSvg) {
    requestAnimationFrame(function () {
      try {
        var scrollRoot = document.getElementById('scroll-root')
        var container = document.getElementById('messages')
        if (!scrollRoot || !container || !container.children || container.children.length === 0) {
          postToRN({ type: 'longScreenshotError', requestId: requestId, error: 'empty' })
          return
        }

        var width = Math.ceil(scrollRoot.clientWidth || container.scrollWidth || 1)
        var height = Math.ceil(container.scrollHeight || container.offsetHeight || 1)
        if (width <= 0 || height <= 0) {
          postToRN({ type: 'longScreenshotError', requestId: requestId, error: 'empty' })
          return
        }

        var footerHeight = 128
        var captureHeight = height + footerHeight
        var maxCanvasPixels = 32000000
        var deviceScale = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
        var scale = Math.min(deviceScale, Math.sqrt(maxCanvasPixels / (width * captureHeight)))
        if (!isFinite(scale) || scale <= 0) scale = 1

        var clone = container.cloneNode(true)
        clone.id = 'capture-messages'
        if (typeof window._buildChatCaptureHtml === 'function') {
          clone.innerHTML = window._buildChatCaptureHtml()
        }
        clone.style.minHeight = '0'
        clone.style.width = width + 'px'
        clone.style.background = 'var(--bg)'
        var footer = createCaptureBrandFooter(brandUrl, brandLogoDataUrl, brandQrSvg)

        var wrapper = document.createElement('div')
        wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
        wrapper.className = document.documentElement.className || ''
        wrapper.style.width = width + 'px'
        wrapper.style.minHeight = captureHeight + 'px'
        wrapper.style.background = 'var(--bg)'
        wrapper.appendChild(clone)
        wrapper.appendChild(footer)

        var style = document.createElement('style')
        style.textContent =
          collectStyleText() +
          '\n#capture-messages{padding:8px 0 16px;min-height:0;}body{overflow:visible;}' +
          '.capture-brand-footer{box-sizing:border-box;height:' +
          footerHeight +
          'px;padding:14px 18px 15px;border-top:1px solid var(--border);' +
          'display:flex;align-items:center;justify-content:space-between;gap:14px;' +
          'background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}' +
          '.capture-brand-lockup{display:flex;align-items:center;gap:14px;min-width:0;}' +
          '.capture-brand-icon{width:54px;height:54px;border-radius:14px;flex:0 0 auto;display:block;}' +
          '.capture-brand-copy{min-width:0;}.capture-brand-name{font-size:20px;font-weight:700;line-height:25px;}' +
          '.capture-brand-slogan{font-size:14px;line-height:20px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
          '.capture-brand-link{display:flex;flex-direction:column;align-items:center;gap:4px;flex:0 0 auto;}' +
          '.capture-brand-qr{width:82px;height:82px;border-radius:6px;display:block;}' +
          '.capture-brand-url{font-size:10px;line-height:12px;color:var(--text-tertiary);white-space:nowrap;}'
        wrapper.insertBefore(style, clone)

        var serialized = new XMLSerializer().serializeToString(wrapper)
        var svg =
          '<svg xmlns="http://www.w3.org/2000/svg" width="' +
          width +
          '" height="' +
          captureHeight +
          '" viewBox="0 0 ' +
          width +
          ' ' +
          captureHeight +
          '">' +
          '<foreignObject width="100%" height="100%">' +
          serialized +
          '</foreignObject></svg>'

        var image = new Image()
        image.onload = function () {
          try {
            var canvas = document.createElement('canvas')
            canvas.width = Math.max(1, Math.floor(width * scale))
            canvas.height = Math.max(1, Math.floor(captureHeight * scale))
            var ctx = canvas.getContext('2d')
            if (!ctx) throw new Error('canvas')
            ctx.fillStyle =
              getComputedStyle(document.documentElement).getPropertyValue('--bg') || '#fff'
            ctx.fillRect(0, 0, canvas.width, canvas.height)
            ctx.scale(scale, scale)
            ctx.drawImage(image, 0, 0)
            postToRN({
              type: 'longScreenshot',
              requestId: requestId,
              dataUrl: canvas.toDataURL('image/png'),
              width: canvas.width,
              height: canvas.height,
            })
          } catch (err) {
            postToRN({
              type: 'longScreenshotError',
              requestId: requestId,
              error: err && err.message ? err.message : 'render',
            })
          }
        }
        image.onerror = function () {
          postToRN({ type: 'longScreenshotError', requestId: requestId, error: 'image' })
        }
        image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
      } catch (err) {
        postToRN({
          type: 'longScreenshotError',
          requestId: requestId,
          error: err && err.message ? err.message : 'capture',
        })
      }
    })
  }
})()
