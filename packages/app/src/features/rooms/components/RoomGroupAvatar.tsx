// @arch docs/features/network-rooms/ui.md#六群聊列表
// @test src/__tests__/room-group-avatar.test.ts

import { StyleSheet, View } from 'react-native'
import { avatarBorderRadius } from '../../../components/avatarShape'
import { useTheme } from '../../../hooks/useTheme'
import type { RoomMemberView } from '../types'
import { getRoomAvatarMetrics, getRoomAvatarRows } from '../roomAvatar'
import { RoomIdentityAvatar } from './RoomIdentityAvatar'

type Props = {
  members: RoomMemberView[]
  compact?: boolean
}

export function RoomGroupAvatar({ members, compact = false }: Props) {
  const { colors } = useTheme()
  const size = compact ? 34 : 44
  const rows = getRoomAvatarRows(members)
  const { grouped, padding, gap, tileSize } = getRoomAvatarMetrics(
    size, rows.reduce((count, row) => count + row.length, 0),
  )

  const radius = grouped ? Math.round(size * 0.08) : avatarBorderRadius(size)

  return (
    <View testID="room-group-avatar" style={[styles.group, {
      width: size, height: size, padding,
      borderRadius: radius,
      backgroundColor: grouped ? colors.avatarGroupBg : undefined,
    }]}>
      <View testID="room-group-avatar-mask" style={[styles.group, {
        width: size - padding * 2,
        height: size - padding * 2,
        // One inset contour rounds only tiles that meet the outer corners.
        borderRadius: Math.max(0, radius - padding),
        gap,
      }]}>
        {rows.length === 0 ? <RoomIdentityAvatar name="?" size={size} /> : rows.map((row, index) => (
          <View key={index} style={[styles.row, { gap }]}>
            {row.map((member) => (
              <RoomIdentityAvatar
                key={member.id}
                name={member.displayAlias}
                avatar={member.avatar}
                agent={member.principalType === 'agent'}
                size={tileSize}
                variant={grouped ? 'group-tile' : 'identity'}
              />
            ))}
          </View>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  group: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  row: { flexDirection: 'row', justifyContent: 'center' },
})
