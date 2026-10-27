import { View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { styles } from '../styles'

export function SkeletonBlock({
  width,
  height = 12,
  color,
}: {
  width: number
  height?: number
  color: string
}) {
  return (
    <View
      style={{
        width,
        height,
        borderRadius: height / 2,
        backgroundColor: color,
      }}
    />
  )
}

export function DevicesRowSkeleton({ iconColor, blockColor }: { iconColor: string; blockColor: string }) {
  return (
    <View style={styles.row}>
      <View style={{ opacity: 0.4 }}>
        <Ionicons name="phone-portrait-outline" size={18} color={iconColor} />
      </View>
      <View style={{ flex: 1, gap: 8, paddingVertical: 2 }}>
        <SkeletonBlock width={140} height={14} color={blockColor} />
        <SkeletonBlock width={96} height={10} color={blockColor} />
      </View>
      <SkeletonBlock width={20} height={20} color={blockColor} />
    </View>
  )
}

export function MachinesRowSkeleton({ iconColor, blockColor }: { iconColor: string; blockColor: string }) {
  return (
    <View style={styles.row}>
      <View style={{ opacity: 0.4 }}>
        <Ionicons name="desktop-outline" size={18} color={iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <SkeletonBlock width={100} height={14} color={blockColor} />
      </View>
      <SkeletonBlock width={52} height={22} color={blockColor} />
      <SkeletonBlock width={56} height={14} color={blockColor} />
      <SkeletonBlock width={16} height={16} color={blockColor} />
    </View>
  )
}
