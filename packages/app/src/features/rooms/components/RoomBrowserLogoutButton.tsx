// @arch docs/features/network-rooms/scoped-browser-access.md
// @test src/__tests__/room-invite-web.test.ts

import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../hooks/useTheme'
import { scopedRoomApi } from '../scopedRoomApi'

export function RoomBrowserLogoutButton({ roomId, variant = 'icon' }: { roomId: string; variant?: 'icon' | 'menu' }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const logout = async () => {
    if (busy) return
    setBusy(true)
    setFailed(false)
    try {
      await scopedRoomApi(roomId, '/logout', { method: 'POST' })
      window.location.replace(`/spaces/${encodeURIComponent(roomId)}`)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={variant === 'icon' ? styles.root : styles.menuRoot}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('room_browser_logout')}
        accessibilityState={{ busy, disabled: busy }}
        disabled={busy}
        testID="room-browser-logout"
        onPress={() => void logout()}
        style={variant === 'icon' ? styles.button : styles.menuButton}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.textSecondary} />
        ) : (
          <>
            <Ionicons name="log-out-outline" size={20} color={variant === 'menu' ? colors.error : colors.textSecondary} />
            {variant === 'menu' ? <Text style={[styles.menuLabel, { color: colors.error }]}>{t('room_browser_logout')}</Text> : null}
          </>
        )}
      </Pressable>
      {failed ? (
        <Text
          accessibilityRole="alert"
          style={[
            variant === 'icon' ? styles.error : styles.menuError,
            {
              color: colors.error,
              backgroundColor: colors.bg,
              borderColor: colors.border,
            },
          ]}
        >
          {t('room_browser_logout_failed')}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { position: 'relative', zIndex: 20 },
  menuRoot: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(127,127,127,0.28)', paddingTop: 8 },
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  menuButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },
  menuLabel: { fontSize: 15, lineHeight: 22, fontWeight: '500' },
  error: {
    position: 'absolute',
    top: 44,
    right: 0,
    width: 160,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    lineHeight: 19,
  },
  menuError: { paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, lineHeight: 19, textAlign: 'center' },
})
