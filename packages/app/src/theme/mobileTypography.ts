// @arch docs/design/foundations.md#移动端存量界面第一轮收敛
// @test src/__tests__/mobile-typography.test.ts
import type { TextStyle } from 'react-native'

// Default reading size in logical units. Text keeps RN's system font/scaling;
// these roles must not override the user's separate chat reading preference.
export const mobileTypography = {
  navigationTitle: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 17, lineHeight: 22, fontWeight: '400' },
  sectionTitle: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  listTitle: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  secondary: { fontSize: 15, lineHeight: 20, fontWeight: '400' },
  compactAction: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  metadata: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
} as const satisfies Record<string, TextStyle>
