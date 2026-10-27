import { PanResponder } from 'react-native'
import { shouldCloseImageSwipe } from '../../features/chat/utils/imageCloseSwipe'
// @arch docs/architecture/app/chat-attachments-preview.md
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Platform,
  Pressable,
  Image,
  ActivityIndicator,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native'
import { ContainedPreviewImage } from './ContainedPreviewImage'
import { SvgImagePreview } from './SvgImagePreview'
import Markdown from 'react-native-markdown-display'
import { WebView } from 'react-native-webview'
import { useTranslation } from 'react-i18next'
import type { Colors } from '../../hooks/useTheme'
import { getMarkdownPreviewPalette } from './filePreviewTheme'
import {
  buildCodePreviewLines,
  getPreviewFileExt,
  getPreviewFileType,
  getPreviewLanguage,
} from './filePreviewLanguage'
import type { FilePreviewSelection, FileSelectionAiActionId } from './fileSelectionAi'

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
  onImageBackdropPress?: () => void
  targetLine?: number
  targetEndLine?: number
}

const monoFamily = Platform.OS === 'ios' ? 'Menlo' : 'monospace'

type HighlightSegment = {
  text: string
  token?: string
}

function getMimeType(filename: string): string {
  const ext = getPreviewFileExt(filename)
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
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
  if (/^(?:data:|file:|content:|blob:)/i.test(data)) return data
  return `data:${getMimeType(filename)};base64,${data}`
}

function MarkdownLocalImage({
  src,
  alt,
  load,
  colors,
}: {
  src: string
  alt: string
  load: (href: string) => Promise<string | null>
  colors: Colors
}) {
  const [uri, setUri] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const { t } = useTranslation()
  const { width } = useWindowDimensions()

  useEffect(() => {
    let cancelled = false
    setUri(null)
    setFailed(false)
    void load(src).then((result) => {
      if (cancelled) return
      setUri(result)
      setFailed(!result)
    }).catch(() => {
      if (!cancelled) setFailed(true)
    })
    return () => { cancelled = true }
  }, [load, src])

  if (failed) {
    return <Text style={{ color: colors.textTertiary }}>{alt || src} · {t('project_file_preview_error')}</Text>
  }
  if (!uri) return <ActivityIndicator color={colors.brand} style={{ marginVertical: 12 }} />
  if (/\.svg(?:[?#]|$)/i.test(src)) {
    return (
      <View style={{ width: Math.max(1, width - 32), height: 260, marginVertical: 8 }}>
        <SvgImagePreview uri={uri} label={alt || src} />
      </View>
    )
  }
  return (
    <Image
      source={{ uri }}
      accessibilityLabel={alt || undefined}
      resizeMode="contain"
      style={{ width: Math.max(1, width - 32), height: Math.min(360, Math.max(180, width * 0.65)), marginVertical: 8 }}
      onError={() => setFailed(true)}
    />
  )
}

function safeWebViewNavigation(url: string): boolean {
  return (
    !url ||
    url === 'about:blank' ||
    url.startsWith('data:text/html') ||
    url.startsWith('data:application/pdf')
  )
}

function decodeHtmlEntity(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

function parseHighlightSegments(html: string): HighlightSegment[] {
  const segments: HighlightSegment[] = []
  const stack: string[] = []
  const pattern = /<span class="([^"]+)">|<\/span>/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(html))) {
    if (match.index > lastIndex) {
      segments.push({
        text: decodeHtmlEntity(html.slice(lastIndex, match.index)),
        token: stack[stack.length - 1],
      })
    }
    if (match[1]) {
      stack.push(match[1].split(/\s+/).find((item) => item.startsWith('hljs-')) ?? '')
    } else {
      stack.pop()
    }
    lastIndex = pattern.lastIndex
  }

  if (lastIndex < html.length) {
    segments.push({
      text: decodeHtmlEntity(html.slice(lastIndex)),
      token: stack[stack.length - 1],
    })
  }

  return segments.filter((segment) => segment.text.length > 0)
}

function getTokenColor(token: string | undefined, isDark: boolean, fallback: string): string {
  if (!token) return fallback
  const dark: Record<string, string> = {
    'hljs-keyword': '#ff7b72',
    'hljs-type': '#ff7b72',
    'hljs-title': '#d2a8ff',
    'hljs-attr': '#79c0ff',
    'hljs-attribute': '#79c0ff',
    'hljs-literal': '#79c0ff',
    'hljs-number': '#79c0ff',
    'hljs-string': '#a5d6ff',
    'hljs-built_in': '#ffa657',
    'hljs-symbol': '#ffa657',
    'hljs-comment': '#8b949e',
    'hljs-name': '#7ee787',
    'hljs-selector-tag': '#7ee787',
  }
  const light: Record<string, string> = {
    'hljs-keyword': '#d73a49',
    'hljs-type': '#d73a49',
    'hljs-title': '#6f42c1',
    'hljs-attr': '#005cc5',
    'hljs-attribute': '#005cc5',
    'hljs-literal': '#005cc5',
    'hljs-number': '#005cc5',
    'hljs-string': '#032f62',
    'hljs-built_in': '#e36209',
    'hljs-symbol': '#e36209',
    'hljs-comment': '#6a737d',
    'hljs-name': '#22863a',
    'hljs-selector-tag': '#22863a',
  }
  return (isDark ? dark : light)[token] ?? fallback
}

function CodePreview({
  filename,
  content,
  colors,
  isDark,
  targetLine,
  targetEndLine,
}: {
  filename: string
  content: string | null
  colors: Colors
  isDark: boolean
  targetLine?: number
  targetEndLine?: number
}) {
  const language = getPreviewLanguage(filename)
  const bgColor = isDark ? '#0d1117' : '#fff'
  const lineNumberColor = isDark ? '#6e7681' : '#8c959f'
  const lineBorderColor = isDark ? '#30363d' : '#d0d7de'
  const codeColor = isDark ? '#e6edf3' : '#24292e'
  const scrollRef = useRef<ScrollView>(null)
  const targetStart = targetLine && targetLine > 0 ? targetLine : undefined
  const targetEnd =
    targetEndLine && targetStart && targetEndLine > targetStart ? targetEndLine : targetStart

  useEffect(() => {
    if (!targetStart || !content) return
    const timeout = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, (targetStart - 1) * 18 - 36), animated: true })
    }, 80)
    return () => clearTimeout(timeout)
  }, [content, targetStart])

  if (!content) return null

  const lines = buildCodePreviewLines(content, language)

  return (
    <View style={[styles.webShell, { backgroundColor: colors.bg }]}>
      <View
        style={[
          styles.previewToolbar,
          { borderBottomColor: colors.border, backgroundColor: colors.surface },
        ]}
      >
        <Text style={[styles.previewToolbarText, { color: colors.textTertiary }]}>{language}</Text>
      </View>
      <ScrollView
        ref={scrollRef}
        style={[styles.codeScroll, { backgroundColor: bgColor }]}
        contentContainerStyle={styles.codeScrollContent}
      >
        <ScrollView horizontal style={styles.codeHorizontalScroll}>
          <View style={styles.codeTable}>
            {lines.map((line) => {
              const highlighted =
                !!targetStart &&
                !!targetEnd &&
                line.number >= targetStart &&
                line.number <= targetEnd
              return (
                <View
                  key={line.number}
                  style={[
                    styles.codeLine,
                    highlighted && { backgroundColor: isDark ? '#1f2937' : '#fff8c5' },
                  ]}
                >
                  <Text
                    style={[
                      styles.lineNumber,
                      { color: lineNumberColor, borderRightColor: lineBorderColor },
                    ]}
                  >
                    {line.number}
                  </Text>
                  <Text style={[styles.codeLineText, { color: codeColor }]} selectable>
                    {(line.text ? parseHighlightSegments(line.html) : [{ text: ' ' }]).map(
                      (segment, index) => (
                        <Text
                          key={index}
                          style={{ color: getTokenColor(segment.token, isDark, codeColor) }}
                        >
                          {segment.text}
                        </Text>
                      ),
                    )}
                  </Text>
                </View>
              )
            })}
          </View>
        </ScrollView>
      </ScrollView>
    </View>
  )
}

function HtmlPreview({ content, colors }: { content: string | null; colors: Colors }) {
  const [showSource, setShowSource] = useState(false)
  if (!content) return null

  if (showSource) {
    return (
      <View style={[styles.webShell, { backgroundColor: colors.bg }]}>
        <PreviewModeToggle
          activeLabel="Source"
          nextLabel="Preview"
          colors={colors}
          onToggle={() => setShowSource(false)}
        />
        <ScrollView
          style={[styles.scroll, { backgroundColor: colors.bg }]}
          contentContainerStyle={styles.scrollContent}
          horizontal={false}
        >
          <Text style={[styles.codeText, { color: colors.text }]} selectable>
            {content}
          </Text>
        </ScrollView>
      </View>
    )
  }

  return (
    <View style={[styles.webShell, { backgroundColor: colors.bg }]}>
      <PreviewModeToggle
        activeLabel="HTML Preview"
        nextLabel="Source"
        colors={colors}
        onToggle={() => setShowSource(true)}
      />
      <WebView
        originWhitelist={['about:blank', 'data:text/html']}
        source={{ html: content, baseUrl: 'about:blank' }}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled={false}
        thirdPartyCookiesEnabled={false}
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows={false}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        onShouldStartLoadWithRequest={(request) => safeWebViewNavigation(request.url)}
        style={[styles.webView, { backgroundColor: '#fff' }]}
      />
    </View>
  )
}

function SvgPreview({ content, colors }: { content: string | null; colors: Colors }) {
  const [showSource, setShowSource] = useState(false)
  if (!content) return null

  if (showSource) {
    return (
      <View style={[styles.webShell, { backgroundColor: colors.bg }]}>
        <PreviewModeToggle
          activeLabel="Source"
          nextLabel="Preview"
          colors={colors}
          onToggle={() => setShowSource(false)}
        />
        <ScrollView
          style={[styles.scroll, { backgroundColor: colors.bg }]}
          contentContainerStyle={styles.scrollContent}
          horizontal={false}
        >
          <Text style={[styles.codeText, { color: colors.text }]} selectable>
            {content}
          </Text>
        </ScrollView>
      </View>
    )
  }

  return (
    <View style={[styles.webShell, { backgroundColor: colors.bg }]}>
      <PreviewModeToggle
        activeLabel="SVG Preview"
        nextLabel="Source"
        colors={colors}
        onToggle={() => setShowSource(true)}
      />
      <SvgImagePreview
        uri={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`}
        label="SVG"
      />
    </View>
  )
}

function PreviewModeToggle({
  activeLabel,
  nextLabel,
  colors,
  onToggle,
}: {
  activeLabel: string
  nextLabel: string
  colors: Colors
  onToggle: () => void
}) {
  return (
    <View
      style={[
        styles.previewToolbar,
        { borderBottomColor: colors.border, backgroundColor: colors.surface },
      ]}
    >
      <Text style={[styles.previewToolbarText, { color: colors.textTertiary }]}>{activeLabel}</Text>
      <Pressable onPress={onToggle} hitSlop={8} style={styles.previewToolbarButton}>
        <Text style={[styles.previewToolbarButtonText, { color: colors.brand }]}>{nextLabel}</Text>
      </Pressable>
    </View>
  )
}

function PdfPreview({
  filename: _filename,
  data,
  colors,
}: {
  filename: string
  data: string | null
  colors: Colors
}) {
  if (!data) return null
  const uri = getDataUrl(_filename, data) ?? 'about:blank'
  const localFile = uri.startsWith('file://')
  return (
    <View style={[styles.webShell, { backgroundColor: colors.bg }]}>
      <WebView
        originWhitelist={localFile ? ['file://'] : ['about:blank', 'data:application/pdf']}
        source={{ uri }}
        allowingReadAccessToURL={localFile ? uri : undefined}
        javaScriptEnabled={false}
        domStorageEnabled={false}
        sharedCookiesEnabled={false}
        thirdPartyCookiesEnabled={false}
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows={false}
        allowFileAccess={localFile}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        onShouldStartLoadWithRequest={(request) => request.url === uri || request.url === 'about:blank'}
        style={[styles.webView, { backgroundColor: colors.bg }]}
      />
    </View>
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
  if (!src) return null
  const tag = kind === 'audio' ? 'audio' : 'video'
  const html = `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
html,body{height:100%;margin:0;background:${colors.bg};}
body{display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;}
audio{width:100%;max-width:520px;}
video{width:100%;max-height:100%;border-radius:12px;background:#000;}
</style>
</head>
<body><${tag} src="${src}" controls preload="metadata"></${tag}></body>
</html>`

  return (
    <View style={[styles.webShell, { backgroundColor: colors.bg }]}>
      <WebView
        originWhitelist={['about:blank', 'data:text/html']}
        source={{ html, baseUrl: 'about:blank' }}
        javaScriptEnabled
        domStorageEnabled={false}
        sharedCookiesEnabled={false}
        thirdPartyCookiesEnabled={false}
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows={false}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        onShouldStartLoadWithRequest={(request) => safeWebViewNavigation(request.url)}
        style={[styles.webView, { backgroundColor: colors.bg }]}
      />
    </View>
  )
}

function ZoomableImage({ uri, colors, onBackdropPress }: { uri: string; colors: Colors; onBackdropPress?: () => void }) {
  const [zoomed, setZoomed] = useState(false)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const closeSwipe = PanResponder.create({
    onMoveShouldSetPanResponderCapture: (event, gesture) =>
      !!onBackdropPress && !zoomed && event.nativeEvent.touches.length === 1 && shouldCloseImageSwipe(gesture, 1),
    onPanResponderRelease: (_, gesture) => {
      if (!zoomed && shouldCloseImageSwipe(gesture, 1)) onBackdropPress?.()
    },
  })

  const onContainerLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout
    if (containerSize.width === width && containerSize.height === height) return
    setContainerSize({ width, height })
    setZoomed(false)
  }, [containerSize])

  return (
    <View
      {...closeSwipe.panHandlers}
      style={[styles.zoomContainer, { backgroundColor: colors.bg }]}
      onLayout={onContainerLayout}
    >
      {containerSize.width > 0 && containerSize.height > 0 && (
        <ScrollView
          key={`${containerSize.width}:${containerSize.height}`}
          onScroll={({ nativeEvent }) => setZoomed((nativeEvent.zoomScale ?? 1) > 1.01)}
          scrollEventThrottle={16}
          style={styles.zoomScroll}
          // The image already centers its pixels with contain. Native centerContent
          // adds another, layout-dependent inset and can leave the canvas displaced.
          contentContainerStyle={containerSize}
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
          maximumZoomScale={5}
          minimumZoomScale={1}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          bouncesZoom
        >
          <ContainedPreviewImage
            uri={uri}
            width={containerSize.width}
            height={containerSize.height}
            zoomed={zoomed}
            onBackdropPress={onBackdropPress}
          />
        </ScrollView>
      )}
    </View>
  )
}

export function FilePreview({
  filename,
  content,
  data,
  loading,
  error,
  colors,
  isDark,
  targetLine,
  targetEndLine,
  onResourcePress,
  loadLocalImage,
  onImageBackdropPress,
}: FilePreviewProps) {
  if (loading) {
    return (
      <View style={styles.center}>
        <Text style={{ color: colors.textTertiary }}>Loading…</Text>
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

  if (fileType === 'html' && content != null) {
    return <HtmlPreview content={content} colors={colors} />
  }

  if (fileType === 'svg' && data) {
    return <SvgImagePreview uri={getDataUrl(filename, data) ?? data} label={filename} />
  }

  if (fileType === 'svg' && content != null) {
    return <SvgPreview content={content} colors={colors} />
  }

  if (fileType === 'image' && data) {
    return (
      <ZoomableImage
        key={data}
        onBackdropPress={onImageBackdropPress}
        uri={getDataUrl(filename, data) ?? data}
        colors={colors}
      />
    )
  }

  if (fileType === 'pdf' && data) {
    return <PdfPreview filename={filename} data={data} colors={colors} />
  }

  if (fileType === 'audio' && data) {
    return <MediaPreview filename={filename} data={data} colors={colors} kind="audio" />
  }

  if (fileType === 'video' && data) {
    return <MediaPreview filename={filename} data={data} colors={colors} kind="video" />
  }

  if (fileType === 'markdown' && content != null) {
    return (
      <ScrollView
        style={[styles.scroll, { backgroundColor: colors.bg }]}
        contentContainerStyle={styles.scrollContent}
        horizontal={false}
      >
        <Markdown
          style={getMarkdownPreviewStyles(colors, isDark)}
          rules={loadLocalImage ? {
            image: (node) => {
              const attributes = (node as unknown as { attributes?: { src?: string; alt?: string } }).attributes
              const src = String(attributes?.src || '')
              const alt = String(attributes?.alt || '')
              if (/^(?:https?:|data:)/i.test(src)) {
                return <Image key={node.key} source={{ uri: src }} resizeMode="contain" style={{ width: 300, height: 200 }} />
              }
              return <MarkdownLocalImage key={node.key} src={src} alt={alt} load={loadLocalImage} colors={colors} />
            },
          } : undefined}
          onLinkPress={(url) => {
            if (url.startsWith('#') || /^(?:https?:|mailto:|tel:)/i.test(url)) return true
            onResourcePress?.(url)
            return false
          }}
        >
          {content}
        </Markdown>
      </ScrollView>
    )
  }

  if (content != null) {
    return (
      <CodePreview
        filename={filename}
        content={content}
        colors={colors}
        isDark={isDark}
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

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  zoomContainer: {
    flex: 1,
    minHeight: 0,
  },
  zoomScroll: {
    flex: 1,
    minHeight: 0,
  },
  errorText: {
    fontSize: 13,
    textAlign: 'center',
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    padding: 12,
  },
  codeText: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: monoFamily,
  },
  webShell: {
    flex: 1,
    minHeight: 0,
  },
  webView: {
    flex: 1,
    minHeight: 0,
  },
  codeScroll: {
    flex: 1,
    minHeight: 0,
  },
  codeScrollContent: {
    flexGrow: 1,
  },
  codeHorizontalScroll: {
    flexGrow: 0,
  },
  codeTable: {
    paddingVertical: 12,
  },
  codeLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  lineNumber: {
    width: 48,
    paddingHorizontal: 10,
    textAlign: 'right',
    fontSize: 12,
    lineHeight: 18,
    fontFamily: monoFamily,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  codeLineText: {
    paddingHorizontal: 12,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: monoFamily,
  },
  previewToolbar: {
    minHeight: 34,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  previewToolbarText: {
    fontSize: 11,
    fontWeight: '600',
  },
  previewToolbarButton: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  previewToolbarButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
})

export function getMarkdownPreviewStyles(colors: Colors, isDark = colors.bg === '#0a0a0a') {
  const { blockSurface, blockBorder, inlineCodeSurface, mutedText } = getMarkdownPreviewPalette(
    colors,
    isDark,
  )

  return {
    body: {
      color: colors.text,
      fontSize: 14,
      lineHeight: 22,
    },
    heading1: {
      color: colors.text,
      fontSize: 22,
      fontWeight: '700' as const,
      marginVertical: 8,
    },
    heading2: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '600' as const,
      marginVertical: 6,
    },
    heading3: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600' as const,
      marginVertical: 4,
    },
    paragraph: {
      color: colors.text,
      marginVertical: 4,
    },
    text: {
      color: colors.text,
    },
    strong: {
      color: colors.text,
      fontWeight: '700' as const,
    },
    code_inline: {
      backgroundColor: inlineCodeSurface,
      color: colors.text,
      borderRadius: 4,
      paddingHorizontal: 4,
      fontFamily: monoFamily,
    },
    fence: {
      backgroundColor: blockSurface,
      color: colors.text,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: blockBorder,
      padding: 12,
      fontFamily: monoFamily,
      fontSize: 12,
      lineHeight: 18,
    },
    code_block: {
      backgroundColor: blockSurface,
      color: colors.text,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: blockBorder,
      padding: 12,
      fontFamily: monoFamily,
      fontSize: 12,
      lineHeight: 18,
    },
    blockquote: {
      backgroundColor: blockSurface,
      borderLeftColor: blockBorder,
      borderLeftWidth: 3,
      color: mutedText,
      paddingLeft: 12,
      paddingVertical: 8,
      paddingRight: 12,
      marginVertical: 8,
    },
    blockquote_text: {
      color: mutedText,
    },
    table: {
      borderColor: blockBorder,
    },
    th: {
      backgroundColor: blockSurface,
      color: colors.text,
    },
    tr: {
      borderColor: blockBorder,
    },
    td: {
      borderColor: blockBorder,
      color: colors.text,
    },
    link: {
      color: colors.brand,
    },
    bullet_list: {
      marginVertical: 4,
    },
    ordered_list: {
      marginVertical: 4,
    },
  }
}
