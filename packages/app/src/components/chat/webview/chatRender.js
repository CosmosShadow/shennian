;(function () {
  'use strict'

  var TOOL_RESULT_PREVIEW_CHARS = 1200

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function i18n(key, fallback) {
    return (window._i18n && window._i18n[key]) || fallback
  }

  function i18nCount(key, fallback, count) {
    return i18n(key, fallback).replace(/__COUNT__/g, String(count))
  }

  function isSystemContextText(value) {
    var text = String(value || '').trim()
    return (
      /^<environment_context>[\s\S]*<\/environment_context>$/i.test(text) ||
      /^# AGENTS\.md instructions for [^\n]+[\s\S]*<INSTRUCTIONS>[\s\S]*<\/INSTRUCTIONS>/i.test(text) ||
      /^<turn_aborted>[\s\S]*<\/turn_aborted>$/i.test(text)
    )
  }

  function redactSystemContextText(value) {
    return isSystemContextText(value) ? '[SYSTEM CONTEXT REDACTED]' : value
  }

  function sanitizeToolDisplayValue(value) {
    if (typeof value === 'string') return redactSystemContextText(value)
    if (Array.isArray(value)) return value.map(sanitizeToolDisplayValue)
    if (value && typeof value === 'object') {
      var output = {}
      for (var key in value) {
        output[key] = sanitizeToolDisplayValue(value[key])
      }
      return output
    }
    return value
  }

  function stringifyToolDisplayValue(value) {
    return JSON.stringify(sanitizeToolDisplayValue(value), null, 2)
  }

  function toolDetailMessage(status) {
    if (status === 'loading') return i18n('toolDetailLoading', '正在从运行机器加载命令详情...')
    if (status === 'offline') return i18n('toolDetailOffline', '需要运行机器在线才能查看详情。')
    if (status === 'unsupported') return i18n('toolDetailUnsupported', '当前 daemon 版本不支持按需查看工具详情。')
    if (status === 'unavailable') return i18n('toolDetailUnavailable', '这条工具详情在运行机器上不可用。')
    if (status === 'error') return i18n('toolDetailError', '命令详情加载失败，请稍后重试。')
    return i18n('toolDetailCta', '展开后从运行机器加载命令详情。')
  }

  function truncateToolText(text) {
    var value = String(text || '')
    if (value.length <= TOOL_RESULT_PREVIEW_CHARS) {
      return { text: value, truncated: false, omitted: 0 }
    }
    return {
      text: value.slice(0, TOOL_RESULT_PREVIEW_CHARS),
      truncated: true,
      omitted: value.length - TOOL_RESULT_PREVIEW_CHARS,
    }
  }

  function toolCodeSection(label, value, truncate) {
    var content = String(value || '')
    var preview = truncate
      ? truncateToolText(content)
      : { text: content, truncated: false, omitted: 0 }
    var footer = preview.truncated
      ? '<div class="tool-code-truncated">' +
        escapeHtml(
          i18nCount(
            'toolCodeTruncated',
            '已截断 __COUNT__ 字符，完整结果已保存。',
            preview.omitted,
          ),
        ) +
        '</div>'
      : ''
    return (
      '<div class="tool-section"><span class="tool-label">' +
      escapeHtml(label) +
      '</span><pre class="tool-code">' +
      escapeHtml(preview.text) +
      '</pre>' +
      footer +
      '</div>'
    )
  }

  function summarizeToolCall() {
    return { title: i18n('toolCall', '工具调用'), meta: '' }
  }

  function summarizeToolGroup(toolCalls, isActiveRun, activeToolCallCount) {
    var count =
      isActiveRun && Number(activeToolCallCount) > 0
        ? Number(activeToolCallCount)
        : toolCalls.length
    return {
      title: i18nCount(
        'toolGroupTools',
        '__COUNT__ 个工具',
        count,
      ),
      meta: '',
    }
  }

  function singleToolHtml(tc, detailKey, isActiveRun) {
    var summary = summarizeToolCall(tc, isActiveRun)
    var hasDetail = tc.args != null || tc.argsSummary != null || tc.command
    var argsSection =
      tc.args != null
        ? toolCodeSection(i18n('arguments', '参数'), stringifyToolDisplayValue(tc.args), false)
        : tc.argsSummary != null
          ? toolCodeSection(i18n('arguments', '参数'), stringifyToolDisplayValue(tc.argsSummary), false)
        : ''
    var summaryCommand = tc.argsSummary && typeof tc.argsSummary === 'object' ? tc.argsSummary.command : undefined
    var commandSection =
      tc.command && tc.args == null && summaryCommand !== tc.command
        ? toolCodeSection(i18n('command', '命令'), redactSystemContextText(tc.command), false)
        : ''
    var resultSection =
      tc.result != null ? toolCodeSection(i18n('result', '结果'), redactSystemContextText(tc.result), true) : ''
    var omittedSection = tc.resultOmitted && tc.result == null
      ? '<div class="tool-detail-hint">' +
        escapeHtml(i18n('toolResultOmitted', '执行结果未同步，结果保存在运行机器上。')) +
        '</div>'
      : ''
    var detailHint = !hasDetail
      ? '<div class="tool-detail-hint" data-tool-detail-placeholder="true">' +
        escapeHtml(toolDetailMessage(tc.detailStatus)) +
        '</div>'
      : ''
    return (
      '<details class="tool-disclosure tool-block"' +
      (detailKey ? ' data-detail-key="' + escapeHtml(detailKey) + '"' : '') +
      ' data-tool-message-id="' + escapeHtml(tc.messageId || '') + '"' +
      ' data-tool-index="' + escapeHtml(tc.toolIndex == null ? '0' : String(tc.toolIndex)) + '"' +
      ' data-tool-name="' + escapeHtml(tc.name || '') + '"' +
      '>' +
      '<summary>' +
      '<span class="tool-summary">' +
      '<span class="tool-title">' +
      escapeHtml(summary.title) +
      '</span>' +
      (summary.meta ? '<span class="tool-meta">' + escapeHtml(summary.meta) + '</span>' : '') +
      '</span>' +
      '</summary>' +
      '<div class="tool-content">' +
      commandSection +
      argsSection +
      resultSection +
      omittedSection +
      detailHint +
      '</div>' +
      '</details>'
    )
  }

  function toolGroupHtml(messages, isActiveRun, activeToolCallCount) {
    var toolCalls = []
    var messageIds = []
    for (var i = 0; i < messages.length; i++) {
      if (messages[i].toolCalls && messages[i].toolCalls.length > 0) {
        toolCalls.push(messages[i].toolCalls[0])
        if (!messages[i].toolCalls[0].messageId) messages[i].toolCalls[0].messageId = messages[i].id
        if (messages[i].toolCalls[0].toolIndex == null) messages[i].toolCalls[0].toolIndex = 0
        messageIds.push(messages[i].id)
      }
    }

    var summary = summarizeToolGroup(toolCalls, isActiveRun, activeToolCallCount)
    return (
      '<details class="tool-disclosure tool-group" data-tool-group-ids="' +
      escapeHtml(messageIds.join(',')) +
      '" data-detail-key="tool-group:' +
      escapeHtml(messageIds[0] || '') +
      '">' +
      '<summary><span class="tool-summary"><span class="tool-title">' +
      escapeHtml(summary.title) +
      '</span></span></summary>' +
      '<div class="tool-group-content" data-loaded="false"></div>' +
      '</details>'
    )
  }

  function toolGroupItemsHtml(messages, start, limit) {
    var html = ''
    var from = Math.max(0, Number(start) || 0)
    var to = typeof limit === 'number' ? Math.min(messages.length, from + limit) : messages.length
    if (window._shennianPerfEnabled) {
      var metrics = window._shennianPerf || (window._shennianPerf = {})
      var current = metrics['tool_group.items_built'] || { count: 0, totalMs: 0, maxMs: 0 }
      metrics['tool_group.items_built'] = {
        count: current.count + (to - from),
        totalMs: current.totalMs,
        maxMs: current.maxMs,
      }
    }
    for (var j = from; j < to; j++) {
      var message = messages[j]
      if (!message.toolCalls || message.toolCalls.length === 0) continue
      var tc = message.toolCalls[0]
      if (!tc.messageId) tc.messageId = message.id
      if (tc.toolIndex == null) tc.toolIndex = 0
      var hasDetail = tc.args != null || tc.argsSummary != null || tc.command
      var argsSection =
        tc.args != null
          ? toolCodeSection(i18n('arguments', '参数'), stringifyToolDisplayValue(tc.args), false)
          : tc.argsSummary != null
            ? toolCodeSection(i18n('arguments', '参数'), stringifyToolDisplayValue(tc.argsSummary), false)
          : ''
      var summaryCommand = tc.argsSummary && typeof tc.argsSummary === 'object' ? tc.argsSummary.command : undefined
      var commandSection =
        tc.command && tc.args == null && summaryCommand !== tc.command
          ? toolCodeSection(i18n('command', '命令'), redactSystemContextText(tc.command), false)
          : ''
      var resultSection =
        tc.result != null ? toolCodeSection(i18n('result', '结果'), redactSystemContextText(tc.result), true) : ''
      var omittedSection = tc.resultOmitted && tc.result == null
        ? '<div class="tool-detail-hint">' +
          escapeHtml(i18n('toolResultOmitted', '执行结果未同步，结果保存在运行机器上。')) +
          '</div>'
        : ''
      var detailHint = !hasDetail
        ? '<div class="tool-detail-hint" data-tool-detail-placeholder="true">' +
          escapeHtml(toolDetailMessage(tc.detailStatus)) +
          '</div>'
        : ''
      html +=
        '<details class="tool-group-item" data-tool-message-id="' +
        escapeHtml(message.id) +
        '" data-tool-index="' +
        escapeHtml(tc.toolIndex == null ? '0' : String(tc.toolIndex)) +
        '" data-tool-name="' +
        escapeHtml(tc.name || '') +
        '" data-detail-key="tool-item:' +
        escapeHtml(message.id) + ':' +
        escapeHtml(tc.toolIndex == null ? '0' : String(tc.toolIndex)) +
        '">' +
        '<summary class="tool-group-item-header">' +
        '<span class="tool-item-label">' +
        escapeHtml(i18n('toolCall', '工具调用')) +
        '</span>' +
        '</summary>' +
        '<div class="tool-group-item-body">' +
        commandSection +
        argsSection +
        resultSection +
        omittedSection +
        detailHint +
        '</div>' +
        '</details>'
    }

    return html
  }

  function toolGroupMoreHtml(remaining) {
    if (remaining <= 0) return ''
    return (
      '<button type="button" class="tool-group-more" data-tool-group-more="true">' +
      escapeHtml(i18nCount('toolGroupMore', '再显示 __COUNT__ 个工具', remaining)) +
      '</button>'
    )
  }

  function buildAttachmentRef(attachment) {
    var label = String(attachment.name || '').replace(/[[\]\\]/g, '\\$&')
    return attachment.kind === 'image'
      ? '![' + label + '](<' + attachment.path + '>)'
      : '[' + label + '](<' + attachment.path + '>)'
  }

  function stripAttachmentRefs(content, attachments) {
    if (!attachments || attachments.length === 0) return String(content || '').trim()
    var refs = {}
    for (var i = 0; i < attachments.length; i++) refs[buildAttachmentRef(attachments[i])] = true
    var lines = String(content || '').split('\n')
    var kept = []
    for (var j = 0; j < lines.length; j++) {
      if (!refs[lines[j].trim()]) kept.push(lines[j])
    }
    return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  }

  function getInlinePreviewAttachments(attachments) {
    if (!attachments || attachments.length === 0) return []
    var previewAttachments = []
    for (var i = 0; i < attachments.length; i++) {
      if (attachments[i].kind === 'image') previewAttachments.push(attachments[i])
    }
    return previewAttachments
  }

  function basename(path) {
    var cleaned = String(path || '').replace(/[?#].*$/, '').replace(/[\\/]+$/, '')
    var parts = cleaned.split(/[\\/]/)
    return parts[parts.length - 1] || cleaned || 'image'
  }

  function mimeTypeFromName(name) {
    var lower = String(name || '').toLowerCase()
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
    if (lower.endsWith('.gif')) return 'image/gif'
    if (lower.endsWith('.webp')) return 'image/webp'
    if (lower.endsWith('.svg')) return 'image/svg+xml'
    if (lower.endsWith('.bmp')) return 'image/bmp'
    if (lower.endsWith('.heic')) return 'image/heic'
    if (lower.endsWith('.heif')) return 'image/heif'
    return 'image/png'
  }

  function getMarkdownImagePreviewAttachments(msg) {
    var content = String(msg.content || '')
    var re = /!\[([^\]]*)\]\(<([^>]+)>\)|!\[([^\]]*)\]\(([^)\s]+)\)/g
    var attachments = []
    var seen = {}
    var match
    while ((match = re.exec(content))) {
      var label = match[1] || match[3] || ''
      var path = match[2] || match[4] || ''
      if (!path || seen[path]) continue
      seen[path] = true
      var name = label || basename(path)
      attachments.push({
        path: path,
        name: name,
        mimeType: mimeTypeFromName(name),
        kind: 'image',
      })
    }
    return attachments
  }

  function getMessagePreviewAttachments(msg) {
    var combined = getInlinePreviewAttachments(msg.attachments).concat(
      getMarkdownImagePreviewAttachments(msg),
    )
    var unique = []
    var seen = {}
    for (var i = 0; i < combined.length; i++) {
      var attachment = combined[i]
      if (!attachment.path || seen[attachment.path]) continue
      seen[attachment.path] = true
      unique.push(attachment)
    }
    return unique
  }

  function attachmentPreviewSrc(attachment) {
    var value = String(attachment.previewData || '')
    if (/^(?:data:|file:|content:|blob:)/i.test(value)) return value
    return 'data:' + String(attachment.mimeType || 'image/png') + ';base64,' + value
  }

  function attachmentsHtml(msg) {
    var previewAttachments = getMessagePreviewAttachments(msg)
    if (previewAttachments.length === 0) return ''
    var html = '<div class="user-attachments">'
    for (var i = 0; i < previewAttachments.length; i++) {
      var attachment = previewAttachments[i]
      if (attachment.kind === 'image' && attachment.previewData) {
        html +=
          '<button class="attachment-thumb-btn" type="button" data-resource-path="' +
          escapeHtml(attachment.path) +
          '" data-resource-kind="image">' +
          '<img class="attachment-thumb" src="' +
          escapeHtml(attachmentPreviewSrc(attachment)) +
          '" alt="' +
          escapeHtml(attachment.name) +
          '" onerror="this.style.display=\'none\';var fallback=this.nextElementSibling;if(fallback)fallback.style.display=\'flex\';this.parentElement.classList.add(\'attachment-thumb-failed\')" />' +
          '<span class="attachment-thumb-fallback">' +
          '<span class="placeholder-icon">🖼</span>' +
          '<span class="placeholder-label">' +
          escapeHtml(attachment.name) +
          '</span>' +
          '</span>' +
          '</button>'
      } else if (attachment.kind === 'image') {
        html +=
          '<button class="attachment-image-placeholder" type="button" data-resource-path="' +
          escapeHtml(attachment.path) +
          '" data-resource-kind="image" data-resource-name="' +
          escapeHtml(attachment.name) +
          '" data-resource-mime="' +
          escapeHtml(attachment.mimeType || 'image/png') +
          '"><span class="placeholder-icon">🖼</span></button>'
      } else {
        html +=
          '<button class="attachment-file-card" type="button" data-resource-path="' +
          escapeHtml(attachment.path) +
          '"><span class="attachment-file-icon">📄</span><span class="attachment-file-name">' +
          escapeHtml(attachment.name) +
          '</span></button>'
      }
    }
    html += '</div>'
    return html
  }

  window.ShennianChatRender = {
    attachmentsHtml: attachmentsHtml,
    getInlinePreviewAttachments: getInlinePreviewAttachments,
    summarizeToolGroup: summarizeToolGroup,
    singleToolHtml: singleToolHtml,
    stripAttachmentRefs: stripAttachmentRefs,
    toolGroupHtml: toolGroupHtml,
    toolGroupItemsHtml: toolGroupItemsHtml,
    toolGroupMoreHtml: toolGroupMoreHtml,
  }
})()
