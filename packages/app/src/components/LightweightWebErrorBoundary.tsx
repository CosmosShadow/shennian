// @arch docs/features/network-rooms/mobile-control-and-single-room-web.md#p5删除完整-web-专用代码
// @test ../../../../scripts/__tests__/web-lite-route-root.test.mjs

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

type Props = { children: ReactNode }
type State = { failed: boolean }

export class LightweightWebErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[LightweightWebErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <View style={styles.root}>
        <Text accessibilityRole="header" style={styles.title}>页面暂时无法打开</Text>
        <Text style={styles.body}>请刷新页面后重试。</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (typeof window !== 'undefined') window.location.reload()
          }}
          style={styles.button}
        >
          <Text style={styles.buttonText}>刷新页面</Text>
        </Pressable>
      </View>
    )
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#fff' },
  title: { color: '#111', fontSize: 20, lineHeight: 28, fontWeight: '600' },
  body: { color: '#666', fontSize: 15, lineHeight: 22, marginTop: 8 },
  button: { minHeight: 44, justifyContent: 'center', borderRadius: 12, paddingHorizontal: 20, marginTop: 24, backgroundColor: '#4f46e5' },
  buttonText: { color: '#fff', fontSize: 15, lineHeight: 22, fontWeight: '600' },
})
