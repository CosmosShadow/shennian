// @arch docs/architecture/machine-sharing.md
// @test ../../__tests__/machine-sharing-source.test.ts

import { useEffect, useState } from 'react'
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { api } from '../../config/api'
import { getServerUrl } from '../../config/server'
import { MobileAppDownloadDialog } from '../rooms/components/MobileAppDownloads'
import { useTheme } from '../../hooks/useTheme'

type Preview = { machineName: string; ownerName: string; expiresAt: string | null }

function inviteErrorKey(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('cancelled')) return 'machine_invite_cancelled'
  if (message.includes('expired')) return 'machine_invite_expired'
  if (message.includes('used')) return 'machine_invite_used'
  return 'machine_invite_unavailable'
}

export default function MachineInviteWebScreen({ token }: { token: string }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [errorKey, setErrorKey] = useState('')
  const [downloadsOpen, setDownloadsOpen] = useState(false)
  const [openFailed, setOpenFailed] = useState(false)

  useEffect(() => {
    setErrorKey('')
    void api<Preview>(`/machines/grants/${encodeURIComponent(token)}/preview`)
      .then(setPreview)
      .catch((error) => setErrorKey(inviteErrorKey(error)))
  }, [token])

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <View style={[styles.icon, { backgroundColor: `${colors.brand}14` }]}>
        <Ionicons name="desktop-outline" size={34} color={colors.brand} />
      </View>
      {errorKey ? (
        <>
          <Text style={[styles.title, { color: colors.text }]}>{t(errorKey)}</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>{t('machine_invite_error_help')}</Text>
        </>
      ) : !preview ? (
        <ActivityIndicator color={colors.brand} />
      ) : (
        <>
          <Text style={[styles.eyebrow, { color: colors.textTertiary }]}>
            {t('machine_invite_from', { name: preview.ownerName })}
          </Text>
          <Text style={[styles.title, { color: colors.text }]}>{preview.machineName}</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            {preview.expiresAt
              ? t('machine_share_expires_at', { date: new Date(preview.expiresAt).toLocaleDateString() })
              : t('machine_share_never_expires')}
          </Text>
          <View style={[styles.warning, { backgroundColor: `${colors.warning}12`, borderColor: `${colors.warning}40` }]}>
            <Ionicons name="warning-outline" size={20} color={colors.warning} />
            <Text style={[styles.warningText, { color: colors.textSecondary }]}>{t('machine_share_risk')}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => void Linking.openURL(`shennian://machine-invites/${encodeURIComponent(token)}`).catch(() => setOpenFailed(true))}
            style={[styles.primary, { backgroundColor: colors.brand }]}
          >
            <Text style={styles.primaryText}>{t('machine_invite_open_app')}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => setDownloadsOpen(true)} style={styles.linkButton}>
            <Text style={{ color: colors.brand }}>{t('machine_invite_download_app')}</Text>
          </Pressable>
          <Text style={[styles.body, {color: colors.textSecondary}]}>{t('download_return_invite')}</Text>
          {openFailed ? <Text accessibilityRole="alert" style={{color: colors.error}}>{t('setup_open_failed')}</Text> : null}
          <Pressable accessibilityRole="link" style={styles.linkButton} onPress={() => void Linking.openURL(getServerUrl()).catch(() => setOpenFailed(true))}>
            <Text style={{color: colors.brand}}>{t('download_official_site')}</Text>
          </Pressable>
        </>
      )}
      <MobileAppDownloadDialog visible={downloadsOpen} onClose={() => setDownloadsOpen(false)} />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  icon: { width: 72, height: 72, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  eyebrow: { fontSize: 14, fontWeight: '600' },
  title: { fontSize: 26, lineHeight: 34, fontWeight: '700', textAlign: 'center' },
  body: { fontSize: 14, lineHeight: 21, textAlign: 'center' },
  warning: { width: '100%', maxWidth: 460, flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderWidth: 1, borderRadius: 14, padding: 14, marginVertical: 8 },
  warningText: { flex: 1, fontSize: 13, lineHeight: 19 },
  primary: { width: '100%', maxWidth: 460, minHeight: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  linkButton: { minHeight: 44, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
})
