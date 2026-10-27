import { memo, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native'
import { marked } from 'marked'
import type { Colors } from '../../hooks/useTheme'
import { getMarkdownPreviewPalette } from './filePreviewTheme'
import {
  buildCodePreviewLines,
  getPreviewFileExt,
  getPreviewFileType,
  getPreviewLanguage,
} from './filePreviewLanguage'
import type { FilePreviewSelection, FileSelectionAiActionId } from './fileSelectionAi'
import { FileSelectionAiMenu } from './FileSelectionAiMenu.web'
import { CsvPreview } from './CsvPreview'
import {
  TOP_LEVEL_VIEWPORT_ORIGIN,
  mapSelectionRectToOverlay,
} from './filePreviewSelectionPosition'

function getMimeType(filename: string): string {
  const ext = getPreviewFileExt(filename)
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    bmp: 'image/bmp',
    pdf: 'application/pdf',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    flac: 'audio/flac',
    opus: 'audio/opus',
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    avi: 'video/x-msvideo',
  }
  return map[ext] || 'application/octet-stream'
}

function getDataUrl(filename: string, data: string | null): string | null {
  if (!data) return null
  if (data.startsWith('data:')) return data
  return `data:${getMimeType(filename)};base64,${data}`
}

export type FilePreviewProps = {
  filename: string
  content: string | null
  data: string | null
  loading: boolean
  error: string
  colors: Colors
  isDark: boolean
  onSelectionAiAction?: (actionId: FileSelectionAiActionId, selection: FilePreviewSelection) => void
  onSelectionQuoteAction?: (selection: FilePreviewSelection) => void
  onResourcePress?: (href: string) => void
  loadLocalImage?: (href: string) => Promise<string | null>
  targetLine?: number
  targetEndLine?: number
}

export const FilePreview = memo(function FilePreview({
  filename,
  content,
  data,
  loading,
  error,
  colors,
  isDark,
  onSelectionAiAction,
  onSelectionQuoteAction,
  onResourcePress,
  targetLine,
  targetEndLine,
}: FilePreviewProps) {
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    )
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
      </View>
    )
  }

  const fileType = getPreviewFileType(filename)

  switch (fileType) {
    case 'image':
      return <ImagePreview filename={filename} data={data} colors={colors} />
    case 'svg':
      return <SvgPreview content={content} colors={colors} isDark={isDark} />
    case 'html':
      return <HtmlPreview content={content} colors={colors} isDark={isDark} />
    case 'markdown':
      return (
        <MarkdownPreview
          content={content}
          colors={colors}
          isDark={isDark}
          onSelectionAiAction={onSelectionAiAction}
          onSelectionQuoteAction={onSelectionQuoteAction}
          onResourcePress={onResourcePress}
        />
      )
    case 'pdf':
      return <PdfPreview filename={filename} data={data} colors={colors} />
    case 'audio':
      return <MediaPreview filename={filename} data={data} colors={colors} kind="audio" />
    case 'video':
      return <MediaPreview filename={filename} data={data} colors={colors} kind="video" />
    case 'csv':
      return <CsvPreview content={content} colors={colors} isDark={isDark} />
    case 'code':
      return (
        <CodePreview
          filename={filename}
          content={content}
          colors={colors}
          isDark={isDark}
          onSelectionAiAction={onSelectionAiAction}
          onSelectionQuoteAction={onSelectionQuoteAction}
          targetLine={targetLine}
          targetEndLine={targetEndLine}
        />
      )
    default:
      if (content != null) {
        return (
          <CodePreview
            filename={filename}
            content={content}
            colors={colors}
            isDark={isDark}
            onSelectionAiAction={onSelectionAiAction}
            onSelectionQuoteAction={onSelectionQuoteAction}
            targetLine={targetLine}
            targetEndLine={targetEndLine}
          />
        )
      }
      return (
        <View style={styles.center}>
          <Text style={{ color: colors.textTertiary, fontSize: 13 }}>
            Cannot preview this file type
          </Text>
        </View>
      )
  }
})

function PdfPreview({
  filename,
  data,
  colors,
}: {
  filename: string
  data: string | null
  colors: Colors
}) {
  if (!data) {
    return (
      <View style={styles.center}>
        <Text style={{ color: colors.textTertiary, fontSize: 13 }}>
          Cannot preview this file type
        </Text>
      </View>
    )
  }
  const src = getDataUrl(filename, data)
  if (!src) return null
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', background: colors.bg }}>
      <iframe
        src={src}
        style={{ flex: 1, minHeight: 0, border: 'none', width: '100%', background: colors.bg }}
        title={filename}
      />
    </div>
  )
}

function MediaPreview({
  filename,
  data,
  colors,
  kind,
}: {
  filename: string
  data: string | null
  colors: Colors
  kind: 'audio' | 'video'
}) {
  const src = getDataUrl(filename, data)
  if (!src) {
    return (
      <View style={styles.center}>
        <Text style={{ color: colors.textTertiary, fontSize: 13 }}>
          Cannot preview this file type
        </Text>
      </View>
    )
  }

  const mediaStyle = {
    width: kind === 'audio' ? 'min(520px, 100%)' : 'min(920px, 100%)',
    maxHeight: '100%',
    borderRadius: 12,
    outline: 'none',
    background: '#000',
  } as const

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        background: colors.bg,
      }}
    >
      {kind === 'audio' ? (
        <audio src={src} controls preload="metadata" style={mediaStyle} />
      ) : (
        <video src={src} controls preload="metadata" style={mediaStyle} />
      )}
    </div>
  )
}

function ImagePreview({
  filename,
  data,
  colors,
}: {
  filename: string
  data: string | null
  colors: Colors
}) {
  if (!data) return null
  const src = getDataUrl(filename, data)
  if (!src) return null
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        overflow: 'auto',
        background: colors.bg,
      }}
    >
      <img
        src={src}
        alt={filename}
        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 4 }}
      />
    </div>
  )
}

function SvgPreview({
  content,
  colors,
  isDark,
}: {
  content: string | null
  colors: Colors
  isDark: boolean
}) {
  const [showSource, setShowSource] = useState(false)
  if (!content) return null

  if (showSource) {
    return (
      <CodePreview
        filename="image.svg"
        content={content}
        colors={colors}
        isDark={isDark}
        toggleLabel="Preview"
        onToggle={() => setShowSource(false)}
      />
    )
  }

  const srcDoc = `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
html,body{height:100%;margin:0;background:${colors.bg};}
body{display:grid;place-items:center;padding:16px;box-sizing:border-box;}
svg{max-width:100%;max-height:100%;height:auto;}
</style>
</head>
<body>${content}</body>
</html>`

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: colors.bg,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 8px' }}>
        <button
          onClick={() => setShowSource(true)}
          style={{
            fontSize: 11,
            color: colors.brand,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '2px 8px',
          }}
        >
          Source
        </button>
      </div>
      <iframe
        srcDoc={srcDoc}
        sandbox=""
        style={{ flex: 1, minHeight: 0, border: 'none', width: '100%', background: colors.bg }}
        title="SVG Preview"
      />
    </div>
  )
}

function HtmlPreview({
  content,
  colors,
  isDark,
}: {
  content: string | null
  colors: Colors
  isDark: boolean
}) {
  const [showSource, setShowSource] = useState(false)
  if (!content) return null

  if (showSource) {
    return (
      <CodePreview
        filename="preview.html"
        content={content}
        colors={colors}
        isDark={isDark}
        toggleLabel="Preview"
        onToggle={() => setShowSource(false)}
      />
    )
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 8px',
          borderBottom: `1px solid ${colors.border}`,
          background: colors.surface,
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: colors.textTertiary,
            fontWeight: 600,
            textTransform: 'uppercase',
          }}
        >
          HTML Preview
        </span>
        <button
          onClick={() => setShowSource(true)}
          style={{
            fontSize: 11,
            color: colors.brand,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '2px 6px',
          }}
        >
          Source
        </button>
      </div>
      <iframe
        srcDoc={content}
        sandbox="allow-scripts"
        style={{ flex: 1, minHeight: 0, border: 'none', width: '100%', background: '#fff' }}
        title="HTML Preview"
      />
    </div>
  )
}

function renderMd(src: string): Promise<string> {
  const renderer = new marked.Renderer()
  renderer.code = function (token: { text?: string; lang?: string } | string) {
    let code: string
    let lang: string
    if (typeof token === 'object' && token !== null) {
      code = token.text || ''
      lang = token.lang || ''
    } else {
      code = (token as string) || ''
      lang = ''
    }
    const escaped = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
    const langLabel = lang ? `<span class="cbl">${lang}</span>` : '<span></span>'
    return (
      '<div class="cbw"><div class="cbh">' +
      langLabel +
      `<button class="cbc" onclick="navigator.clipboard?.writeText(this.dataset.code);this.textContent='✓';setTimeout(()=>this.textContent='Copy',2000)" data-code="${escaped}">Copy</button>` +
      '</div><pre><code>' +
      escaped +
      '</code></pre></div>'
    )
  }
  return marked(src, { renderer, gfm: true, breaks: true }) as Promise<string>
}

function getResourceLinkScript() {
  return `<script>(function(){
    document.addEventListener('click', function(event){
      var link = event.target && event.target.closest ? event.target.closest('a[href]') : null
      if (!link) return
      var href = link.getAttribute('href') || ''
      if (!href || href.charAt(0) === '#' || /^(?:https?:|mailto:|tel:|javascript:|data:|blob:)/i.test(href)) return
      event.preventDefault()
      window.parent.postMessage({ type: 'shennian-file-resource-press', href: href }, '*')
    })
  })()</script>`
}

function getSelectionScript() {
  return `
    <script>
    ;(function(){
      function postSelection(){
        var selection = window.getSelection && window.getSelection();
        var text = selection ? String(selection.toString() || '').trim() : '';
        if (!text) {
          parent.postMessage({ type: 'shennian-file-selection-clear' }, '*');
          return;
        }
        var range;
        try { range = selection.rangeCount ? selection.getRangeAt(0) : null; } catch (_) { range = null; }
        if (!range) return;
        var rect = range.getBoundingClientRect();
        parent.postMessage({
          type: 'shennian-file-selection',
          text: text.slice(0, 8000),
          rect: {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height
          }
        }, '*');
      }
      document.addEventListener('mouseup', function(){ setTimeout(postSelection, 0); });
      document.addEventListener('keyup', function(){ setTimeout(postSelection, 0); });
      document.addEventListener('touchend', function(){ setTimeout(postSelection, 80); });
      document.addEventListener('selectionchange', function(){ setTimeout(postSelection, 0); });
    })();
    </script>
  `
}

export function getMarkdownPreviewCss(colors: Colors, isDark: boolean) {
  const { blockSurface, blockBorder, inlineCodeSurface, mutedText } = getMarkdownPreviewPalette(
    colors,
    isDark,
  )

  return `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      padding: 16px; margin: 0;
      color: ${colors.text}; background: ${colors.bg};
      font-size: 14px; line-height: 22px;
      -webkit-font-smoothing: antialiased;
      overflow-x: hidden;
    }
    h1 { font-size: 20px; font-weight: 700; margin: 12px 0 8px; line-height: 1.3; }
    h2 { font-size: 18px; font-weight: 600; margin: 10px 0 6px; line-height: 1.3; }
    h3 { font-size: 16px; font-weight: 600; margin: 8px 0 4px; line-height: 1.3; }
    h4, h5, h6 { font-size: 14px; font-weight: 600; margin: 8px 0 4px; line-height: 1.3; }
    p { margin: 4px 0; }
    strong { font-weight: 700; }
    code:not(pre code) {
      background: ${inlineCodeSurface};
      border: none; border-radius: 5px; padding: 2px 6px;
      font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
      font-size: 0.88em;
      color: ${colors.text};
      -webkit-box-decoration-break: clone; box-decoration-break: clone;
    }
    pre {
      margin: 8px 0; border-radius: 8px; overflow: hidden;
      border: 1px solid ${blockBorder}; background: ${blockSurface};
    }
    pre code {
      display: block; padding: 12px; overflow-x: auto;
      font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
      font-size: 12px; line-height: 18px; color: ${colors.text};
      background: none; border: none; border-radius: 0; padding: 12px;
    }
    blockquote {
      color: ${mutedText};
      background: ${blockSurface};
      border-left: 3px solid ${blockBorder};
      padding: 10px 12px; margin: 8px 0;
    }
    blockquote p { color: ${mutedText}; }
    blockquote code:not(pre code) {
      background: ${isDark ? '#303033' : '#e8e8eb'};
      color: ${colors.text};
    }
    ul, ol { padding-left: 20px; margin: 4px 0; }
    li { margin: 3px 0; }
    a { color: ${colors.brand}; text-decoration: none; }
    a:hover { text-decoration: underline; }
    hr { border: none; border-top: 1px solid ${colors.border}; margin: 10px 0; }
    table { border-collapse: collapse; margin: 8px 0; font-size: 13px; width: 100%; }
    th, td { border: 1px solid ${blockBorder}; padding: 6px 10px; text-align: left; }
    th { background: ${blockSurface}; color: ${colors.text}; font-weight: 600; }
    img { max-width: 100%; border-radius: 8px; }
    .cbw { position: relative; margin: 8px 0; border-radius: 8px; overflow: hidden; border: 1px solid ${blockBorder}; background: ${blockSurface}; }
    .cbh { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: ${isDark ? '#1f1f1f' : colors.surface}; border-bottom: 1px solid ${blockBorder}; font-size: 10px; }
    .cbl { font-weight: 600; color: ${colors.textTertiary}; text-transform: uppercase; font-family: 'SF Mono', Menlo, Consolas, monospace; }
    .cbc { padding: 2px 8px; border: none; border-radius: 4px; background: ${colors.surfaceHover}; color: ${colors.textSecondary}; font-size: 10px; font-weight: 600; cursor: pointer; }
    .cbc:active { opacity: 0.7; }
    .cbw pre { margin: 0; border: none; border-radius: 0; background: transparent; }
    .cbw pre code { display: block; padding: 12px; overflow-x: auto; font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 12px; line-height: 18px; color: ${colors.text}; white-space: pre-wrap; word-break: break-all; }
  `
}

function MarkdownPreview({
  content,
  colors,
  isDark,
  onSelectionAiAction,
  onSelectionQuoteAction,
  onResourcePress,
}: {
  content: string | null
  colors: Colors
  isDark: boolean
  onSelectionAiAction?: (actionId: FileSelectionAiActionId, selection: FilePreviewSelection) => void
  onSelectionQuoteAction?: (selection: FilePreviewSelection) => void
  onResourcePress?: (href: string) => void
}) {
  const [html, setHtml] = useState<string | null>(null)
  const [selection, setSelection] = useState<FilePreviewSelection | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const clearSelectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!content) return
    let cancelled = false
    void (async () => {
      try {
        const result = await renderMd(content)
        if (!cancelled) setHtml(result)
      } catch {
        if (!cancelled) setHtml(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [content])

  useEffect(() => {
    if (!onSelectionAiAction && !onSelectionQuoteAction && !onResourcePress) return
    const cancelPendingSelectionClear = () => {
      if (!clearSelectionTimerRef.current) return
      clearTimeout(clearSelectionTimerRef.current)
      clearSelectionTimerRef.current = null
    }
    const handler = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const data = event.data as {
        type?: string
        text?: string
        rect?: FilePreviewSelection['rect']
      }
      if (data?.type === 'shennian-file-selection-clear') {
        cancelPendingSelectionClear()
        clearSelectionTimerRef.current = setTimeout(() => {
          setSelection(null)
          clearSelectionTimerRef.current = null
        }, 120)
        return
      }
      if (data?.type === 'shennian-file-resource-press') {
        const href = (data as { href?: string }).href
        if (href) onResourcePress?.(href)
        return
      }
      if (data?.type !== 'shennian-file-selection' || !data.text?.trim() || !data.rect) return
      cancelPendingSelectionClear()
      const iframeRect = iframeRef.current?.getBoundingClientRect()
      const containerRect = containerRef.current?.getBoundingClientRect()
      if (!iframeRect || !containerRect) return
      setSelection({
        text: data.text.trim(),
        rect: mapSelectionRectToOverlay(data.rect, iframeRect, containerRect),
      })
    }
    window.addEventListener('message', handler)
    return () => {
      window.removeEventListener('message', handler)
      cancelPendingSelectionClear()
    }
  }, [onResourcePress, onSelectionAiAction, onSelectionQuoteAction])

  if (!content) return null

  if (html == null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="small" color={colors.brand} />
      </View>
    )
  }

  const mdStyles = getMarkdownPreviewCss(colors, isDark)

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: colors.bg,
        position: 'relative',
      }}
    >
      {selection && (onSelectionAiAction || onSelectionQuoteAction) ? (
        <FileSelectionAiMenu
          selection={selection}
          colors={colors}
          onDismiss={() => setSelection(null)}
          onQuote={
            onSelectionQuoteAction
              ? () => {
                  onSelectionQuoteAction(selection)
                  setSelection(null)
                }
              : undefined
          }
          onAction={(actionId) => {
            onSelectionAiAction?.(actionId, selection)
            setSelection(null)
          }}
        />
      ) : null}
      <iframe
        ref={iframeRef}
        srcDoc={`<!DOCTYPE html><html><head><style>${mdStyles}</style></head><body>${html}${onResourcePress ? getResourceLinkScript() : ''}${onSelectionAiAction || onSelectionQuoteAction ? getSelectionScript() : ''}</body></html>`}
        style={{ flex: 1, minHeight: 0, border: 'none', width: '100%' }}
        title="Markdown Preview"
      />
    </div>
  )
}

const HLJS_DARK_CSS = `
.hljs{background:#0d1117;color:#e6edf3}.hljs-doctag,.hljs-keyword,.hljs-meta .hljs-keyword,.hljs-template-tag,.hljs-template-variable,.hljs-type,.hljs-variable.language_{color:#ff7b72}.hljs-title,.hljs-title.class_,.hljs-title.class_.inherited__,.hljs-title.function_{color:#d2a8ff}.hljs-attr,.hljs-attribute,.hljs-literal,.hljs-meta,.hljs-number,.hljs-operator,.hljs-selector-attr,.hljs-selector-class,.hljs-selector-id,.hljs-variable{color:#79c0ff}.hljs-meta .hljs-string,.hljs-regexp,.hljs-string{color:#a5d6ff}.hljs-built_in,.hljs-symbol{color:#ffa657}.hljs-code,.hljs-comment,.hljs-formula{color:#8b949e}.hljs-name,.hljs-quote,.hljs-selector-pseudo,.hljs-selector-tag{color:#7ee787}.hljs-subst{color:#e6edf3}.hljs-section{color:#1f6feb;font-weight:700}.hljs-bullet{color:#f2cc60}.hljs-emphasis{color:#e6edf3;font-style:italic}.hljs-strong{color:#e6edf3;font-weight:700}.hljs-addition{color:#aff5b4;background-color:#033a16}.hljs-deletion{color:#ffdcd7;background-color:#67060c}
`

const HLJS_LIGHT_CSS = `
.hljs{background:#fff;color:#24292e}.hljs-doctag,.hljs-keyword,.hljs-meta .hljs-keyword,.hljs-template-tag,.hljs-template-variable,.hljs-type,.hljs-variable.language_{color:#d73a49}.hljs-title,.hljs-title.class_,.hljs-title.class_.inherited__,.hljs-title.function_{color:#6f42c1}.hljs-attr,.hljs-attribute,.hljs-literal,.hljs-meta,.hljs-number,.hljs-operator,.hljs-selector-attr,.hljs-selector-class,.hljs-selector-id,.hljs-variable{color:#005cc5}.hljs-meta .hljs-string,.hljs-regexp,.hljs-string{color:#032f62}.hljs-built_in,.hljs-symbol{color:#e36209}.hljs-code,.hljs-comment,.hljs-formula{color:#6a737d}.hljs-name,.hljs-quote,.hljs-selector-pseudo,.hljs-selector-tag{color:#22863a}.hljs-subst{color:#24292e}.hljs-section{color:#005cc5;font-weight:700}.hljs-bullet{color:#735c0f}.hljs-emphasis{color:#24292e;font-style:italic}.hljs-strong{color:#24292e;font-weight:700}.hljs-addition{color:#22863a;background-color:#f0fff4}.hljs-deletion{color:#b31d28;background-color:#ffeef0}
`


function CodePreview({
  filename,
  content,
  colors,
  isDark,
  toggleLabel,
  onToggle,
  onSelectionAiAction,
  onSelectionQuoteAction,
  targetLine,
  targetEndLine,
}: {
  filename: string
  content: string | null
  colors: Colors
  isDark: boolean
  toggleLabel?: string
  onToggle?: () => void
  onSelectionAiAction?: (actionId: FileSelectionAiActionId, selection: FilePreviewSelection) => void
  onSelectionQuoteAction?: (selection: FilePreviewSelection) => void
  targetLine?: number
  targetEndLine?: number
}) {
  const [copied, setCopied] = useState(false)
  const [selection, setSelection] = useState<FilePreviewSelection | null>(null)
  const lang = getPreviewLanguage(filename)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const targetStart = targetLine && targetLine > 0 ? targetLine : undefined
  const targetEnd =
    targetEndLine && targetStart && targetEndLine > targetStart ? targetEndLine : targetStart

  useEffect(() => {
    if (!targetStart || !content) return
    const timeout = window.setTimeout(() => {
      const root = scrollRef.current
      const target = root?.querySelector(`[data-line="${targetStart}"]`) as HTMLElement | null
      if (root && target) {
        root.scrollTo({ top: Math.max(0, target.offsetTop - 48), behavior: 'smooth' })
      }
    }, 80)
    return () => window.clearTimeout(timeout)
  }, [content, targetStart])

  const handleCopy = useCallback(() => {
    if (!content) return
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [content])

  const handleMouseUp = useCallback(() => {
    if (!onSelectionAiAction && !onSelectionQuoteAction) return
    const selectedText = window.getSelection?.()?.toString().trim() ?? ''
    if (!selectedText) {
      setSelection(null)
      return
    }
    const range = window.getSelection?.()?.rangeCount ? window.getSelection()?.getRangeAt(0) : null
    const rect = range?.getBoundingClientRect()
    if (!rect) return
    const containerRect = containerRef.current?.getBoundingClientRect()
    if (!containerRect) return
    const startElement =
      range?.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range?.startContainer.parentElement
    const endElement =
      range?.endContainer.nodeType === Node.ELEMENT_NODE
        ? (range.endContainer as Element)
        : range?.endContainer.parentElement
    const startLine = Number(startElement?.closest<HTMLElement>('[data-line]')?.dataset.line)
    const endLine = Number(endElement?.closest<HTMLElement>('[data-line]')?.dataset.line)
    const line = Number.isFinite(startLine) && startLine > 0 ? startLine : targetStart
    const selectionEndLine =
      Number.isFinite(endLine) && endLine > 0 && line
        ? Math.max(line, endLine)
        : targetEnd && line && targetEnd > line
          ? targetEnd
          : undefined
    setSelection({
      text: selectedText.slice(0, 8000),
      ...(line ? { line } : {}),
      ...(selectionEndLine && line && selectionEndLine > line ? { endLine: selectionEndLine } : {}),
      rect: mapSelectionRectToOverlay(
        { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
        TOP_LEVEL_VIEWPORT_ORIGIN,
        containerRect,
      ),
    })
  }, [onSelectionAiAction, onSelectionQuoteAction, targetEnd, targetStart])

  const codeHtml = useMemo(() => {
    if (!content) return ''
    const lines = buildCodePreviewLines(content, lang)
    const fileExt = getPreviewFileExt(filename)
    const themeCss = isDark ? HLJS_DARK_CSS : HLJS_LIGHT_CSS
    const bgColor = isDark ? '#0d1117' : '#fff'
    const lineNumberColor = isDark ? '#6e7681' : '#8c959f'
    const lineBorderColor = isDark ? '#30363d' : '#d0d7de'
    const highlightColor = isDark ? '#1f2937' : '#fff8c5'
    return `<style>${themeCss}html,body{margin:0;min-height:100%;background:${bgColor}}.code-table{display:grid;grid-template-columns:max-content 1fr;min-width:max-content;padding:12px 0;background:${bgColor};font-family:'SF Mono','Menlo','Consolas',monospace;font-size:12px;line-height:18px;box-sizing:border-box}.line-number{padding:0 12px;color:${lineNumberColor};text-align:right;user-select:none;border-right:1px solid ${lineBorderColor};font-variant-numeric:tabular-nums}.line-code{padding:0 12px;white-space:pre}.line-hit{background:${highlightColor}}.hljs{background:transparent}</style><div class="code-table">${lines
      .map((line) => {
        const highlighted =
          !!targetStart && !!targetEnd && line.number >= targetStart && line.number <= targetEnd
        const cls = highlighted ? ' line-hit' : ''
        return `<span class="line-number${cls}" data-line="${line.number}">${line.number}</span><code class="line-code hljs language-${fileExt}${cls}" data-line="${line.number}">${line.html}</code>`
      })
      .join('')}</div>`
  }, [content, filename, isDark, lang, targetEnd, targetStart])

  if (!content) return null

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: colors.bg,
        position: 'relative',
      }}
    >
      {selection && (onSelectionAiAction || onSelectionQuoteAction) ? (
        <FileSelectionAiMenu
          selection={selection}
          colors={colors}
          onDismiss={() => setSelection(null)}
          onQuote={
            onSelectionQuoteAction
              ? () => {
                  onSelectionQuoteAction(selection)
                  setSelection(null)
                }
              : undefined
          }
          onAction={(actionId) => {
            onSelectionAiAction?.(actionId, selection)
            setSelection(null)
          }}
        />
      ) : null}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 8px',
          borderBottom: `1px solid ${colors.border}`,
          background: colors.surface,
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: colors.textTertiary,
            fontWeight: 600,
            textTransform: 'uppercase',
          }}
        >
          {lang}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          {onToggle && (
            <button
              onClick={onToggle}
              style={{
                fontSize: 11,
                color: colors.brand,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '2px 6px',
              }}
            >
              {toggleLabel}
            </button>
          )}
          <button
            onClick={handleCopy}
            style={{
              fontSize: 11,
              color: colors.textSecondary,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '2px 6px',
            }}
          >
            {copied ? '✓' : 'Copy'}
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        style={{ flex: 1, minHeight: 0, overflow: 'auto', background: isDark ? '#0d1117' : '#fff' }}
        onMouseUp={handleMouseUp}
        onKeyUp={handleMouseUp}
      >
        <div dangerouslySetInnerHTML={{ __html: codeHtml }} />
      </div>
    </div>
  )
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  errorText: {
    fontSize: 13,
    textAlign: 'center',
  },
})
