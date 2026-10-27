// @covers src/features/session-list/components/MobileHomeSessionItem.tsx
// @covers src/hooks/useTheme.ts
// @arch docs/design/components.md#6-列表行与选择控件
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8')

function luminance(hex: string): number {
  const rgb = hex.match(/[a-f\d]{2}/gi)!.map((v) => {
    const c = parseInt(v, 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
}

describe('mobile session scan hierarchy', () => {
  it('restores the row right-swipe recognizer only while its delete action is open', () => {
    const row = read('features/session-list/components/MobileHomeSessionItem.tsx')

    expect(row).toContain('const [swipeOpen, setSwipeOpen] = useState(false)')
    expect(row).toContain('dragOffsetFromLeftEdge={getSessionSwipeableLeftDragOffset(swipeOpen)}')
    expect(row).toMatch(/onSwipeableWillOpen=\{\(\) => \{\s*setSwipeOpen\(true\)/)
    expect(row).toMatch(/onSwipeableClose=\{\(\) => \{\s*setSwipeOpen\(false\)/)
  })

  it('highlights running titles and previews without the activity icon, preserving draft/unread signals', () => {
    const row = read('features/session-list/components/MobileHomeSessionItem.tsx')
    const title = row.slice(row.indexOf('styles.sessionTitle,'), row.indexOf("{session.title || t('new_conversation')}", row.indexOf('styles.sessionTitle,')))
    const preview = row.slice(row.indexOf('styles.previewText,'), row.indexOf('numberOfLines={1}', row.indexOf('styles.previewText,')))
    expect(title).toContain('color: isRunning ? colors.brand : colors.text')
    expect(preview).toContain('color: isRunning && !summary.isDraft ? colors.brandMuted : mutedColor')
    expect(row).not.toContain('name="activity"')
    expect(row).toContain('accessibilityState={{ busy: summary.showPulse || summary.isSending }}')
    expect(row).toContain("text: summary.showPulse ? t('working') : summary.isSending ? t('msg_sending') : ''")
    expect(row).toContain('<UnreadCountBadge count={unreadCount}')
    expect(row).toContain("[{t('draft_label')}]")
    expect(row).toContain('height: StyleSheet.hairlineWidth')
  })

  it('keeps muted readable text above 4.5:1 on normal, pinned and pressed surfaces in both themes', () => {
    const theme = read('hooks/useTheme.ts')
    for (const name of ['light', 'dark']) {
      const palette = theme.match(new RegExp(`export const ${name}Colors = \\{([\\s\\S]*?)\\n\\}`))![1]
      const color = (key: string) => palette.match(new RegExp(`${key}: '(#[a-fA-F0-9]+)'`))![1]
      for (const [fg, bg] of [
        [color('textMuted'), color('bg')],
        [color('textMuted'), color('surfaceHover')],
        [color('textMutedOnSurface'), name === 'light' ? '#f0f0f0' : color('surfaceHover')],
        [color('textMutedOnSurface'), color('surfaceHover')],
      ]) {
        const a = luminance(fg), b = luminance(bg)
        expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5)
      }

      for (const bg of [
        color('bg'),
        color('surfaceHover'),
        name === 'light' ? '#f0f0f0' : color('surfaceHover'),
        name === 'light' ? '#e3e3e3' : color('surfaceHover'),
      ]) {
        const a = luminance(color('brandMuted')), b = luminance(bg)
        expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})
