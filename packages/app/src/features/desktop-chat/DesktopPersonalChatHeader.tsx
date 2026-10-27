// @arch docs/design/desktop/unified-desktop-control.md
// @test packages/app/src/__tests__/desktop-personal-chat-presentation.test.ts

import { StyleSheet, Text, View } from 'react-native'
import type { useDesktopContextMenu } from '../desktop-shell/DesktopContextMenu'
import type { Colors } from '../../hooks/useTheme'
import {
  desktopControlMetrics,
  desktopSpacing,
  desktopTypography,
} from '../desktop-shell/desktopDesignTokens'

export function DesktopPersonalChatHeader({
  title,
  hasTitle,
  colors,
  contextMenuBindings,
}: {
  title: string
  hasTitle: boolean
  colors: Colors
  contextMenuBindings: ReturnType<typeof useDesktopContextMenu>['bindings']
}) {

  return (
    <View
      style={[styles.header, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}
      testID="desktop-personal-chat-header"
      {...{ dataSet: { desktopDrag: 'true' } }}
    >
      <View style={styles.identity} {...contextMenuBindings} {...{ tabIndex: 0, dataSet: { desktopDrag: 'false' } }}>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: hasTitle ? colors.text : colors.textSecondary }]}
          numberOfLines={1}
        >
          {title}
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    height: desktopControlMetrics.headerHeight,
    paddingHorizontal: desktopSpacing.compactPageGutter,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  identity: {
    flexShrink: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  title: { ...desktopTypography.windowTitle, fontWeight: '400' },
})
