// @arch docs/features/network-rooms/implementation-plan.md#四、登录、昵称与头像
// @test scripts/device-pairing-browser-e2e.mjs
import { useEffect, useState } from 'react'
import { ActivityIndicator, Image, Platform, Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { api } from '../../../config/api'
import type { Colors } from '../../../hooks/useTheme'

export function PairingQrPanel({ intentId, colors, onApproved }: {
  intentId: string; colors: Colors; onApproved: () => void
}) {
  const { t } = useTranslation()
  const [dataUrl, setDataUrl] = useState('')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    setDataUrl('')
    setError('')
    void (async () => {
      try {
        const { token } = await api<{ token: string }>(
          `/auth/device-authorizations/${encodeURIComponent(intentId)}/qr`,
          { method: 'POST', credentials: 'omit' },
        )
        const qr = require('qrcode') as { toDataURL: (text: string, options: object) => Promise<string> }
        const url = await qr.toDataURL(`pair:${token}`, { width: 320, margin: 2, errorCorrectionLevel: 'M' })
        if (cancelled) return
        setDataUrl(url)
        const poll = async () => {
          try {
            const result = await api<{ status: string }>(
              `/auth/device-authorizations/${encodeURIComponent(intentId)}/qr-status`,
              { method: 'POST', credentials: 'omit', body: JSON.stringify({ token }) },
            )
            if (cancelled) return
            if (result.status === 'approved') { onApproved(); return }
            if (result.status === 'expired' || result.status === 'denied') {
              setDataUrl(''); setError(t('device_auth_expired')); return
            }
          } catch {
            if (cancelled) return
            setDataUrl(''); setError(t('device_auth_unavailable')); return
          }
          if (!cancelled) timer = setTimeout(() => void poll(), 2000)
        }
        void poll()
      } catch {
        if (!cancelled) setError(t('device_auth_unavailable'))
      }
    })()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [intentId, attempt, onApproved, t])

  const download = () => {
    if (!dataUrl || Platform.OS !== 'web' || typeof document === 'undefined') return
    const anchor = document.createElement('a')
    anchor.href = dataUrl
    anchor.download = 'shennian-pairing.png'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }
  return <View style={{ alignItems: 'center' }}>
    <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center' }}>{t('device_auth_scan_hint')}</Text>
    {dataUrl ? <Image testID="pairing-qr" accessibilityLabel={t('device_auth_scan')}
      source={{ uri: dataUrl }} style={{ width: 192, height: 192, marginTop: 12 }} /> :
      !error ? <ActivityIndicator style={{ margin: 32 }} color={colors.brand} /> : null}
    {error ? <>
      <Text accessibilityRole="alert" style={{ color: colors.error, marginTop: 16 }}>{error}</Text>
      <Pressable accessibilityRole="button" onPress={() => setAttempt((value) => value + 1)} style={{ minHeight: 44, justifyContent: 'center' }}>
        <Text style={{ color: colors.brand }}>{t('retry')}</Text>
      </Pressable>
    </> : null}
    {dataUrl && Platform.OS === 'web' ? <Pressable testID="download-pairing-qr" accessibilityRole="button" onPress={download}
      style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 }}>
      <Text style={{ color: colors.brand }}>{t('device_auth_download_qr')}</Text>
    </Pressable> : null}

  </View>
}
