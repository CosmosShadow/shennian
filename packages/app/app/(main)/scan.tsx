import { getServerUrl } from '../../src/config/server'
// @arch docs/features/network-rooms/scoped-browser-access.md
// @test src/__tests__/scan-utils.test.ts
import { useState, useEffect, useMemo, useRef } from 'react'
import { View, Text, Pressable, StyleSheet, Platform, ActivityIndicator, Alert } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { useGoBack } from '../../src/hooks/useGoBack'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ApiError, useMachinesStore } from '@shennian/shared'
import type { Machine } from '@shennian/wire'
import { authApi } from '../../src/config/api'
import { useTheme } from '../../src/hooks/useTheme'
import {
  getScanSuccessTranslationKey,
  isScannerEnabled,
  parseScanPayload,
  type ScanAction,
  type ScanActionKind,
} from '../../src/utils/scan'
import Ionicons from '@expo/vector-icons/Ionicons'
import { HeaderBackButton } from '../../src/components/AppPageHeader'
import { mobileTypography } from '../../src/theme/mobileTypography'

let CameraView: any = null
let CameraModule: any = null
if (Platform.OS !== 'web') {
  try {
    CameraModule = require('expo-camera')
    CameraView = CameraModule.CameraView
  } catch {
    /* expo-camera not available */
  }
}

export default function ScanScreen() {
  const { t } = useTranslation()
  const goBack = useGoBack()
  const router = useRouter()
  const { colors } = useTheme()
  const [processing, setProcessing] = useState(false)
  const processingRef = useRef(false)
  const pairedToken = useRef<string | null>(null)
  const [error, setError] = useState('')
  const [hasPermission, setHasPermission] = useState<boolean | null>(null)
  const [completedKind, setCompletedKind] = useState<Exclude<ScanActionKind, 'room' | 'person'> | null>(null)

  useEffect(() => {
    if (Platform.OS !== 'web' && CameraView) {
      CameraModule.Camera.requestCameraPermissionsAsync().then(({ status }: { status: string }) => {
        setHasPermission(status === 'granted')
      })
    }
  }, [])

  const showSuccessAlert = (kind: Exclude<ScanActionKind, 'room' | 'person'>) => {
    setCompletedKind(kind)
    Alert.alert(t(getScanSuccessTranslationKey(kind)), '', [{ text: t('ok'), onPress: goBack }], {
      cancelable: false,
    })
  }

  const handleScanAction = async (action: Exclude<ScanAction, { kind: 'room' | 'person' }>) => {
    setProcessing(true)
    setError('')
    let succeeded = false

    try {
      if (action.kind === 'login') {
        await authApi('/auth/qr/confirm', {
          method: 'POST',
          body: JSON.stringify({ qrToken: action.token }),
        })
      } else if (action.kind === 'roomAccess') {
        const preview = await authApi<{ roomName: string; willJoin?: boolean }>(
          `/room-browser/${encodeURIComponent(action.roomId)}/qr/preview`,
          { method: 'POST', body: JSON.stringify({ token: action.token }) },
        )
        const confirmed = await new Promise<boolean>((resolve) => {
          Alert.alert(preview.willJoin ? t('spaces_join_room') : t('room_browser_approve_title', { name: preview.roomName }), t('room_browser_approve_body'), [
            { text: t('cancel'), style: 'cancel', onPress: () => resolve(false) },
            { text: t('room_browser_approve_action'), onPress: () => resolve(true) },
          ], { cancelable: true, onDismiss: () => resolve(false) })
        })
        if (!confirmed) return
        await authApi(`/room-browser/${encodeURIComponent(action.roomId)}/qr/confirm`, {
          method: 'POST',
          body: JSON.stringify({ token: action.token, confirmed: true }),
        })
      } else {
        if (pairedToken.current !== action.token) {
          await authApi('/machines/pair/claim', {
            method: 'POST',
            body: JSON.stringify({ pairToken: action.token }),
          })
          pairedToken.current = action.token
        }
        const data = await authApi<{ machines: Machine[] }>('/machines')
        useMachinesStore.getState().setMachines(data.machines ?? [])
      }

      succeeded = true
      showSuccessAlert(action.kind)
    } catch (err) {
      if (action.kind === 'login' || action.kind === 'roomAccess') {
        setError(err instanceof ApiError && /room_membership_required|room_join_unavailable/.test(err.message)
          ? t('room_access_invite_required_body')
          : err instanceof Error ? err.message : t('qr_confirm_failed'))
      } else if (action.kind === 'share') {
        setError(err instanceof Error ? err.message : t('share_redeem_failed'))
      } else {
        setError(
          pairedToken.current === action.token ? t('setup_claim_refresh_failed') : err instanceof ApiError && err.status === 401 ? t('pair_auth_expired') : t('pair_failed'),
        )
      }
    } finally {
      setProcessing(false)
      if (!succeeded) {
        processingRef.current = false
      }
    }
  }

  const startScanAction = (action: ScanAction) => {
    processingRef.current = true
    if (action.kind === 'room') {
      // Stay in the main stack: replacing it with the public Room route loses the origin.
      router.replace({
        pathname: '/(main)/room-join',
        params: { roomId: action.roomId, invite: action.inviteToken },
      })
      return
    }
    if (action.kind === 'person') {
      router.replace({ pathname: '/contacts/users/[userId]', params: { userId: action.userId } })
      return
    }
    if (action.kind === 'share') {
      router.replace(`/machine-invites/${encodeURIComponent(action.token)}`)
      return
    }
    void handleScanAction(action)
  }

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (processingRef.current) return
    if (!isScannerEnabled({ processing, completed: completedKind !== null })) return
    const action = parseScanPayload(data, getServerUrl())
    if (!action) return
    startScanAction(action)
  }

  const handlePickQrImage = async () => {
    if (processingRef.current || Platform.OS === 'web' || !CameraModule) return
    processingRef.current = true
    setProcessing(true)
    setError('')
    let actionStarted = false

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (permission.status !== 'granted') {
        setError(t('scan_photo_permission'))
        return
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: false,
        quality: 1,
      })
      if (result.canceled || !result.assets[0]) return

      const results = await CameraModule.Camera.scanFromURLAsync(result.assets[0].uri, ['qr'])
      const action = results
        .map(({ data }: { data: string }) => parseScanPayload(data, getServerUrl()))
        .find(Boolean)
      if (!action) {
        setError(t('scan_image_invalid'))
        return
      }
      actionStarted = true
      startScanAction(action)
    } catch {
      setError(t('scan_image_failed'))
    } finally {
      if (!actionStarted) {
        processingRef.current = false
        setProcessing(false)
      }
    }
  }

  const ds = useMemo(
    () => ({
      container: { backgroundColor: colors.bg },
      header: { borderBottomColor: colors.border },
      headerTitle: { color: colors.text },
    }),
    [colors],
  )
  const scannerEnabled = isScannerEnabled({
    processing,
    completed: completedKind !== null,
  })

  return (
    <SafeAreaView style={[styles.container, ds.container]} edges={['top']}>
      <View style={[styles.header, ds.header]}>
        <HeaderBackButton onPress={goBack} />
        <Text style={[styles.headerTitle, ds.headerTitle]}>{t('scan_title')}</Text>
        <View style={styles.spacer} />
      </View>

      {Platform.OS !== 'web' && hasPermission && CameraView ? (
        <View style={styles.cameraContainer}>
          <CameraView
            style={StyleSheet.absoluteFill}
            barCodeScannerSettings={{ barCodeTypes: ['qr'] }}
            onBarcodeScanned={scannerEnabled ? handleBarCodeScanned : undefined}
          />
          <View style={styles.scanOverlay}>
            <View style={styles.scanFrame} />
            <Text style={styles.scanHint}>{t('scan_hint')}</Text>
            {processing && (
              <ActivityIndicator color="#fff" size="large" style={{ marginTop: 16 }} />
            )}
            {error ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>{error}</Text>
                <Pressable onPress={() => setError('')}>
                  <Text style={styles.errorDismiss}>{t('retry')}</Text>
                </Pressable>
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('scan_choose_image')}
              testID="scan-photo-library-action"
              disabled={processing}
              onPress={() => void handlePickQrImage()}
              style={({ pressed }) => [
                styles.libraryButton,
                pressed && styles.libraryButtonPressed,
                processing && styles.libraryButtonDisabled,
              ]}
            >
              <Ionicons name="images-outline" size={19} color="#111827" />
              <Text style={styles.libraryButtonText}>{t('scan_choose_image')}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.fallbackContainer}>
          <Ionicons name="camera-outline" size={48} color={colors.textTertiary} />
          <Text style={[styles.fallbackText, { color: colors.textSecondary }]}>
            {hasPermission === false
              ? t('camera_permission_message')
              : t('scan_camera_unavailable')}
          </Text>
          {Platform.OS !== 'web' && CameraModule ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('scan_choose_image')}
              testID="scan-photo-library-action"
              disabled={processing}
              onPress={() => void handlePickQrImage()}
              style={({ pressed }) => [
                styles.fallbackLibraryButton,
                { backgroundColor: colors.brand },
                pressed && styles.libraryButtonPressed,
                processing && styles.libraryButtonDisabled,
              ]}
            >
              {processing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Ionicons name="images-outline" size={19} color="#fff" />
              )}
              <Text style={styles.fallbackLibraryButtonText}>{t('scan_choose_image')}</Text>
            </Pressable>
          ) : null}
          {error ? (
            <Text style={[styles.fallbackError, { color: Platform.OS === 'web' ? colors.error : colors.errorText }]}>{error}</Text>
          ) : null}
        </View>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    ...mobileTypography.navigationTitle,
  },
  spacer: {
    width: 48,
  },
  cameraContainer: {
    flex: 1,
    position: 'relative',
  },
  scanOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  scanFrame: {
    width: 220,
    height: 220,
    borderWidth: 2,
    borderColor: '#fff',
    borderRadius: 16,
  },
  scanHint: {
    color: '#fff',
    ...mobileTypography.secondary,
    marginTop: 16,
    opacity: 0.8,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  libraryButton: {
    position: 'absolute',
    bottom: 32,
    minHeight: 46,
    paddingHorizontal: 20,
    borderRadius: 23,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  libraryButtonPressed: {
    opacity: 0.78,
  },
  libraryButtonDisabled: {
    opacity: 0.55,
  },
  libraryButtonText: {
    color: '#111827',
    ...mobileTypography.compactAction,
  },
  errorBanner: {
    marginTop: 16,
    backgroundColor: 'rgba(239,68,68,0.85)',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  errorText: {
    color: '#fff',
    ...mobileTypography.metadata,
    flex: 1,
  },
  errorDismiss: {
    color: '#fff',
    ...mobileTypography.compactAction,
    opacity: 0.9,
  },
  fallbackContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  fallbackText: {
    ...mobileTypography.secondary,
    textAlign: 'center',
  },
  fallbackLibraryButton: {
    minHeight: 46,
    marginTop: 8,
    paddingHorizontal: 20,
    borderRadius: 23,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  fallbackLibraryButtonText: {
    color: '#fff',
    ...mobileTypography.compactAction,
  },
  fallbackError: {
    marginTop: 4,
    ...mobileTypography.metadata,
    textAlign: 'center',
  },
})
