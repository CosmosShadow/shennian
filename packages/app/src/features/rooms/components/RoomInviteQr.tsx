// @arch docs/features/network-rooms/ui.md#七群聊详情
// @test src/__tests__/room-management-panel.test.ts

import { useMemo, useRef, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import * as FileSystem from 'expo-file-system/legacy'
import * as MediaLibrary from 'expo-media-library'
import { useTranslation } from 'react-i18next'
import Svg, { Rect, Text as SvgText } from 'react-native-svg'
import { createShareInviteQrMatrix } from '../../../components/sheets/shareInviteQr'
import { useTheme } from '../../../hooks/useTheme'
import { fitInviteQrTitle } from './roomInviteQrTitle'

const POSTER_WIDTH = 280
const POSTER_HEIGHT = 308
const POSTER_DISPLAY_WIDTH = 240
const QR_SIZE = 172
const QR_X = (POSTER_WIDTH - QR_SIZE) / 2
const QR_Y = 24

export function RoomInviteQr({ value, roomName, purpose = 'invite', hint }: {
  value: string
  roomName: string
  purpose?: 'invite' | 'open'
  hint?: string
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const svgRef = useRef<Svg>(null)
  const [saved, setSaved] = useState(false)
  const [posterWidth, setPosterWidth] = useState(POSTER_DISPLAY_WIDTH)
  const matrix = useMemo(() => {
    try {
      return createShareInviteQrMatrix(value)
    } catch {
      return null
    }
  }, [value])

  if (!matrix) return null
  const cellSize = QR_SIZE / matrix.size
  const fittedTitle = fitInviteQrTitle(roomName, (displayName) =>
    purpose === 'invite' ? t('spaces_invite_qr_join_name', { name: displayName }) : displayName,
  )

  const filename = purpose === 'invite' ? 'shennian-group-invite.png' : 'shennian-group.png'
  const save = () => {
    svgRef.current?.toDataURL(async (base64) => {
      if (Platform.OS === 'web') {
        const link = document.createElement('a')
        link.download = filename
        link.href = `data:image/png;base64,${base64}`
        link.click()
      } else {
        const permission = await MediaLibrary.requestPermissionsAsync(true, ['photo'])
        if (!permission.granted) return
        const uri = `${FileSystem.cacheDirectory}${filename}`
        await FileSystem.writeAsStringAsync(uri, base64, {
          encoding: FileSystem.EncodingType.Base64,
        })
        await MediaLibrary.saveToLibraryAsync(uri)
      }
      setSaved(true)
    })
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>{t('spaces_invite_qr_title')}</Text>
        <Pressable
          testID="room-invite-qr-save"
          accessibilityRole="button"
          accessibilityLabel={t(saved ? 'spaces_invite_qr_saved' : 'spaces_invite_qr_save')}
          hitSlop={4}
          onPress={save}
          style={({ pressed }) => [
            styles.saveButton,
            { backgroundColor: colors.brandLight },
            pressed && styles.pressed,
          ]}
        >
          <Ionicons
            name={saved ? 'checkmark' : 'download-outline'}
            size={18}
            color={colors.brand}
          />
        </Pressable>
      </View>
      <View
        style={styles.qrBody}
        onLayout={({ nativeEvent }) => {
          const width = Math.min(POSTER_DISPLAY_WIDTH, nativeEvent.layout.width)
          if (width > 0) setPosterWidth(width)
        }}
      >
        <Svg
          ref={svgRef}
          testID="room-invite-qr"
          accessibilityRole="image"
          accessibilityLabel={`${t('spaces_invite_qr_title')} · ${roomName} · ${hint ?? t('spaces_invite_qr_open_hint')}`}
          width={posterWidth}
          height={posterWidth * POSTER_HEIGHT / POSTER_WIDTH}
          viewBox={`0 0 ${POSTER_WIDTH} ${POSTER_HEIGHT}`}
          style={styles.matrix}
        >
          <Rect width={POSTER_WIDTH} height={POSTER_HEIGHT} rx={16} fill="#fff" />
          {matrix.data.map((dark, index) => {
            if (!dark) return null
            const x = index % matrix.size
            const y = Math.floor(index / matrix.size)
            return (
              <Rect
                key={index}
                x={QR_X + x * cellSize}
                y={QR_Y + y * cellSize}
                width={cellSize}
                height={cellSize}
                fill="#111"
              />
            )
          })}
          <SvgText
            x={POSTER_WIDTH / 2}
            y={226}
            fill="#111"
            fontSize={fittedTitle.fontSize}
            fontWeight="600"
            textAnchor="middle"
          >
            {fittedTitle.title}
          </SvgText>
          {(hint ?? t(purpose === 'invite' ? 'spaces_invite_qr_open_hint' : 'scoped_room_scan_with_app')).split('\n').map((line, index) => (
            <SvgText key={index} x={POSTER_WIDTH / 2} y={250 + index * 20} fill="#666666" fontSize={13} textAnchor="middle">
              {line}
            </SvgText>
          ))}
        </Svg>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { paddingBottom: 4 },
  header: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { flex: 1, paddingRight: 12, fontSize: 16, lineHeight: 22, fontWeight: '600' },
  qrBody: { alignItems: 'center', paddingTop: 4, paddingBottom: 6 },
  matrix: {
    backgroundColor: '#fff',
    borderRadius: 16,
    shadowColor: '#000',
    shadowOpacity: 0.07,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
  },
  saveButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.55 },
})
