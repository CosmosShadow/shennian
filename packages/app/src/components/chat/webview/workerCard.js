// @arch docs/features/manager-agent.md#九manager-与-worker-的可见-markdown
// @test src/__tests__/chat-web-timeline-virtualization.test.ts
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.ShennianWorkerCard = factory()
})(typeof window === 'object' ? window : globalThis, function () {
  function parseWorkerCard(content) {
    var match = /^\[((?:\\.|[^\]])+)\]\((shennian:\/\/session\/sess_worker_[A-Za-z0-9_-]+)\)\s*([\s\S]*)$/.exec(String(content || '').trim())
    if (!match) return null
    var heading = match[1].replace(/\\([\\[\]])/g, '$1')
    var separator = heading.indexOf(' · ')
    if (separator < 0) return null
    var label = heading.slice(0, separator)
    var kinds = { '创建 Agent': 'created', 'Agent 执行中': 'progress', '进展更新': 'progress', '发送消息': 'message', 'Agent 完成': 'completed', 'Agent 失败': 'failed', '停止 Agent': 'stopped', 'Agent 已停止': 'stopped' }
    if (!kinds[label]) return null
    var title = heading.slice(separator + 3).trim()
    if (!title) return null
    var preview = match[3]
      .replace(/^\s*```[^\n]*$/gm, '')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/gm, '')
      .replace(/(\*\*|__|~~)([^\n]*?)\1/g, '$2')
      .replace(/(^|\s)([*_])([^\s][^\n]*?)\2(?=\s|[。，！？,.!?]|$)/g, '$1$3')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\s+/g, ' ').trim()
    return { href: match[2], label: label, title: title, kind: kinds[label], preview: preview }
  }
  function escape(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }
  function workerCardInnerHtml(card) {
    var paths = {
      created: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
      completed: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
      progress: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      message: '<path d="M4 5h16v12H9l-5 3V5Z"/><path d="M8 9h8M8 13h5"/>',
      failed: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16h.01"/>',
      stopped: '<circle cx="12" cy="12" r="9"/><path d="M9 9h6v6H9z"/>',
    }
    return '<span class="worker-event-icon worker-event-' + card.kind + '" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' + paths[card.kind] + '</svg></span>' +
      '<span class="worker-card-body"><span class="worker-session-event">' + escape(card.label) + '</span>' +
      '<span class="worker-session-title">' + escape(card.title) + '</span>' +
      (card.preview ? '<span class="worker-session-preview">' + escape(card.preview) + '</span>' : '') + '</span>' +
      '<span class="worker-card-chevron" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="m6 3 5 5-5 5"/></svg></span>'
  }
  return { parseWorkerCard: parseWorkerCard, workerCardInnerHtml: workerCardInnerHtml }
})
