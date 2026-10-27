import { normalizeDisplayText } from '../../../components/headEllipsis'
// @arch docs/features/network-rooms/ui.md#三昵称和头像
// @test src/__tests__/room-presentation.test.ts

import { avatarBorderRadius } from '../../../components/avatarShape'
import { Image, StyleSheet, Text, View } from 'react-native'
import { getApiBaseUrl } from '../../../config/api'
import { resolveProfileAvatarUrl, stableAvatarColor } from '../../profile/profileAvatar'
import type { PublicAvatar } from '../types'

type Props = {
  name: string
  avatar?: PublicAvatar | { smallUrl: string; mediumUrl: string } | null
  agent?: boolean
  ownerAvatar?: PublicAvatar | { smallUrl: string; mediumUrl: string } | null
  ownerName?: string | null
  variant?: 'identity' | 'group-tile'
  size?: number
  offline?: boolean
}

export function RoomIdentityAvatar({
  name,
  avatar,
  agent = false,
  ownerAvatar,
  ownerName,
  size = 38,
  variant = 'identity',
  offline = false,
}: Props) {
  const source = typeof avatar?.smallUrl === 'string' && avatar.smallUrl
    ? resolveProfileAvatarUrl(
        avatar.smallUrl,
        getApiBaseUrl(),
        'version' in avatar && typeof avatar.version === 'string' ? avatar.version : undefined,
      )
    : null
  const ownerSource = typeof ownerAvatar?.smallUrl === 'string' && ownerAvatar.smallUrl
    ? resolveProfileAvatarUrl(
        ownerAvatar.smallUrl,
        getApiBaseUrl(),
        'version' in ownerAvatar && typeof ownerAvatar.version === 'string' ? ownerAvatar.version : undefined,
      )
    : null
  const sharedSource = agent ? (source ?? ownerSource) : source
  const sharedName = normalizeDisplayText(agent && !source ? ownerName || name : name)
  const sharedInitial = (sharedName.trim().slice(0, 1) || '?').toUpperCase()
  return (
    <View style={{ width: size, height: size }}>
      <View style={offline ? styles.offlineIdentity : undefined}>
        {sharedSource ? (
          <Image
            source={{ uri: sharedSource }}
            style={{ width: size, height: size, borderRadius: avatarBorderRadius(size, variant) }}
          />
        ) : (
          <View
            style={[
              styles.placeholder,
              {
                width: size,
                height: size,
                borderRadius: avatarBorderRadius(size, variant),
                backgroundColor: stableAvatarColor(sharedName),
              },
            ]}
          >
            <Text style={[styles.initial, { fontSize: Math.max(11, Math.round(size * 0.38)) }]}>
              {sharedInitial}
            </Text>
          </View>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  initial: { color: '#fff', fontWeight: '700' },
  offlineIdentity: { opacity: 0.5, filter: [{ grayscale: 1 }] },
})
