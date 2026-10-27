import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import * as MediaLibrary from 'expo-media-library'
import Ionicons from '@expo/vector-icons/Ionicons'
import Svg, { Rect, Text as SvgText } from 'react-native-svg'
import { useTranslation } from 'react-i18next'
import { createShareInviteQrMatrix } from '../../components/sheets/shareInviteQr'
import { useTheme } from '../../hooks/useTheme'

const WIDTH = 320
const HEIGHT = 398
const QR_SIZE = 240
const QR_X = (WIDTH - QR_SIZE) / 2
const QR_Y = 98
const QUIET_ZONE = 12
const ONSCREEN_QR = 224

export function PersonalIdentityQr({ value, name, header }: { value: string; name: string; header?: ReactNode }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const ref = useRef<Svg>(null)
  const [saved, setSaved] = useState(false)
  const matrix = useMemo(() => {
    try { return createShareInviteQrMatrix(value) } catch { return null }
  }, [value])
  if (!matrix) return null
  const cell = (QR_SIZE - QUIET_ZONE * 2) / matrix.size
  const addHint = t('mobile_identity_qr_hint', { name })
  const save = () => {
    ref.current?.toDataURL(async (base64) => {
      try {
        if (Platform.OS === 'web') {
          const link = document.createElement('a')
          link.href = `data:image/png;base64,${base64}`
          link.download = 'shennian-contact-card.png'
          link.click()
        } else {
          const permission = await MediaLibrary.requestPermissionsAsync(true, ['photo'])
          if (!permission.granted) return
          const path = `${FileSystem.cacheDirectory}shennian-contact-card.png`
          await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 })
          await MediaLibrary.saveToLibraryAsync(path)
        }
        setSaved(true)
      } catch { Alert.alert('', t('mobile_identity_qr_save_failed')) }
    })
  }
  const onScreenCell = ONSCREEN_QR / matrix.size
  return <View style={[styles.card, { backgroundColor: colors.groupedSurface }]}>
    {header}
    <View style={styles.qrFrame} accessibilityRole="image" accessibilityLabel={t('mobile_identity_qr_for', { name })}>
      <Svg width={ONSCREEN_QR} height={ONSCREEN_QR} viewBox={`0 0 ${ONSCREEN_QR} ${ONSCREEN_QR}`}>
        {matrix.data.map((dark, index) => dark ? <Rect key={index}
          x={(index % matrix.size) * onScreenCell} y={Math.floor(index / matrix.size) * onScreenCell}
          width={onScreenCell + 0.4} height={onScreenCell + 0.4} fill="#111111" /> : null)}
      </Svg>
    </View>
    <Text style={[styles.hint, { color: colors.text }]}>{addHint}</Text>
    <Text style={[styles.hintSub, { color: colors.textTertiary }]}>{t('mobile_identity_qr_scan_with')}</Text>
    <Pressable accessibilityRole="button" onPress={save} hitSlop={8} style={styles.saveLink}>
      <Ionicons name={saved ? 'checkmark-circle' : 'download-outline'} size={17} color={saved ? colors.success : colors.brand} />
      <Text style={[styles.saveLinkText, { color: saved ? colors.success : colors.brand }]}>
        {t(saved ? 'mobile_identity_qr_saved' : 'mobile_identity_qr_save')}
      </Text>
    </Pressable>
    {/* Off-screen full contact card: this is the image written to the photo library. */}
    <View pointerEvents="none" style={styles.exportHost}>
      <Svg ref={ref} width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        <Rect width={WIDTH} height={HEIGHT} fill="#FFFFFF" />
        <SvgText x={WIDTH / 2} y={46} textAnchor="middle" fontSize={16} fontWeight="700" fill="#635BFF">{t('mobile_identity_qr_brand')}</SvgText>
        <SvgText x={WIDTH / 2} y={83} textAnchor="middle" fontSize={23} fontWeight="600" fill="#171717">{name}</SvgText>
        <Rect x={QR_X} y={QR_Y} width={QR_SIZE} height={QR_SIZE} rx={12} fill="#FFFFFF" />
        {matrix.data.map((dark, index) => dark ? <Rect key={index}
          x={QR_X + QUIET_ZONE + (index % matrix.size) * cell}
          y={QR_Y + QUIET_ZONE + Math.floor(index / matrix.size) * cell}
          width={cell} height={cell} fill="#111111" /> : null)}
        <SvgText x={WIDTH / 2} y={356} textAnchor="middle" fontSize={16} fontWeight="600" fill="#262626">{addHint}</SvgText>
        <SvgText x={WIDTH / 2} y={380} textAnchor="middle" fontSize={13} fill="#8A8A8A">{t('mobile_identity_qr_scan_with')}</SvgText>
      </Svg>
    </View>
  </View>
}

const styles = StyleSheet.create({
  card: { borderRadius: 28, paddingHorizontal: 24, paddingTop: 36, paddingBottom: 28, alignItems: 'center',
    shadowColor: '#1B1B3A', shadowOpacity: 0.06, shadowRadius: 24, shadowOffset: { width: 0, height: 8 }, elevation: 2 },
  qrFrame: { marginTop: 14 },
  hint: { marginTop: 14, fontSize: 16, fontWeight: '600', textAlign: 'center' },
  hintSub: { marginTop: 4, fontSize: 13, textAlign: 'center' },
  saveLink: { marginTop: 18, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 12 },
  saveLinkText: { fontSize: 15, fontWeight: '500' },
  exportHost: { position: 'absolute', left: -2000, top: 0, width: WIDTH, height: HEIGHT, opacity: 0 },
})
