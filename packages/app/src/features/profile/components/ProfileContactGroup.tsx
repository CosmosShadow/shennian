// @arch docs/features/contact-and-reviews.md
// @test src/__tests__/contact-room.test.ts

import { useRef, useState, type ReactNode } from 'react'
import { Alert, Linking, Platform, Pressable, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import Ionicons from '@expo/vector-icons/Ionicons'
import { roomInvitationClient } from '../../rooms/roomInvitationClient'
import { useTheme } from '../../../hooks/useTheme'
import { ContactDialog } from '../../contact/ContactOptions'
import { IOS_REVIEW_URL } from '../../contact/links'
import { joinCurrentOfficialRoom } from '../../contact/joinCurrentOfficialRoom'
import { styles } from '../styles'

export function ProfileContactGroup({ children }: { children?: ReactNode }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const [visible, setVisible] = useState(false)
  const [joining, setJoining] = useState(false)
  const busy = useRef(false)
  const [error, setError] = useState('')
  const join = async () => {
    if (busy.current) return
    busy.current = true
    setJoining(true)
    setError('')
    try {
      const result = await joinCurrentOfficialRoom(roomInvitationClient)
      if (result.outcome === 'pending_approval') {
        setError(t('room_invite_pending_body'))
        return
      }
      setVisible(false)
      if (result.outcome === 'joined') {
        router.navigate({ pathname: '/(main)/room-workspace', params: { roomId: result.roomId } })
      } else {
        router.navigate({
          pathname: '/spaces/[roomId]',
          params: { roomId: result.roomId, invite: result.inviteToken },
        } as never)
      }
    } catch (error) {
      setError(
        t(
          error instanceof Error && error.message === 'contact_not_configured'
            ? 'contact_not_configured'
            : 'contact_join_failed',
        ),
      )
    } finally {
      busy.current = false
      setJoining(false)
    }
  }
  const review = async () => {
    if (Platform.OS !== 'ios' || !IOS_REVIEW_URL) return
    try {
      await Linking.openURL(IOS_REVIEW_URL)
    } catch {
      Alert.alert('', t('contact_review_failed'))
    }
  }
  return (
    <View style={[styles.settingsGroup, { backgroundColor: colors.groupedSurface }]}>
      {children}
      <Pressable
        accessibilityRole="button"
        testID="settings-contact"
        style={children ? [styles.subRow, { borderTopColor: colors.groupedSeparator }] : styles.row}
        onPress={() => {
          setError('')
          setVisible(true)
        }}
      >
        <Ionicons name="chatbubbles-outline" size={20} color={colors.textSecondary} />
        <Text style={[styles.rowLabel, { color: colors.text }]}>{t('landing_simple_contact')}</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
      </Pressable>
      {Platform.OS === 'ios' && IOS_REVIEW_URL ? (
        <Pressable
          accessibilityRole="link"
          testID="settings-review"
          style={[styles.subRow, { borderTopColor: colors.groupedSeparator }]}
          onPress={() => void review()}
        >
          <Ionicons name="star-outline" size={20} color={colors.textSecondary} />
          <Text style={[styles.rowLabel, { color: colors.text }]}>{t('contact_review')}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
        </Pressable>
      ) : null}
      <ContactDialog
        visible={visible}
        onClose={() => setVisible(false)}
        onJoin={() => void join()}
        joining={joining}
        error={error}
      />
    </View>
  )
}
