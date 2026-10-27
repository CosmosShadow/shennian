// @arch docs/architecture/app/chat-attachments-preview.md

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('file preview regressions', () => {
  it('keeps the desktop file panel at an explicit non-zero width', () => {
    const source = readFileSync(
      'packages/app/src/features/desktop-chat/DesktopChatFileWorkspace.tsx',
      'utf8',
    )

    expect(source).toContain('width: panelWidth')
    expect(source).toContain('minWidth: panelWidth')
    expect(source).toContain('flexGrow: 0')
    expect(source).toContain('flexShrink: 0')
    expect(source).not.toContain('flex: 0')
  })

  it('uses a stable pointer drag instead of recreating PanResponder during resize', () => {
    const source = readFileSync(
      'packages/app/src/features/desktop-chat/DesktopChatFileWorkspace.tsx',
      'utf8',
    )

    expect(source).toContain('onPointerDown: startResize')
    expect(source).toContain('resize.move(event.clientX)')
    expect(source).toContain('resize.start(event.nativeEvent.clientX, panelWidth)')
    expect(source).not.toContain('PanResponder')
  })

  it('does not persist the default file panel width as a manual resize', () => {
    const source = readFileSync(
      'packages/app/src/features/desktop-chat/DesktopChatFileWorkspace.tsx',
      'utf8',
    )

    expect(source).toContain('resize.finish()')
    expect(source).toContain('desktopFilePanelState.displayedWidth(accountId, width)')
    expect(source).not.toMatch(/writeStoredFilePanelWidth|readStoredFilePanelWidthPreference|getWebFilePanelWidthStorage/)
  })

  it('imports the CSV preview through normal module resolution', () => {
    const source = readFileSync('packages/app/src/components/chat/FilePreview.web.tsx', 'utf8')

    expect(source).toContain("import { CsvPreview } from './CsvPreview'")
    expect(source).not.toContain("'./CsvPreview.web'")
  })

  it('does not replace rendered markdown with a line-numbered source view for line links', () => {
    const source = readFileSync('packages/app/src/components/chat/FilePreview.web.tsx', 'utf8')
    const markdownCase = source.slice(
      source.indexOf("case 'markdown':"),
      source.indexOf("case 'pdf':"),
    )

    expect(markdownCase).toContain('<MarkdownPreview')
    expect(markdownCase).not.toContain('<CodePreview')
    expect(markdownCase).not.toContain('if (targetLine)')
  })

  it('memoizes code preview highlighting so chat typing rerenders do not rebuild heavy HTML', () => {
    const source = readFileSync('packages/app/src/components/chat/FilePreview.web.tsx', 'utf8')

    expect(source).toContain('export const FilePreview = memo(function FilePreview')
    expect(source).toMatch(/const codeHtml = useMemo\(\(\) => \{[\s\S]*buildCodePreviewLines\(content, lang\)[\s\S]*\}, \[content, filename, isDark, lang, targetEnd, targetStart\]\)/)
  })
})
