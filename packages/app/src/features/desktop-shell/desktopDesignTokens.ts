// @arch docs/design/desktop/macos-interaction-baseline.md
// @test src/__tests__/desktop-personal-chat-presentation.test.ts
// @test src/__tests__/chat-font-size.test.ts

// Match the HTML conversation renderer, including its CJK system-font fallback.
export const desktopFontFamily = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

/** Desktop-only visual constants. Mobile retains its independent touch-first scale. */
export const desktopTypography = {
  pageTitle: { fontFamily: desktopFontFamily, fontSize: 20, lineHeight: 27, fontWeight: '500' as const },
  dialogTitle: { fontFamily: desktopFontFamily, fontSize: 15, lineHeight: 21, fontWeight: '600' as const },
  windowTitle: { fontFamily: desktopFontFamily, fontSize: 14, lineHeight: 20, fontWeight: '500' as const },
  roomTitle: { fontFamily: desktopFontFamily, fontSize: 15, lineHeight: 21, fontWeight: '600' as const },
  sidebarRoomTitle: { fontFamily: desktopFontFamily, fontSize: 15, lineHeight: 21, fontWeight: '500' as const },
  sidebarSection: { fontFamily: desktopFontFamily, fontSize: 14, lineHeight: 20, fontWeight: '500' as const },
  sidebarItem: { fontFamily: desktopFontFamily, fontSize: 14, lineHeight: 20, fontWeight: '400' as const },
  sidebarPreview: { fontFamily: desktopFontFamily, fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  sectionTitle: { fontFamily: desktopFontFamily, fontSize: 13, lineHeight: 18, fontWeight: '600' as const },
  body: { fontFamily: desktopFontFamily, fontSize: 14, lineHeight: 21, fontWeight: '400' as const },
  chatBody: { fontFamily: desktopFontFamily, fontSize: 14, lineHeight: 21, fontWeight: '400' as const },
  control: { fontFamily: desktopFontFamily, fontSize: 13, lineHeight: 18, fontWeight: '500' as const },
  metadata: { fontFamily: desktopFontFamily, fontSize: 12, lineHeight: 17, fontWeight: '400' as const },
  caption: { fontFamily: desktopFontFamily, fontSize: 11, lineHeight: 16, fontWeight: '400' as const },
  code: { fontSize: 13, lineHeight: 19, fontWeight: '400' as const },
} as const

export const desktopSpacing = {
  unit: 4,
  pageGutter: 24,
  compactPageGutter: 16,
  sectionGap: 20,
  rowHorizontal: 16,
  controlGap: 8,
} as const

export const desktopControlMetrics = {
  headerHeight: 44,
  compactControlHeight: 32,
  standardControlHeight: 36,
  iconButtonSize: 36,
  iconGlyphSize: 18,
  compactIconGlyphSize: 16,
  disclosureIconSize: 14,
  rowMinHeight: 52,
  popoverWidth: 340,
  dialogWidth: 480,
  radiusSmall: 6,
  radiusControl: 8,
  radiusContainer: 10,
} as const

export const desktopComposerMetrics = {
  input: { fontFamily: desktopFontFamily, fontSize: 14, lineHeight: 20, fontWeight: '400' as const },
  inputMinHeight: 24,
  inputMaxHeight: 104,
  minHeight: 74,
  toolbarHeight: 44,
  radius: 10,
} as const
