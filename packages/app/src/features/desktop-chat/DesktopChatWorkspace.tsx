// @arch docs/design/desktop/unified-desktop-control.md
// @test packages/app/src/__tests__/desktop-main-workspaces.test.ts

import { useState, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { resolveDesktopChatLayout } from './desktopChatLayout'

export function DesktopChatWorkspace({
  conversation,
  contextOpen,
  renderContext,
}: {
  conversation: ReactNode
  contextOpen: boolean
  renderContext: (narrow: boolean, workspaceWidth: number) => ReactNode
}) {
  const [workspaceWidth, setWorkspaceWidth] = useState(0)
  const layout = resolveDesktopChatLayout({ width: workspaceWidth, contextOpen })

  return (
    <View
      style={styles.root}
      testID="desktop-chat-workspace"
      onLayout={(event) => setWorkspaceWidth(Math.round(event.nativeEvent.layout.width))}
    >
      <View style={styles.body}>
        <View
          style={[styles.conversation, !layout.showConversation && styles.hidden]}
          accessibilityElementsHidden={!layout.showConversation}
          importantForAccessibility={layout.showConversation ? 'auto' : 'no-hide-descendants'}
        >
          {conversation}
        </View>
        {contextOpen ? (
          <View
            style={[
              layout.mode === 'wide' ? styles.contextWide : styles.contextNarrow,
              !layout.showContext && styles.hidden,
            ]}
            accessibilityElementsHidden={!layout.showContext}
            importantForAccessibility={layout.showContext ? 'auto' : 'no-hide-descendants'}
          >
            {renderContext(layout.mode === 'narrow', workspaceWidth)}
          </View>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  body: { flex: 1, minHeight: 0, flexDirection: 'row' },
  conversation: { flex: 1, minWidth: 0, minHeight: 0 },
  contextWide: { flexShrink: 0, minWidth: 0, minHeight: 0 },
  contextNarrow: { flex: 1, minWidth: 0, minHeight: 0 },
  hidden: { display: 'none' },
})
