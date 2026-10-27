// @arch docs/architecture/app/chat-attachments-preview.md
// @test packages/app/src/__tests__/file-drawer-actions.test.ts

import { View } from 'react-native'
import { styles } from './FileDrawer.styles'

export function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${pct}%` as unknown as number, backgroundColor: color }]} />
    </View>
  )
}
