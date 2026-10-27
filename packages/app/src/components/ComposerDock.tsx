// @arch docs/architecture/mobile-navigation.md
// @test src/__tests__/floating-composer-regressions.test.ts
import type { ReactNode } from 'react'
import { View } from 'react-native'
/** Input spacing is independent of navigation: the same floating pill works without Tabs. */
export function ComposerDock({
  children,
  bottomInset = 8,
}: {
  children: ReactNode
  bottomInset?: number
}) {
  return (
    <View
      testID="composer-dock"
      style={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: bottomInset || 8 }}
    >
      {children}
    </View>
  )
}
