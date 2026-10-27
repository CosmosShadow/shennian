// @arch docs/product/ui-design/AI详情与名片_设计说明.md
import { useMemo, useRef, useState } from 'react'
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import * as FileSystem from 'expo-file-system/legacy'
import * as MediaLibrary from 'expo-media-library'
import Svg, { Rect } from 'react-native-svg'
import { useTranslation } from 'react-i18next'
import { createShareInviteQrMatrix } from '../../components/sheets/shareInviteQr'
import { useTheme } from '../../hooks/useTheme'

const SIZE = 220
const PADDING = 12

export function AgentCardQr({ name, url }: { name: string; url: string }) {
  const { i18n } = useTranslation()
  const zh = i18n.language.startsWith('zh')
  const { colors } = useTheme()
  const svgRef = useRef<Svg>(null)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const matrix = useMemo(() => {
    try { return createShareInviteQrMatrix(url) } catch { return null }
  }, [url])
  if (!matrix) return null
  const cell = (SIZE - 2 * PADDING) / matrix.size
  const save = () => svgRef.current?.toDataURL(async (base64) => {
    try {
      if (Platform.OS === 'web') {
        const link = document.createElement('a')
        link.href = `data:image/png;base64,${base64}`
        link.download = 'shennian-ai-card.png'
        link.click()
      } else {
        const permission = await MediaLibrary.requestPermissionsAsync(true, ['photo'])
        if (!permission.granted) return
        const path = `${FileSystem.cacheDirectory}shennian-ai-card.png`
        await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 })
        await MediaLibrary.saveToLibraryAsync(path)
      }
      setSaved(true)
    } catch { Alert.alert('', zh ? '保存二维码失败' : 'Could not save the QR code') }
  })
  return <View style={[styles.card, { backgroundColor: colors.groupedSurface }]}>
    <Svg ref={svgRef} width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}
      accessibilityRole="image" accessibilityLabel={zh ? `${name}的二维码` : `QR code for ${name}`}>
      <Rect width={SIZE} height={SIZE} fill="#fff" />
      {matrix.data.map((dark, index) => dark ? <Rect key={index}
        x={PADDING + (index % matrix.size) * cell}
        y={PADDING + Math.floor(index / matrix.size) * cell}
        width={cell} height={cell} fill="#111722" /> : null)}
    </Svg>
    <Text style={[styles.caption, { color: colors.textSecondary }]}>
      {zh ? `扫码查看${name}` : `Scan to view ${name}`}
    </Text>
    <View style={styles.icons}>
      <IconButton icon={saved ? 'checkmark' : 'download-outline'}
        label={zh ? '保存二维码' : 'Save QR code'} onPress={save} />
    </View>
    <View style={[styles.divider, { backgroundColor: colors.border }]} />
    <Text style={[styles.label, { color: colors.textSecondary }]}>{zh ? '邀请链接' : 'Invite link'}</Text>
    <View style={[styles.link, { backgroundColor: colors.surfaceHover }]}>
      <Text style={[styles.url, { color: colors.text }]} selectable numberOfLines={1}>{url}</Text>
      <IconButton icon={copied ? 'checkmark' : 'copy-outline'}
        label={zh ? '复制链接' : 'Copy link'} onPress={() => {
          void import('expo-clipboard').then(({ setStringAsync }) => setStringAsync(url)).then(() => setCopied(true))
        }} />
    </View>
  </View>
}

function IconButton({ icon, label, onPress }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void
}) {
  const { colors } = useTheme()
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
    style={[styles.icon, { backgroundColor: colors.brandLight }]}>
    <Ionicons name={icon} size={21} color={colors.brand} />
  </Pressable>
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, padding: 16, alignItems: 'center' },
  caption: { fontSize: 13, marginTop: 10 },
  icons: { flexDirection: 'row', gap: 14, marginTop: 14 },
  icon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  divider: { width: '100%', height: StyleSheet.hairlineWidth, marginTop: 18 },
  label: { alignSelf: 'flex-start', fontSize: 13, marginTop: 14, marginBottom: 7 },
  link: { width: '100%', minHeight: 52, borderRadius: 10, flexDirection: 'row', alignItems: 'center', paddingLeft: 12, paddingRight: 6 },
  url: { flex: 1, fontSize: 15, marginRight: 6 },
})
