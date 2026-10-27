// @covers packages/app/src/components/chat/FilePreview.native.tsx

import React from 'react'
import * as ReactHooks from 'react'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useState: vi.fn(actual.useState),
    useCallback: vi.fn(actual.useCallback),
  }
})

vi.mock('react-native', () => {
  const Component = (name: string) =>
    function MockComponent({ children, ...props }: { children?: React.ReactNode }) {
      return React.createElement(name, props, children)
    }

  return {
    View: Component('View'),
    Text: Component('Text'),
    ScrollView: Component('ScrollView'),
    Image: Component('Image'),
    Pressable: Component('Pressable'),
    Platform: { OS: 'ios' },
    StyleSheet: {
      create: <T>(styles: T) => styles,
      hairlineWidth: 1,
    },
    useWindowDimensions: () => ({ width: 320, height: 640 }),
    PanResponder: { create: () => ({ panHandlers: {} }) },
  }
})

vi.mock('react-native-markdown-display', () => ({
  default: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('Markdown', null, children),
}))

vi.mock('react-native-webview', () => ({
  WebView: (props: Record<string, unknown>) => React.createElement('WebView', props),
}))

const colors = {
  bg: '#ffffff',
  avatarGroupBg: '#E2E4E5',
  surface: '#f8f8f8',
  surfaceHover: '#f2f2f2',
  border: '#dddddd',
  text: '#111111',
  textSecondary: '#555555',
  textTertiary: '#777777',
  textMuted: '#707070',
  textMutedOnSurface: '#626262',
  brand: '#0066cc',
  brandDark: '#0055aa',
  brandLight: '#e6f0ff',
  navigationSelected: '#4776A1',
  ownMessage: 'rgba(59,130,246,0.08)',
  error: '#cc0000',
  errorText: '#b91c1c',
  success: '#008855',
  successText: '#15803d',
  warning: '#aa7700',
  warningText: '#92400e',
}

describe('native file preview', () => {
  afterEach(() => {
    vi.mocked(ReactHooks.useState).mockImplementation(React.useState)
    vi.mocked(ReactHooks.useCallback).mockImplementation(React.useCallback)
  })

  it('waits for the real viewport and recreates the zoom canvas when its dimensions change', async () => {
    // Run the production component with a small synchronous hook driver. Native
    // UIScrollView positioning itself is checked separately in the iOS smoke.
    const states: unknown[] = []
    let cursor = 0
    vi.mocked(ReactHooks.useState).mockImplementation(((initial: unknown) => {
      const slot = cursor++
      if (!(slot in states)) states[slot] = initial
      return [states[slot], (next: unknown) => {
        states[slot] = typeof next === 'function' ? next(states[slot]) : next
      }]
    }) as typeof ReactHooks.useState)
    vi.mocked(ReactHooks.useCallback).mockImplementation((callback) => callback)

    const { FilePreview } = await import('../components/chat/FilePreview.native')
    const image = FilePreview({
      filename: 'shot.png',
      data: 'file:///cache/shot.png',
      content: null,
      loading: false,
      error: '',
      colors,
      isDark: false,
    })
    type Canvas = React.ReactElement<{
      contentContainerStyle: { width: number; height: number }
      centerContent?: boolean
      contentInsetAdjustmentBehavior: string
      automaticallyAdjustContentInsets: boolean
      children: React.ReactElement<{ width: number; height: number; zoomed: boolean }>
      onScroll: (event: { nativeEvent: { zoomScale: number } }) => void
    }>
    type Shell = React.ReactElement<{
      onLayout: (event: { nativeEvent: { layout: { width: number; height: number } } }) => void
      children: Canvas | false
    }>
    const render = () => {
      cursor = 0
      return (image.type as (props: typeof image.props) => Shell)(image.props)
    }
    const layout = (width: number, height: number) =>
      render().props.onLayout({ nativeEvent: { layout: { width, height } } })
    expect(render().props.children).toBe(false)
    layout(390, 740)
    const first = render().props.children as Canvas
    expect(first.props.contentContainerStyle).toEqual({ width: 390, height: 740 })
    expect(first.props.children.props).toMatchObject({ width: 390, height: 740, zoomed: false })
    expect(first.props.centerContent).not.toBe(true)
    expect(first.props.contentInsetAdjustmentBehavior).toBe('never')
    expect(first.props.automaticallyAdjustContentInsets).toBe(false)
    first.props.onScroll({ nativeEvent: { zoomScale: 2 } })
    layout(390, 740)
    expect((render().props.children as Canvas).key).toBe(first.key)
    expect((render().props.children as Canvas).props.children.props.zoomed).toBe(true)
    layout(740, 390)
    const rotated = render().props.children as Canvas
    expect(rotated.key).not.toBe(first.key)
    expect(rotated.props.contentContainerStyle).toEqual({ width: 740, height: 390 })
    expect(rotated.props.children.props.zoomed).toBe(false)
    layout(0, 0)
    expect(render().props.children).toBe(false)
  })

  it('renders image previews without missing native-only imports', async () => {
    const { FilePreview } = await import('../components/chat/FilePreview.native')

    expect(() =>
      FilePreview({
        filename: 'shot.png',
        content: null,
        data: 'abc123',
        loading: false,
        error: '',
        colors,
        isDark: false,
      }),
    ).not.toThrow()
  })

  it('mounts a native WebView for PDF data previews', async () => {
    const { FilePreview } = await import('../components/chat/FilePreview.native')

    const element = FilePreview({
      filename: 'report.pdf',
      content: null,
      data: 'data:application/pdf;base64,JVBERi0x',
      loading: false,
      error: '',
      colors,
      isDark: false,
    }) as React.ReactElement

    const pdfElement = (element.type as (props: typeof element.props) => React.ReactElement)(
      element.props,
    )

    expect(JSON.stringify(pdfElement)).toContain('data:application/pdf;base64,JVBERi0x')
    expect(JSON.stringify(pdfElement)).toContain(
      '"originWhitelist":["about:blank","data:application/pdf"]',
    )
  })

  it('previews a cached PDF with read access limited to that file and blocks other navigation', async () => {
    const { FilePreview } = await import('../components/chat/FilePreview.native')
    const uri = 'file:///cache/chat-image-previews/report.pdf'
    const element = FilePreview({
      filename: 'report.pdf',
      content: null,
      data: uri,
      loading: false,
      error: '',
      colors,
      isDark: false,
    }) as React.ReactElement
    const pdf = (
      element.type as (props: typeof element.props) => React.ReactElement<{
        children: React.ReactElement<{
          source: { uri: string }
          allowingReadAccessToURL: string
          allowFileAccessFromFileURLs: boolean
          allowUniversalAccessFromFileURLs: boolean
          onShouldStartLoadWithRequest: (request: { url: string }) => boolean
        }>
      }>
    )(element.props)
    const webView = pdf.props.children
    expect(webView.props.source).toEqual({ uri })
    expect(webView.props.allowingReadAccessToURL).toBe(uri)
    expect(webView.props.allowFileAccessFromFileURLs).toBe(false)
    expect(webView.props.allowUniversalAccessFromFileURLs).toBe(false)
    expect(webView.props.onShouldStartLoadWithRequest({ url: uri })).toBe(true)
    expect(webView.props.onShouldStartLoadWithRequest({ url: 'file:///private/other.pdf' })).toBe(
      false,
    )
    expect(webView.props.onShouldStartLoadWithRequest({ url: 'https://example.com' })).toBe(false)
  })

  it('mounts native WebView media controls for audio data previews', async () => {
    const { FilePreview } = await import('../components/chat/FilePreview.native')

    const element = FilePreview({
      filename: 'hangup.mp3',
      content: null,
      data: 'data:audio/mpeg;base64,SUQz',
      loading: false,
      error: '',
      colors,
      isDark: false,
    }) as React.ReactElement

    const mediaElement = (element.type as (props: typeof element.props) => React.ReactElement)(
      element.props,
    )

    expect(JSON.stringify(mediaElement)).toContain('<audio')
    expect(JSON.stringify(mediaElement)).toContain('controls')
    expect(JSON.stringify(mediaElement)).toContain('"originWhitelist":["about:blank","data:text/html"]')
  })

  it('passes target line ranges into code preview and keeps native line-number UI', async () => {
    const { FilePreview } = await import('../components/chat/FilePreview.native')

    const element = FilePreview({
      filename: 'app.ts',
      content: ['const a = 1', 'const b = 2', 'const c = 3'].join('\n'),
      data: null,
      loading: false,
      error: '',
      colors,
      isDark: false,
      targetLine: 2,
      targetEndLine: 3,
    }) as React.ReactElement<{ targetLine?: number; targetEndLine?: number }>

    expect(element.props.targetLine).toBe(2)
    expect(element.props.targetEndLine).toBe(3)

    const source = readFileSync('packages/app/src/components/chat/FilePreview.native.tsx', 'utf8')
    expect(source).toContain('styles.lineNumber')
    expect(source).toContain('line.number')
    expect(source).toContain('scrollRef.current?.scrollTo')
    expect(source).toContain("'#fff8c5'")
  })

  it('keeps markdown rendered when a local link includes a source line', async () => {
    const { FilePreview } = await import('../components/chat/FilePreview.native')

    const element = FilePreview({
      filename: 'todo.md',
      content: '# TODO\n\n- Render this as Markdown',
      data: null,
      loading: false,
      error: '',
      colors,
      isDark: false,
      targetLine: 1,
    }) as React.ReactElement<{ children?: React.ReactNode }>

    const scrollView = (
      element.type as (props: typeof element.props) => React.ReactElement
    )(element.props) as React.ReactElement<{ children?: React.ReactNode }>
    const markdownElement = scrollView.props.children as React.ReactElement<{
      children?: React.ReactNode
    }>
    const renderedMarkdown = (
      markdownElement.type as (props: typeof markdownElement.props) => React.ReactElement
    )(markdownElement.props) as React.ReactElement<{ children?: React.ReactNode }>

    expect(scrollView.type).toBe('ScrollView')
    expect(renderedMarkdown.type).toBe('Markdown')
    expect(renderedMarkdown.props.children).toContain('# TODO')
  })
})
