// @arch docs/features/network-rooms/scoped-browser-access.md
// @test tests/e2e/web/scoped-room-dialogs.spec.ts

import { useEffect, useRef, useState } from 'react'
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import QRCode from 'react-native-qrcode-svg'
import * as Clipboard from 'expo-clipboard'
import { useTranslation } from 'react-i18next'
import { useWebModalFocus } from '../../../hooks/useWebModalFocus'
import { useEscapeKey } from '../../../hooks/useEscapeKey'
import { useTheme } from '../../../hooks/useTheme'
import {
  getAppDownloadUrl,
  getPreferredDownloadOrder,
  fetchAppDownloads,
  type AppDownloadPlatform,
  type AppDownloads,
} from '../../../platform/appDownloads'
import { getServerUrl } from '../../../config/server'

export type DownloadPlatform = AppDownloadPlatform
export function mobileAppDownloadUrl(platform: DownloadPlatform) {
  return getAppDownloadUrl(platform)
}
export function isMobileBrowser() {
  return typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

export function MobileAppDownloadCard({
  platform,
  downloads,
  unavailable = false,
}: {
  platform: DownloadPlatform
  downloads?: AppDownloads | null
  unavailable?: boolean
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  const desktop = platform === 'macos' || platform === 'windows'
  const release = downloads?.[platform]
  const available = !desktop || Boolean(release)
  const url = available
    ? mobileAppDownloadUrl(platform)
    : `${getServerUrl().replace(/\/+$/, '')}/#downloads`
  const copy = async () => {
    try {
      if (!(await Clipboard.setStringAsync(url))) throw new Error('Copy failed')
      setCopied(true)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }
  return (
    <View testID={`mobile-download-${platform}`} style={styles.platform}>
      <Text style={[styles.platformTitle, { color: colors.text }]}>
        {{ ios: 'iOS', android: 'Android', macos: 'macOS', windows: 'Windows' }[platform]}
      </Text>
      {release ? (
        <Text style={{ color: colors.textSecondary }}>
          {[
            release.version,
            release.arch,
            release.minimumSystem,
            release.status === 'preview' ? t('setup_preview') : '',
            `${Math.round(release.size / 1024 / 1024)} MB`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      ) : desktop ? (
        <Text style={{ color: colors.textSecondary }}>
          {t(
            unavailable
              ? 'setup_download_failed'
              : downloads
                ? 'setup_download_not_published'
                : 'loading',
          )}
        </Text>
      ) : null}
      <View style={styles.qr}>
        <QRCode value={url} size={156} quietZone={12} />
      </View>
      <View style={styles.addressRow}>
        <Text
          selectable
          numberOfLines={2}
          style={[styles.address, { color: colors.textSecondary }]}
        >
          {url}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(copied ? 'link_copied' : 'scoped_room_copy_address')}
          style={[styles.copy, { backgroundColor: colors.brandLight }]}
          hitSlop={4}
          onPress={() => void copy()}
        >
          <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={20} color={colors.brand} />
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="link"
        style={[styles.action, { backgroundColor: colors.surfaceHover }]}
        onPress={() => void Linking.openURL(url).catch(() => setFailed(true))}
      >
        <Text style={[styles.actionLabel, { color: colors.brand }]}>
          {t(available ? 'scoped_room_direct_download' : 'download_official_site')}
        </Text>
      </Pressable>
      {failed ? <Text style={{ color: colors.error }}>{t('scoped_room_copy_failed')}</Text> : null}
    </View>
  )
}

export function MobileAppDownloadDialog({
  visible,
  onClose,
}: {
  visible: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [downloads, setDownloads] = useState<AppDownloads | null>(null)
  const [downloadFailed, setDownloadFailed] = useState(false)
  const dialogRef = useRef<View>(null)
  const closeRef = useRef<View>(null)
  useWebModalFocus({ visible, containerRef: dialogRef, initialFocusRef: closeRef })
  useEscapeKey(visible, onClose, { includeEditable: true })
  useEffect(() => {
    if (!visible) return
    const controller = new AbortController()
    let active = true
    const timer = setTimeout(() => controller.abort(), 15000)
    setDownloadFailed(false)
    setDownloads(null)
    void fetchAppDownloads(controller.signal)
      .then((value) => {
        if (active) setDownloads(value)
      })
      .catch(() => {
        if (active) setDownloadFailed(true)
      })
      .finally(() => clearTimeout(timer))
    return () => {
      active = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [visible])
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} accessible={false} onPress={onClose}>
        <Pressable
          ref={dialogRef}
          role="dialog"
          accessibilityViewIsModal
          style={[styles.dialog, { backgroundColor: colors.bg }]}
          accessible={false}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={styles.header}>
            <View style={styles.icon} />
            <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
              {t('scoped_room_download_app')}
            </Text>
            <Pressable
              accessibilityRole="button"
              ref={closeRef}
              accessibilityLabel={t('close')}
              style={styles.icon}
              onPress={onClose}
            >
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              {t('download_return_invite')}
            </Text>
            <View style={styles.platforms}>
              {getPreferredDownloadOrder(
                typeof navigator === 'undefined' ? '' : navigator.userAgent,
              ).map((platform) => (
                <MobileAppDownloadCard
                  key={platform}
                  platform={platform}
                  downloads={downloads}
                  unavailable={downloadFailed}
                />
              ))}
            </View>
            <Pressable
              accessibilityRole="link"
              style={styles.action}
              onPress={() =>
                void Linking.openURL(getServerUrl()).catch(() => setDownloadFailed(true))
              }
            >
              <Text style={{ color: colors.brand }}>{t('download_official_site')}</Text>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.32)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  dialog: { width: '100%', maxWidth: 600, maxHeight: '90%', borderRadius: 16, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 8 },
  icon: { width: 48, height: 48, justifyContent: 'center', alignItems: 'center' },
  title: { flex: 1, fontSize: 17, lineHeight: 22, fontWeight: '600', textAlign: 'center' },
  content: { padding: 24, paddingTop: 8, gap: 24 },
  hint: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
  platforms: { flexDirection: 'row', flexWrap: 'wrap', gap: 24 },
  platform: { flex: 1, minWidth: 220, gap: 16 },
  platformTitle: { fontSize: 16, lineHeight: 22, fontWeight: '600', textAlign: 'center' },
  qr: { alignItems: 'center' },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  address: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 17 },
  copy: { width: 48, height: 48, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  action: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  actionLabel: { fontSize: 15, lineHeight: 22, fontWeight: '500' },
})
