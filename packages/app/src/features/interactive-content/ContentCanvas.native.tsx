// @arch docs/architecture/interactive-web-content.md
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import * as Crypto from 'expo-crypto'
import type { ContentSaveMetadata, ContentCanvasHandle, RuntimeObservation } from './contentRuntimeTypes'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { buildIsolatedDocument } from './isolatedDocument'
import type { ContentDocument } from './contentSession'

export const ContentCanvas = forwardRef<ContentCanvasHandle, { document: ContentDocument; active?: boolean; safeArea?: { top: number; bottom: number }; onIntent?(text: string): void; onSave?(html: string, metadata?: ContentSaveMetadata): void; onPaint?(): void }>(function ContentCanvas({ document, active = true, safeArea, onIntent, onSave, onPaint }, forwardedRef) {
  const web = useRef<WebView>(null)
  const selected = useRef(active); selected.current = active
  const pending = useRef<{ id: string; receive(value: { observation?: RuntimeObservation; ok?: boolean }): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> } | null>(null)
  useEffect(() => () => { if (pending.current) { clearTimeout(pending.current.timer); pending.current.reject(new Error('view_changed')); pending.current = null } }, [active])
  useImperativeHandle(forwardedRef, () => ({ observe: (part = 'state') => new Promise<RuntimeObservation>((resolve, reject) => {
    if (!selected.current) { reject(new Error('inactive_page')); return }
    if (pending.current) { clearTimeout(pending.current.timer); pending.current.reject(new Error('observation_replaced')) }
    const requestId = Crypto.randomUUID()
    const timer = setTimeout(() => { pending.current = null; reject(new Error('observation_timeout')) }, 2500)
    pending.current = { id: requestId, receive: (value) => value.observation ? resolve(value.observation) : reject(new Error('invalid_observation')), reject, timer }
    web.current?.injectJavaScript(`window.__shennianObserve?.(${JSON.stringify(requestId)},${JSON.stringify(part)});true;`)
  }), invoke: (name, args) => new Promise<void>((resolve, reject) => {
    if (!selected.current) { reject(new Error('inactive_page')); return }
    if (pending.current) { clearTimeout(pending.current.timer); pending.current.reject(new Error('operation_replaced')) }
    const requestId = Crypto.randomUUID()
    const timer = setTimeout(() => { pending.current = null; reject(new Error('page_method_timeout')) }, 2500)
    pending.current = { id: requestId, receive: (value) => value.ok ? resolve() : reject(new Error('page_method_failed')), reject, timer }
    web.current?.injectJavaScript(`window.__shennianInvoke?.(${JSON.stringify(requestId)},${JSON.stringify(name)},${JSON.stringify(args)});true;`)
  }) }), [])
  const bridged = Boolean(onIntent || onSave || forwardedRef)
  const html = useMemo(() => buildIsolatedDocument(document.html, document.resourceOrigins, bridged, safeArea), [document, bridged, safeArea?.top, safeArea?.bottom])
  const source = useMemo(() => ({ html }), [html])
  return <WebView ref={web} testID={active ? "interactive-content-canvas" : "interactive-content-preview"} source={source} originWhitelist={['about:*']}
    onLoadEnd={onPaint} onMessage={(event: WebViewMessageEvent) => {
      if (!selected.current) return
      try {
        const message = JSON.parse(event.nativeEvent.data) as { type?: unknown; text?: unknown; html?: unknown; metadata?: ContentSaveMetadata; requestId?: unknown; observation?: RuntimeObservation; ok?: boolean }
        if (['observation', 'invoked'].includes(String(message.type)) && pending.current && message.requestId === pending.current.id) {
          clearTimeout(pending.current.timer); pending.current.receive(message); pending.current = null; return
        }
        if (message.type === 'intent' && typeof message.text === 'string' && message.text.trim() && message.text.length <= 8000) onIntent?.(message.text)
        if (message.type === 'save' && typeof message.html === 'string' && message.html.length >= 40 && message.html.length <= 120000) onSave?.(message.html, message.metadata)
      } catch { /* Untrusted pages never receive a general native RPC channel. */ }
    }}
    javaScriptEnabled sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false}
    javaScriptCanOpenWindowsAutomatically={false} allowsInlineMediaPlayback
    allowsFullscreenVideo={false} setSupportMultipleWindows={false}
    allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
    onShouldStartLoadWithRequest={(request) => request.url === 'about:blank' || request.url === 'about:srcdoc'}
    style={{ flex: 1, backgroundColor: 'transparent' }} />
})
