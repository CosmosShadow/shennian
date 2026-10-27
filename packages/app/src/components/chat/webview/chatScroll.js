// @arch docs/architecture/app/modular-features.md#移动端长对话渲染
// @test src/__tests__/chat-webview-scroll.test.ts
;(function () {
  'use strict'

  function create(config) {
    var root = config.scrollRoot
    var following = true
    var touching = false
    var userScrolling = false
    var gestureMoved = false
    var lastTop = root.scrollTop
    var touchY = null
    var lockedUntil = 0
    var frame = null
    var animation = null
    var reportTimer = null
    var gestureTimer = null

    function distance() {
      return Math.max(0, root.scrollHeight - root.clientHeight - root.scrollTop)
    }
    function isNearBottom() {
      // A reading position above the actual end must never turn into follow
      // intent merely because the user's gesture ended nearby. Allow only
      // subpixel rounding in WebKit's scroll metrics.
      return distance() <= 1
    }
    function canFollow() {
      return following && !touching && !userScrolling
    }
    function lockProgrammaticScroll() {
      lockedUntil = config.nowMs() + 180
    }
    function cancel() {
      if (frame != null) cancelAnimationFrame(frame)
      frame = null
      animation = null
    }
    function report() {
      clearTimeout(reportTimer)
      reportTimer = setTimeout(function () {
        config.postToRN({
          type: 'scrollState',
          distanceFromBottom: distance(),
          distanceFromTop: Math.max(0, root.scrollTop),
          scrollTop: root.scrollTop,
        })
      }, 100)
    }
    function writeBottom() {
      config.ensureBottomWindow()
      lockProgrammaticScroll()
      root.scrollTop = root.scrollHeight
      lastTop = root.scrollTop
      report()
    }
    function tick() {
      frame = null
      if (!canFollow()) return
      config.ensureBottomWindow()
      if (animation) {
        var progress = Math.min(1, Math.max(0, (config.nowMs() - animation.started) / 220))
        // Recompute the destination on every frame: keyboard dismissal and
        // outgoing/streaming content can change it during the same animation.
        var target = Math.max(0, root.scrollHeight - root.clientHeight)
        lockProgrammaticScroll()
        root.scrollTop =
          animation.from + (target - animation.from) * (1 - (1 - progress) * (1 - progress))
        lastTop = root.scrollTop
        if (progress < 1) {
          frame = requestAnimationFrame(tick)
          return
        }
        animation = null
      }
      writeBottom()
    }
    function schedule() {
      if (!canFollow() || frame != null) return
      frame = requestAnimationFrame(tick)
    }
    function layoutChanged() {
      if (!canFollow()) return
      // ResizeObserver runs before paint. Correct a settled viewport here so
      // cold entry does not paint one frame at yesterday's document height.
      if (!animation) writeBottom()
      else schedule()
    }
    function pause() {
      following = false
      cancel()
    }
    function reset(follow) {
      cancel()
      clearTimeout(gestureTimer)
      touching = false
      userScrolling = false
      gestureMoved = false
      following = follow
      lastTop = root.scrollTop
    }
    function resume(animated) {
      reset(true)
      config.ensureBottomWindow()
      if (
        animated &&
        !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      ) {
        animation = { from: root.scrollTop, started: config.nowMs() }
        schedule()
      } else {
        writeBottom()
      }
    }
    function finishGesture() {
      if (touching) return
      userScrolling = false
      if (gestureMoved) following = isNearBottom()
      gestureMoved = false
      schedule()
    }
    function settleGesture() {
      clearTimeout(gestureTimer)
      gestureTimer = setTimeout(finishGesture, 160)
    }
    root.addEventListener(
      'touchstart',
      function (event) {
        touching = true
        userScrolling = false
        gestureMoved = false
        lastTop = root.scrollTop
        touchY = event && event.touches && event.touches[0] ? event.touches[0].clientY : null
        clearTimeout(gestureTimer)
        cancel()
      },
      { passive: true },
    )
    root.addEventListener(
      'touchmove',
      function (event) {
        var y = event && event.touches && event.touches[0] ? event.touches[0].clientY : null
        if (y != null && touchY != null && Math.abs(y - touchY) > 4) {
          gestureMoved = true
          userScrolling = true
          if (y > touchY) following = false
          touchY = y
        }
      },
      { passive: true },
    )
    function endTouch() {
      touching = false
      if (gestureMoved) settleGesture()
      else schedule() // A tap is not an instruction to stop following.
    }
    root.addEventListener('touchend', endTouch, { passive: true })
    root.addEventListener('touchcancel', endTouch, { passive: true })
    root.addEventListener(
      'wheel',
      function (event) {
        if (!event || !event.deltaY) return
        cancel()
        userScrolling = true
        gestureMoved = true
        if (event.deltaY < 0) following = false
        settleGesture()
      },
      { passive: true },
    )
    root.addEventListener(
      'scroll',
      function () {
        // Only gestures (including their inertial tail) can revoke follow intent.
        // DOM growth, WebKit anchoring and viewport resize must never do so.
        if ((touching || userScrolling) && config.nowMs() >= lockedUntil) {
          if (root.scrollTop < lastTop - 2) following = false
          if (Math.abs(root.scrollTop - lastTop) > 2) {
            gestureMoved = true
            userScrolling = true
          }
        }
        lastTop = root.scrollTop
        if (!canFollow()) config.handleHistoryScroll()
        else schedule()
        if (userScrolling && !touching) settleGesture()
        report()
      },
      { passive: true },
    )

    // Observe both actual document height and viewport height. This covers
    // initial layout, final Markdown, images, composer resizing and keyboard
    // frames without fixed-delay retries or a continuously running RAF loop.
    if (typeof ResizeObserver !== 'undefined') {
      var observer = new ResizeObserver(layoutChanged)
      observer.observe(root)
      observer.observe(config.container)
    }
    window.addEventListener('resize', layoutChanged)
    if (window.visualViewport) window.visualViewport.addEventListener('resize', layoutChanged)
    config.container.addEventListener('load', layoutChanged, true)
    return {
      canFollow: canFollow,
      isNearBottom: isNearBottom,
      lockProgrammaticScroll: lockProgrammaticScroll,
      schedule: schedule,
      layoutChanged: layoutChanged,
      reset: reset,
      resume: resume,
      pause: pause,
    }
  }
  window.ShennianChatScroll = { create: create }
})()
