// @arch docs/features/manager-agent.md
// @test src/__tests__/session-mode-ui.test.ts

import { StyleSheet, View } from 'react-native'
import type { SessionMode } from '@shennian/wire'
import { SessionModeSelector } from './SessionModeSelector'

export function AdvancedSessionSettings(props: {
  value: SessionMode
  managerAvailable: boolean
  disabled?: boolean
  onChange: (mode: SessionMode) => void
}) {
  if (!props.managerAvailable) return null

  return (
    <View style={styles.section}>
      <SessionModeSelector
        value={props.value}
        managerAvailable={props.managerAvailable}
        disabled={props.disabled}
        embedded
        onChange={props.onChange}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  section: { marginTop: 16, gap: 12 },
})
