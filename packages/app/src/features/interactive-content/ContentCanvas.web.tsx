// @arch docs/architecture/interactive-web-content.md
import { createElement, forwardRef, useImperativeHandle } from 'react'
import type { ContentSaveMetadata, ContentCanvasHandle } from './contentRuntimeTypes'
import { buildIsolatedDocument } from './isolatedDocument'
import type { ContentDocument } from './contentSession'
export const ContentCanvas = forwardRef<ContentCanvasHandle, { document: ContentDocument; active?: boolean; safeArea?: { top: number; bottom: number }; onIntent?(text: string): void; onSave?(html: string, metadata?: ContentSaveMetadata): void; onPaint?(): void }>(function ContentCanvas({ document, safeArea }, ref) {
  useImperativeHandle(ref, () => ({ observe: async () => { throw new Error('native_runtime_required') }, invoke: async () => { throw new Error('native_runtime_required') } }), [])
  return createElement('iframe', { title: document.title, sandbox: 'allow-scripts',
    referrerPolicy: 'no-referrer', srcDoc: buildIsolatedDocument(document.html, document.resourceOrigins, false, safeArea),
    style: { width: '100%', height: '100%', border: 0 } })
})
