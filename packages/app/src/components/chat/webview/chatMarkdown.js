// @arch docs/features/chat-font-size.md
// @test src/__tests__/chat-webview-markdown.test.ts
/* global katex, marked */
;(function () {
  'use strict'
  marked.setOptions({
    gfm: true,
    breaks: true,
    headerIds: false,
    mangle: false,
  })
  if (typeof marked.use === 'function') {
    marked.use({
      renderer: {
        html: function (token) {
          var text =
            token && typeof token === 'object' ? token.text || token.raw || '' : String(token || '')
          return escapeHtml(text)
        },
        heading: function (token, legacyDepth) {
          var html = ''
          if (
            token &&
            typeof token === 'object' &&
            Array.isArray(token.tokens) &&
            this.parser &&
            typeof this.parser.parseInline === 'function'
          ) {
            html = this.parser.parseInline(token.tokens)
          } else if (token && typeof token === 'object') {
            html = escapeHtml(token.text || '')
          } else {
            html = escapeHtml(String(token || ''))
          }
          var rawDepth = token && typeof token === 'object' ? token.depth : legacyDepth
          var depth = Number.isInteger(rawDepth) && rawDepth >= 1 && rawDepth <= 6 ? rawDepth : 5
          return '<h' + depth + '>' + html + '</h' + depth + '>'
        },
        image: function (token) {
          var href = ''
          var text = ''
          if (typeof token === 'object' && token !== null) {
            href = token.href || ''
            text = token.text || ''
          } else {
            href = String(token || '')
            text = typeof arguments[1] === 'string' ? arguments[1] : ''
          }
          if (isLocalResourceHref(href)) {
            var resourcePath = normalizeLocalResourceHref(href)
            var location = parseLocalResourceLocation(resourcePath)
            var label = appendLocalResourceLineLabel(
              text || resourcePath.split(/[\\/]/).pop() || 'Open image',
              location,
            )
            return (
              '<button class="resource-pill resource-pill-image" type="button" data-resource-path="' +
              escapeHtml(resourcePath) +
              '">' +
              escapeHtml(label) +
              '</button>'
            )
          }
          return '<img src="' + escapeHtml(href) + '" alt="' + escapeHtml(text) + '" />'
        },
        link: function (token) {
          var href = ''
          var text = ''
          var tokens = null
          if (typeof token === 'object' && token !== null) {
            href = token.href || ''
            text = token.text || ''
            tokens = token.tokens
          } else {
            href = String(token || '')
            text = href
          }
          var html =
            tokens && this.parser && typeof this.parser.parseInline === 'function'
              ? this.parser.parseInline(tokens)
              : escapeHtml(text || href)
          var attrs = isExternalOpenHref(href) ? ' target="_blank" rel="noopener noreferrer"' : ''
          if (isLocalResourceHref(href)) {
            var location = parseLocalResourceLocation(href)
            var suffix = formatLocalResourceLineLabel(location)
            if (suffix && !localResourceLabelIncludesLocation(html.replace(/<[^>]+>/g, ''))) {
              return (
                '<a href="' +
                escapeHtml(href) +
                '"' +
                attrs +
                '>' +
                html +
                '<span class="resource-line-label">' +
                escapeHtml(suffix) +
                '</span></a>'
              )
            }
          }
          return '<a href="' + escapeHtml(href) + '"' + attrs + '>' + html + '</a>'
        },
        codespan: function (token) {
          var text =
            token && typeof token === 'object' ? token.text || '' : String(token || '')
          var normalized = normalizeLocalResourceHref(text)
          var location = parseLocalResourceLocation(normalized)
          var canOpen =
            !/[\s<>]/.test(normalized) &&
            isLocalResourceHref(normalized) &&
            !!getPathExt(location.path)
          if (canOpen) {
            return (
              '<a class="inline-resource-code" href="' +
              escapeHtml(normalized) +
              '"><code>' +
              escapeHtml(text) +
              '</code></a>'
            )
          }
          return '<code>' + escapeHtml(text) + '</code>'
        },
      },
    })
  }
  function escapeHtml(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }
  function pad(n) {
    return n < 10 ? '0' + n : '' + n
  }
  function formatTime(ts) {
    var d = new Date(ts)
    var now = new Date()
    var time = pad(d.getHours()) + ':' + pad(d.getMinutes())
    if (d.getFullYear() !== now.getFullYear()) {
      return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + time
    }
    if (d.getMonth() !== now.getMonth() || d.getDate() !== now.getDate()) {
      return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + time
    }
    return time
  }
  function isDifferentDay(ts1, ts2) {
    var a = new Date(ts1)
    var b = new Date(ts2)
    return (
      a.getFullYear() !== b.getFullYear() ||
      a.getMonth() !== b.getMonth() ||
      a.getDate() !== b.getDate()
    )
  }
  var FENCE_LANGUAGES = [
    'shellscript',
    'typescript',
    'javascript',
    'plaintext',
    'dockerfile',
    'markdown',
    'console',
    'python',
    'kotlin',
    'swift',
    'bash',
    'fish',
    'shell',
    'text',
    'jsonc',
    'html',
    'scss',
    'rust',
    'java',
    'yaml',
    'toml',
    'diff',
    'zsh',
    'txt',
    'jsx',
    'tsx',
    'json',
    'css',
    'sql',
    'yml',
    'ini',
    'md',
    'sh',
    'js',
    'ts',
    'py',
    'go',
    'rs',
  ]
  function splitJoinedFenceInfo(info) {
    var raw = String(info || '')
    var lower = raw.toLowerCase()
    for (var i = 0; i < FENCE_LANGUAGES.length; i++) {
      var lang = FENCE_LANGUAGES[i]
      if (lower.indexOf(lang) !== 0 || raw.length <= lang.length) continue
      var body = raw.slice(lang.length).replace(/^\s+/, '')
      if (!body) return null
      return { lang: raw.slice(0, lang.length), body: body }
    }
    return null
  }
  function repairJoinedCodeFences(content) {
    return content
      .replace(/([^\n])(```|~~~)([A-Za-z][A-Za-z0-9_+#.-]*)(?=\n|[^\n`~]*\2)/g, '$1\n\n$2$3')
      .replace(
        /(```|~~~)([^\n`~]+)(?:\n([\s\S]*?))?(\1)/g,
        function (match, fence, info, rest, closingFence) {
          var split = splitJoinedFenceInfo(info)
          if (!split) return match
          var tail = rest ? '\n' + rest : ''
          return fence + split.lang + '\n' + split.body + tail + '\n' + closingFence
        },
      )
  }
  function getFenceOpen(line) {
    var match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line)
    if (!match) return null
    var info = match[3].trim()
    if (info.indexOf(match[2]) >= 0) return null
    return { fence: match[2], lang: info.split(/\s+/)[0].toLowerCase() }
  }
  function isFenceClose(line, fence) {
    var trimmed = String(line || '').trim()
    if (trimmed.length < fence.length) return false
    for (var i = 0; i < trimmed.length; i++) {
      if (trimmed[i] !== fence[0]) return false
    }
    return true
  }
  function isLikelyMarkdownBoundary(line) {
    var trimmed = String(line || '').trim()
    if (!trimmed) return false
    return (
      /^(#{1,6})\s+\S/.test(trimmed) ||
      /^([-*+])\s+\S/.test(trimmed) ||
      /^\d+[.)]\s+\S/.test(trimmed) ||
      /^>\s+\S/.test(trimmed) ||
      /^(-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed) ||
      /^\*\*[^*]+/.test(trimmed) ||
      /^[\u4e00-\u9fff][^`]*[。；：，、]/.test(trimmed)
    )
  }
  function closeLeakingCodeFences(content) {
    var lines = content.split('\n')
    var out = []
    var open = null
    var sawBlankInFence = false
    var codeLineCount = 0
    var pendingBlankLines = []
    var MAX_LEAKED_FENCE_BLANK_LINES = 2

    function flushPendingBlankLines(limit) {
      var count =
        typeof limit === 'number'
          ? Math.min(pendingBlankLines.length, limit)
          : pendingBlankLines.length
      for (var j = 0; j < count; j++) out.push(pendingBlankLines[j])
      pendingBlankLines = []
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i]
      if (open) {
        if (isFenceClose(line, open.fence)) {
          flushPendingBlankLines()
          out.push(line)
          open = null
          sawBlankInFence = false
          codeLineCount = 0
          continue
        }

        if (sawBlankInFence && codeLineCount > 0 && isLikelyMarkdownBoundary(line)) {
          flushPendingBlankLines(MAX_LEAKED_FENCE_BLANK_LINES)
          out.push(open.fence)
          open = null
          sawBlankInFence = false
          codeLineCount = 0
        } else {
          if (line.trim()) {
            flushPendingBlankLines()
            out.push(line)
            codeLineCount += 1
          } else {
            pendingBlankLines.push(line)
            sawBlankInFence = true
          }
          continue
        }
      }

      out.push(line)
      var fenceOpen = getFenceOpen(line)
      if (fenceOpen) {
        open = fenceOpen
        sawBlankInFence = false
        codeLineCount = 0
      }
    }

    if (open) {
      flushPendingBlankLines(MAX_LEAKED_FENCE_BLANK_LINES)
      out.push(open.fence)
    }
    return out.join('\n')
  }
  function normalizeMalformedCodeFences(content) {
    return closeLeakingCodeFences(repairJoinedCodeFences(String(content || '')))
  }
  var AUTOLINK_FILE_EXT_PATTERN =
    'properties|jsonc|plist|swift|bash|conf|docx|heic|heif|html|java|jpeg|json|lock|pptx|sass|scss|toml|webm|webp|xlsx|yaml|aac|avi|bmp|cfg|cpp|css|csv|cts|doc|env|gif|hpp|htm|ico|ini|jpg|jsx|log|m4a|mdx|mov|mp3|mp4|mts|pdf|php|png|ppt|sql|svg|tsx|txt|wav|xls|xml|yml|zip|cc|cs|go|js|kt|md|py|rb|rs|sh|ts|c|h'
  var AUTOLINK_PATH_PATTERN = new RegExp(
    '(^|[\\s([{\\"\'，。；：、])((?:[A-Za-z]:[\\\\/]|~[\\\\/]|/|(?:\\.{1,2}|\\.uploads)[\\\\/]|[A-Za-z0-9._-]+[\\\\/])(?:[^\\s<>()\\[\\]{}\\"\'，。；：、]+[\\\\/])*[^\\s<>()\\[\\]{}\\"\'，。；：、]+\\.(?:' +
      AUTOLINK_FILE_EXT_PATTERN +
      ')(?::\\d+(?:(?::|-)\\d+)?)?)(?=$|[\\s<>()\\[\\]{}\\"\'，。；：、.,!?;])',
    'gi',
  )
  var PROTECTED_AUTOLINK_TOKEN_PREFIX = '\u0000SNREF'
  var PROTECTED_AUTOLINK_TOKEN_SUFFIX = '\u0000'
  function protectRanges(text, ranges) {
    if (!ranges.length) {
      return {
        text: text,
        restore: function (value) {
          return value
        },
      }
    }
    ranges.sort(function (a, b) {
      return a.start - b.start
    })
    var protectedValues = []
    var output = ''
    var cursor = 0
    for (var i = 0; i < ranges.length; i++) {
      var range = ranges[i]
      if (range.start < cursor || range.end <= range.start) continue
      output += text.slice(cursor, range.start)
      var token =
        PROTECTED_AUTOLINK_TOKEN_PREFIX + protectedValues.length + PROTECTED_AUTOLINK_TOKEN_SUFFIX
      protectedValues.push(text.slice(range.start, range.end))
      output += token
      cursor = range.end
    }
    output += text.slice(cursor)
    return {
      text: output,
      restore: function (value) {
        return value.replace(
          new RegExp(
            PROTECTED_AUTOLINK_TOKEN_PREFIX + '(\\d+)' + PROTECTED_AUTOLINK_TOKEN_SUFFIX,
            'g',
          ),
          function (_match, index) {
            return protectedValues[Number(index)] || ''
          },
        )
      },
    }
  }
  function collectMarkdownAutolinkProtectedRanges(text) {
    var ranges = []
    var match
    var fencedCodeRe = /(^|\n)( {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\2\3[ \t]*(?=\n|$)|$)/g
    while ((match = fencedCodeRe.exec(text)))
      ranges.push({ start: match.index, end: fencedCodeRe.lastIndex })
    var inlineCodeRe = /`[^`\n]+`/g
    while ((match = inlineCodeRe.exec(text)))
      ranges.push({ start: match.index, end: inlineCodeRe.lastIndex })
    var markdownLinkRe = /!?\[[^\]\n]*(?:\\.[^\]\n]*)*\]\((?:<[^>\n]+>|[^)\n]+)\)/g
    while ((match = markdownLinkRe.exec(text)))
      ranges.push({ start: match.index, end: markdownLinkRe.lastIndex })
    var htmlTagRe = /<[^>\n]+>/g
    while ((match = htmlTagRe.exec(text)))
      ranges.push({ start: match.index, end: htmlTagRe.lastIndex })
    var urlRe = /\b(?:https?|mailto|tel|data|javascript|vbscript|blob|ftp):[^\s<>()]+/gi
    while ((match = urlRe.exec(text))) ranges.push({ start: match.index, end: urlRe.lastIndex })
    return ranges
  }
  function escapeMarkdownLinkLabel(label) {
    return String(label || '').replace(/[[\]\\]/g, '\\$&')
  }
  function splitAutolinkPathTrailingPunctuation(pathValue) {
    var path = String(pathValue || '')
    var trailing = ''
    while (/[.,!?;，。！？；、]$/.test(path)) {
      trailing = path.slice(-1) + trailing
      path = path.slice(0, -1)
    }
    while (path.slice(-1) === ':' && !/:\d+(?::\d+)?:$/.test(path)) {
      trailing = ':' + trailing
      path = path.slice(0, -1)
    }
    return { path: path, trailing: trailing }
  }
  function isBareAutolinkPathAllowed(pathValue) {
    var normalized = normalizeLocalResourceHref(pathValue)
    return (
      normalized.indexOf('/') === 0 ||
      normalized.indexOf('./') === 0 ||
      normalized.indexOf('../') === 0 ||
      normalized.indexOf('.uploads/') === 0 ||
      normalized.indexOf('~') === 0 ||
      /^[A-Za-z]:[\\/]/.test(normalized) ||
      normalized.indexOf('/') >= 0 ||
      normalized.indexOf('\\') >= 0
    )
  }
  function autolinkLocalFileReferencesInMarkdown(content) {
    var raw = String(content || '')
    if (!raw) return raw
    var protectedContent = protectRanges(raw, collectMarkdownAutolinkProtectedRanges(raw))
    var linked = protectedContent.text.replace(
      AUTOLINK_PATH_PATTERN,
      function (match, prefix, pathValue) {
        if (!isBareAutolinkPathAllowed(pathValue) || !isLocalResourceHref(pathValue)) return match
        var split = splitAutolinkPathTrailingPunctuation(pathValue)
        if (!split.path || !isLocalResourceHref(split.path)) return match
        var label = escapeMarkdownLinkLabel(
          appendLocalResourceLineLabel(split.path, parseLocalResourceLocation(split.path)),
        )
        return prefix + '[' + label + '](<' + split.path + '>)' + split.trailing
      },
    )
    return protectedContent.restore(linked)
  }
  var MATH_INLINE_TOKEN_PREFIX = 'SNMATHINLINETOKEN'
  var MATH_BLOCK_TOKEN_PREFIX = 'SNMATHBLOCKTOKEN'
  var MATH_TOKEN_SUFFIX = 'END'
  function renderMathExpression(latex, displayMode) {
    var source = String(latex || '').trim()
    var className = displayMode ? 'chat-math-block' : 'chat-math-inline'
    if (typeof katex === 'object' && katex && typeof katex.renderToString === 'function') {
      try {
        return (
          (displayMode ? '<div class="' : '<span class="') +
          className +
          '">' +
          katex.renderToString(source, {
            displayMode: displayMode,
            output: 'mathml',
            strict: 'ignore',
            throwOnError: false,
            trust: false,
          }) +
          (displayMode ? '</div>' : '</span>')
        )
      } catch (_) {
        // Fall through to readable source instead of dropping the expression.
      }
    }
    return (
      (displayMode ? '<div class="' : '<code class="') +
      className +
      ' chat-math-fallback">' +
      escapeHtml(source) +
      (displayMode ? '</div>' : '</code>')
    )
  }
  function extractMathExpressions(content) {
    var protectedContent = protectRanges(
      String(content || ''),
      collectMarkdownAutolinkProtectedRanges(String(content || '')),
    )
    var expressions = []
    function store(latex, displayMode) {
      var index = expressions.length
      expressions.push({ latex: latex, displayMode: displayMode })
      var token =
        (displayMode ? MATH_BLOCK_TOKEN_PREFIX : MATH_INLINE_TOKEN_PREFIX) +
        index +
        MATH_TOKEN_SUFFIX
      return displayMode ? '\n\n' + token + '\n\n' : token
    }
    var markdown = protectedContent.text
      .replace(/\\\[([\s\S]*?)\\\]/g, function (_match, latex) {
        return store(latex, true)
      })
      .replace(/\$\$([\s\S]*?)\$\$/g, function (_match, latex) {
        return store(latex, true)
      })
      .replace(/\\\(([\s\S]*?)\\\)/g, function (_match, latex) {
        return store(latex, false)
      })
      .replace(/(^|[^\\$])\$([^$\n]+?)\$/g, function (match, prefix, latex) {
        var source = String(latex || '')
        if (!source || source.trim() !== source || /^\d+(?:[.,]\d+)?$/.test(source)) return match
        return prefix + store(source, false)
      })
    return {
      markdown: protectedContent.restore(markdown),
      restore: function (html) {
        var output = html
        for (var i = 0; i < expressions.length; i++) {
          var expression = expressions[i]
          var token =
            (expression.displayMode ? MATH_BLOCK_TOKEN_PREFIX : MATH_INLINE_TOKEN_PREFIX) +
            i +
            MATH_TOKEN_SUFFIX
          var rendered = renderMathExpression(expression.latex, expression.displayMode)
          if (expression.displayMode) {
            output = output.replace(new RegExp('<p>\\s*' + token + '\\s*</p>', 'g'), rendered)
          }
          output = output.replace(new RegExp(token, 'g'), rendered)
        }
        return output
      },
    }
  }
  function renderMarkdown(content) {
    try {
      var normalized = normalizeMalformedCodeFences(content)
      var math = extractMathExpressions(normalized)
      return math.restore(marked.parse(autolinkLocalFileReferencesInMarkdown(math.markdown)))
    } catch (_) {
      return '<p>' + escapeHtml(content) + '</p>'
    }
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
  function isLocalResourceHref(href) {
    if (!href) return false
    var trimmed = normalizeLocalResourceHref(href)
    if (!trimmed) return false
    if (/^(https?|mailto|tel|data|javascript|vbscript|blob|ftp):/i.test(trimmed)) return false
    if (
      trimmed.indexOf('/') === 0 ||
      trimmed.indexOf('./') === 0 ||
      trimmed.indexOf('../') === 0 ||
      trimmed.indexOf('.uploads/') === 0 ||
      trimmed.indexOf('~') === 0
    ) {
      return true
    }
    if (/^[A-Za-z]:[\\/]/.test(trimmed)) return true
    if (trimmed.indexOf('://') < 0) return true
    return false
  }
  function normalizeLocalResourceHref(href) {
    var trimmed = String(href || '').trim()
    trimmed = trimmed.replace(/^&lt;/i, '<').replace(/&gt;$/i, '>')
    if (trimmed.charAt(0) === '<' && trimmed.charAt(trimmed.length - 1) === '>') {
      trimmed = trimmed.slice(1, -1).trim()
    }
    if (/^file:\/\//i.test(trimmed)) {
      try {
        var url = new URL(trimmed)
        if (String(url.protocol).toLowerCase() === 'file:') {
          return decodeURIComponent(url.pathname || '').replace(/^\/([A-Za-z]:[\\/])/, '$1')
        }
      } catch (_) {
        return trimmed.replace(/^file:\/\//i, '')
      }
    }
    return trimmed
  }
  function stripQuery(path) {
    var hashIndex = path.indexOf('#')
    var queryIndex = path.indexOf('?')
    var cutAt = Math.min(
      hashIndex >= 0 ? hashIndex : path.length,
      queryIndex >= 0 ? queryIndex : path.length,
    )
    return path.slice(0, cutAt)
  }
  function parsePositiveInt(value) {
    if (!value) return undefined
    var parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
  function parseLocalResourceLocation(pathValue) {
    var rawPath = normalizeLocalResourceHref(pathValue).trim()
    var queryIndex = rawPath.indexOf('?')
    var withoutQueryOnly = queryIndex >= 0 ? rawPath.slice(0, queryIndex) : rawPath
    var withoutQuery = stripQuery(rawPath)
    var hashLineMatch = /^(.*)#L(\d+)(?:-L?(\d+))?$/i.exec(withoutQueryOnly)
    if (hashLineMatch) {
      var hashLine = parsePositiveInt(hashLineMatch[2])
      var endLine = parsePositiveInt(hashLineMatch[3])
      return {
        rawPath: rawPath,
        path: hashLineMatch[1] || withoutQuery,
        line: hashLine,
        endLine: endLine && hashLine && endLine > hashLine ? endLine : undefined,
      }
    }
    var colonRangeMatch = /^(.*):(\d+):(\d+)$/.exec(withoutQuery)
    if (colonRangeMatch) {
      var rangePath = colonRangeMatch[1] || withoutQuery
      var rangeBasename = rangePath.split(/[\\/]/).pop() || rangePath
      if (rangeBasename.indexOf('.') >= 0) {
        return {
          rawPath: rawPath,
          path: rangePath,
          line: parsePositiveInt(colonRangeMatch[2]),
          column: parsePositiveInt(colonRangeMatch[3]),
        }
      }
    }
    var colonLineRangeMatch = /^(.*):(\d+)-(\d+)$/.exec(withoutQuery)
    if (colonLineRangeMatch) {
      var lineRangePath = colonLineRangeMatch[1] || withoutQuery
      var lineRangeBasename = lineRangePath.split(/[\\/]/).pop() || lineRangePath
      if (lineRangeBasename.indexOf('.') >= 0) {
        var rangeStartLine = parsePositiveInt(colonLineRangeMatch[2])
        var rangeEndLine = parsePositiveInt(colonLineRangeMatch[3])
        return {
          rawPath: rawPath,
          path: lineRangePath,
          line: rangeStartLine,
          endLine:
            rangeEndLine && rangeStartLine && rangeEndLine > rangeStartLine
              ? rangeEndLine
              : undefined,
        }
      }
    }
    var colonLineMatch = /^(.*):(\d+)$/.exec(withoutQuery)
    if (colonLineMatch) {
      var linePath = colonLineMatch[1] || withoutQuery
      var lineBasename = linePath.split(/[\\/]/).pop() || linePath
      if (lineBasename.indexOf('.') >= 0) {
        return {
          rawPath: rawPath,
          path: linePath,
          line: parsePositiveInt(colonLineMatch[2]),
        }
      }
    }
    return { rawPath: rawPath, path: withoutQuery }
  }
  function getPathBasename(pathValue) {
    var cleaned = stripQuery(String(pathValue || '')).replace(/[\\/]+$/, '')
    var parts = cleaned.split(/[\\/]/)
    return parts[parts.length - 1] || cleaned
  }
  function getPathExt(pathValue) {
    var name = getPathBasename(pathValue)
    var index = name.lastIndexOf('.')
    return index >= 0 ? name.slice(index + 1).toLowerCase() : ''
  }
  function formatLocalResourceLineLabel(location) {
    if (!location || !location.line) return ''
    if (location.endLine && location.endLine > location.line)
      return 'lines ' + location.line + '-' + location.endLine
    if (location.column) return 'line ' + location.line + ':' + location.column
    return 'line ' + location.line
  }
  function localResourceLabelIncludesLocation(label) {
    return /(?:^|[\s(:#])(?:L?\d+|line(?:s)?\s+\d+)/i.test(String(label || ''))
  }
  function appendLocalResourceLineLabel(label, location) {
    var suffix = formatLocalResourceLineLabel(location)
    if (!suffix || localResourceLabelIncludesLocation(label)) return label
    return label + ' (' + suffix + ')'
  }
  function isExternalOpenHref(href) {
    if (!href) return false
    var trimmed = String(href).trim()
    if (!trimmed || isLocalResourceHref(trimmed)) return false
    return /^(https?:|mailto:|tel:)/i.test(trimmed)
  }
  function getOpenableExternalUrl(node, rawHref) {
    if (!isExternalOpenHref(rawHref)) return ''
    return node && node.href ? node.href : String(rawHref || '').trim()
  }
  window.ShennianChatMarkdown = {
    renderMarkdown: renderMarkdown,
    isLocalResourceHref: isLocalResourceHref,
    normalizeLocalResourceHref: normalizeLocalResourceHref,
    isExternalOpenHref: isExternalOpenHref,
    getOpenableExternalUrl: getOpenableExternalUrl,
  }
})()
