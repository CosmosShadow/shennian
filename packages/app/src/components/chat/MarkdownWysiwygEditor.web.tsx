// @arch docs/architecture/app/chat-attachments-preview.md
// @test packages/app/src/__tests__/markdown-wysiwyg-editor.test.ts

import { useEffect, useRef, useState } from 'react'
import Vditor from 'vditor'
import 'vditor/dist/index.css'
import type { Colors } from '../../hooks/useTheme'

export type MarkdownWysiwygEditorProps = {
  value: string
  colors: Colors
  isDark: boolean
  onChange: (value: string) => void
}

export function getMarkdownWysiwygThemeCss(colors: Colors, isDark: boolean) {
  return `
    .shennian-vditor-wrap {
      width: 100%;
      height: 100%;
      min-height: 0;
      background: ${colors.bg};
      color: ${colors.text};
    }
    .shennian-vditor-wrap .vditor {
      --border-color: transparent !important;
      --toolbar-background-color: transparent !important;
      border: none !important;
      border-radius: 0 !important;
      height: 100% !important;
      background: ${colors.bg} !important;
    }
    .shennian-vditor-wrap .vditor-toolbar,
    .shennian-vditor-wrap .vditor-panel,
    .shennian-vditor-wrap .vditor-ir__toolbar {
      display: none !important;
    }
    .shennian-vditor-wrap .vditor-reset {
      padding: 18px 22px !important;
      background: ${colors.bg} !important;
      color: ${colors.text} !important;
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
      font-size: 14px !important;
      line-height: 1.65 !important;
    }
    .shennian-vditor-wrap .vditor-reset:focus {
      outline: none !important;
      background: ${colors.bg} !important;
    }
    .shennian-vditor-wrap .vditor-wysiwyg [data-marker]::before {
      content: none !important;
    }
    .shennian-vditor-wrap .vditor-reset h1,
    .shennian-vditor-wrap .vditor-reset h2,
    .shennian-vditor-wrap .vditor-reset h3,
    .shennian-vditor-wrap .vditor-reset h4,
    .shennian-vditor-wrap .vditor-reset h5,
    .shennian-vditor-wrap .vditor-reset h6 {
      color: ${colors.text} !important;
    }
    .shennian-vditor-wrap .vditor-reset a {
      color: ${colors.brand} !important;
    }
    .shennian-vditor-wrap .vditor-reset code:not(pre code) {
      background: ${isDark ? '#242426' : '#f1f1f3'} !important;
      color: ${colors.text} !important;
    }
    .shennian-vditor-wrap .vditor-reset pre,
    .shennian-vditor-wrap .vditor-reset blockquote {
      background: ${colors.surface} !important;
      border-color: ${colors.border} !important;
    }
  `
}

export type MarkdownEditorLike = {
  getValue: () => string
  setValue: (markdown: string, clearStack?: boolean) => void
}

export const MARKDOWN_WYSIWYG_CDN = '/vditor'

export function syncMarkdownWysiwygValue(editor: MarkdownEditorLike, value: string) {
  if (value !== editor.getValue()) {
    editor.setValue(value, true)
  }
}

export function MarkdownWysiwygEditor({
  value,
  colors,
  isDark,
  onChange,
}: MarkdownWysiwygEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const vditorRef = useRef<Vditor | null>(null)
  const latestOnChangeRef = useRef(onChange)
  const latestValueRef = useRef(value)
  const [ready, setReady] = useState(false)

  latestOnChangeRef.current = onChange
  latestValueRef.current = value

  useEffect(() => {
    if (!editorRef.current || vditorRef.current) return

    const vditor = new Vditor(editorRef.current, {
      cdn: MARKDOWN_WYSIWYG_CDN,
      height: '100%',
      mode: 'wysiwyg',
      cache: { enable: false },
      value,
      toolbar: [],
      customWysiwygToolbar: () => undefined,
      input: (nextValue) => {
        latestOnChangeRef.current(nextValue)
      },
      after: () => {
        syncMarkdownWysiwygValue(vditor, latestValueRef.current)
        setReady(true)
      },
    })

    vditorRef.current = vditor

    return () => {
      try {
        vditor.destroy()
      } catch {
        // Vditor can throw if the DOM is already gone during React teardown.
      }
      vditorRef.current = null
    }
    // Vditor owns its DOM after mount; external value sync is handled below.
  }, [])

  useEffect(() => {
    if (!ready || !vditorRef.current) return
    syncMarkdownWysiwygValue(vditorRef.current, value)
  }, [ready, value])

  return (
    <div className="shennian-vditor-wrap">
      <style>{getMarkdownWysiwygThemeCss(colors, isDark)}</style>
      <div ref={editorRef} style={{ width: '100%', height: '100%', minHeight: 0 }} />
    </div>
  )
}
