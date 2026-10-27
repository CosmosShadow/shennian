// @arch docs/features/desktop-login-and-first-use.md
// @test ../../__tests__/desktop-login-and-first-use.test.ts

import Ionicons from '@expo/vector-icons/Ionicons'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { Colors } from '../../hooks/useTheme'
import { desktopRecoveryAction, type DesktopRecoverySurface } from './desktopEntryState'

type Props = {
  issue: Exclude<DesktopRecoverySurface, 'none'>
  pending: boolean
  colors: Colors
  onAction: () => void | Promise<void>
}

const COPY = {
  'credential-store-unavailable': ['desktop_auth_recovery_unavailable_title', 'desktop_auth_recovery_unavailable_body'],
  'credential-corrupt': ['desktop_auth_recovery_corrupt_title', 'desktop_auth_recovery_corrupt_body'],
  'access-revoked': ['desktop_auth_access_revoked_title', 'desktop_auth_access_revoked_body'],
  'session-expired': ['desktop_auth_session_expired_title', 'desktop_auth_session_expired_body'],
} as const

export function DesktopRecoveryNotice({ issue, pending, colors, onAction }: Props) {
  const { t } = useTranslation()
  const [titleKey, bodyKey] = COPY[issue]
  const action = desktopRecoveryAction(issue)
  return (
    <View
      testID="desktop-auth-recovery-notice"
      accessibilityRole="alert"
      style={[styles.notice, { backgroundColor: colors.surfaceHover, borderColor: colors.border }]}
    >
      <Ionicons name={issue === 'credential-store-unavailable' ? 'lock-closed-outline' : 'warning-outline'} size={20} color={colors.error} />
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.text }]}>{t(titleKey)}</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>{t(bodyKey)}</Text>
        <Pressable
          testID="desktop-auth-recovery-action"
          accessibilityRole="button"
          accessibilityState={{ busy: pending, disabled: pending }}
          disabled={pending}
          onPress={() => void onAction()}
          style={({ pressed }) => [styles.action, {
            borderColor: colors.border,
            opacity: pressed || pending ? 0.68 : 1,
          }]}
        >
          <Text style={[styles.actionText, { color: colors.brand }]}>
            {t(pending ? 'desktop_auth_recovery_retrying' : action === 'retry-restore'
              ? 'desktop_auth_recovery_retry' : 'desktop_auth_recovery_sign_in_again')}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 16, marginBottom: 20 },
  copy: { flex: 1, minWidth: 0, gap: 8 },
  title: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 13, lineHeight: 19 },
  action: { minHeight: 44, minWidth: 44, alignSelf: 'flex-start', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 16 },
  actionText: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
})
