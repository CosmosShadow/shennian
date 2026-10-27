// @arch docs/architecture/machine-sharing.md
// @test ../../__tests__/machine-sharing-source.test.ts

import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { createShareInviteQrMatrix } from '../../components/sheets/shareInviteQr'
import { useTheme } from '../../hooks/useTheme'

export function MachineInviteQr({ value }: { value: string }) {
  const { colors } = useTheme()
  const matrix = useMemo(() => {
    try { return createShareInviteQrMatrix(value) } catch { return null }
  }, [value])
  if (!matrix) return <Text style={{ color: colors.textTertiary }}>QR unavailable</Text>
  const cell = 176 / matrix.size
  return (
    <View accessibilityLabel="machine invite QR code" style={styles.frame}>
      <View style={styles.matrix}>
        {matrix.data.map((dark, index) => dark ? (
          <View key={index} style={[styles.cell, {
            left: (index % matrix.size) * cell,
            top: Math.floor(index / matrix.size) * cell,
            width: cell, height: cell,
          }]} />
        ) : null)}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  frame: { alignSelf: 'center', backgroundColor: '#fff', padding: 12, borderRadius: 16 },
  matrix: { width: 176, height: 176, position: 'relative', backgroundColor: '#fff' },
  cell: { position: 'absolute', backgroundColor: '#000' },
})
