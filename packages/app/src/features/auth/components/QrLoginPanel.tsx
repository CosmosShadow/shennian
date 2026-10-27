// @arch docs/architecture/app/modular-features.md#登录-feature
// @test src/__tests__/auth-providers.test.ts

import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import Ionicons from '@expo/vector-icons/Ionicons'
import { AccessibleButton } from '../../../components/AccessibleButton'
import type { Colors } from '../../../hooks/useTheme'
import type { QrStatus } from '../types'

type Props = {
  qrUrl: string
  qrStatus: QrStatus
  error?: string
  onRefresh: () => void | Promise<void>
  colors: Colors
  compact?: boolean
}

export function QrLoginPanel({ qrUrl, qrStatus, error = '', onRefresh, colors, compact = false }: Props) {
  const { t } = useTranslation()
  const isExpired = qrStatus === 'expired'
  const isWaitingForApproval = qrStatus === 'scanned' || qrStatus === 'confirmed'

  return (
    <View testID="qr-login-panel" style={[styles.qrContainer, compact && styles.qrContainerCompact]}>
      {error ? (
        <View accessibilityRole="alert" style={[styles.qrState, compact && styles.qrStateCompact]}>
          <Ionicons name="warning-outline" size={28} color={colors.error} />
          <Text style={[styles.qrStateTitle, { color: colors.text }]}>
            {t('qr_login_error_title')}
          </Text>
          <Text style={[styles.qrStateBody, { color: colors.textSecondary }]}>
            {error}
          </Text>
          <AccessibleButton
            testID="qr-retry-button"
            accessibilityLabel={t('qr_regenerate')}
            style={[
              styles.qrRetry,
              { borderColor: colors.border, backgroundColor: colors.surface },
            ]}
            onPress={() => void onRefresh()}
          >
            <Text style={[styles.qrRetryText, { color: colors.brand }]}>{t('qr_regenerate')}</Text>
          </AccessibleButton>
        </View>
      ) : isExpired ? (
        <View accessibilityRole="alert" style={[styles.qrState, compact && styles.qrStateCompact]}>
          <Ionicons name="time-outline" size={28} color={colors.textSecondary} />
          <Text style={[styles.qrStateTitle, { color: colors.text }]}>{t('qr_expired')}</Text>
          <AccessibleButton
            testID="qr-retry-button"
            accessibilityLabel={t('qr_regenerate')}
            style={[
              styles.qrRetry,
              { borderColor: colors.border, backgroundColor: colors.surface },
            ]}
            onPress={() => void onRefresh()}
          >
            <Text style={[styles.qrRetryText, { color: colors.brand }]}>{t('qr_regenerate')}</Text>
          </AccessibleButton>
        </View>
      ) : (
        <View style={styles.qrReadyState}>
          <View style={[styles.qrImageWrap, compact && styles.qrImageWrapCompact]}>
            {qrUrl ? (
              <Image
                accessibilityLabel={t('qr_login')}
                source={{ uri: qrUrl }}
                style={[styles.qrImage, compact && styles.qrImageCompact]}
                resizeMode="contain"
              />
            ) : (
              <View style={[styles.qrPlaceholder, compact && styles.qrPlaceholderCompact]}>
                <ActivityIndicator color={colors.brand} />
              </View>
            )}
          </View>
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.qrHint, { color: colors.textSecondary }]}
          >
            {!qrUrl
              ? t('qr_generating')
              : isWaitingForApproval
                ? t('qr_success')
                : t('qr_scanning')}
          </Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  qrContainer: {
    alignItems: 'center',
    minHeight: 244,
    justifyContent: 'center',
  },
  qrContainerCompact: { minHeight: 196 },
  qrReadyState: {
    alignItems: 'center',
    gap: 16,
  },
  qrImageWrap: {
    width: 180,
    height: 180,
    borderRadius: 12,
    backgroundColor: '#fff',
    padding: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qrImageWrapCompact: { width: 148, height: 148, borderRadius: 10, padding: 7 },
  qrImage: {
    width: 164,
    height: 164,
  },
  qrImageCompact: { width: 134, height: 134 },
  qrPlaceholder: {
    width: 164,
    height: 164,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qrPlaceholderCompact: { width: 134, height: 134 },
  qrState: {
    width: '100%',
    minHeight: 244,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrStateCompact: { minHeight: 196 },
  qrStateTitle: {
    marginTop: 12,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    textAlign: 'center',
  },
  qrStateBody: {
    maxWidth: 320,
    marginTop: 8,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  qrRetry: {
    minWidth: 144,
    minHeight: 44,
    marginTop: 16,
    paddingHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrRetryText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  qrHint: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
})
