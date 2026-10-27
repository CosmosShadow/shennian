import { useCallback } from 'react'
import { View, Pressable, StyleSheet, Platform } from 'react-native'
import { useTranslation } from 'react-i18next'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import Feather from '@expo/vector-icons/Feather'
import { useSheetsStore } from '@shennian/shared'
import BottomSheet from '../BottomSheet'

const BRAND = '#4f46e5'

export type PickedFile = {
  uri: string
  name: string
  mimeType: string
  size: number
}

export default function AttachSheet() {
  const { t } = useTranslation()
  const isOpen = useSheetsStore((s) => s.attachOpen)
  const close = useSheetsStore((s) => s.closeAttach)
  const onFilesPicked = useSheetsStore((s) => s.onAttachFilesPicked)

  const pickDocument = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: true,
      })
      if (result.canceled || result.assets.length === 0) return
      const files: PickedFile[] = result.assets.map((a) => ({
        uri: a.uri,
        name: a.name,
        mimeType: a.mimeType ?? 'application/octet-stream',
        size: a.size ?? 0,
      }))
      close()
      onFilesPicked?.(files)
    } catch {
      // user cancelled or permission denied
    }
  }, [close, onFilesPicked])

  const pickImage = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (status !== 'granted') return
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        quality: 0.85,
      })
      if (result.canceled || result.assets.length === 0) return
      const files: PickedFile[] = result.assets.map((a) => ({
        uri: a.uri,
        name: a.fileName ?? `image_${Date.now()}.jpg`,
        mimeType: a.mimeType ?? 'image/jpeg',
        size: a.fileSize ?? 0,
      }))
      close()
      onFilesPicked?.(files)
    } catch {
      // user cancelled or permission denied
    }
  }, [close, onFilesPicked])

  const takePhoto = useCallback(async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync()
      if (!permission.granted) return
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 })
      if (result.canceled || !result.assets[0]) return
      const asset = result.assets[0]
      close()
      onFilesPicked?.([{
        uri: asset.uri,
        name: asset.fileName ?? `photo_${Date.now()}.jpg`,
        mimeType: asset.mimeType ?? 'image/jpeg',
        size: asset.fileSize ?? 0,
      }])
    } catch {
      // User cancelled or permission denied.
    }
  }, [close, onFilesPicked])

  return (
    <BottomSheet isOpen={isOpen} onClose={close} title={t('attach_file')}>
      <View style={s.pickerRow}>
        <Pressable style={s.pickerBtn} onPress={pickDocument}>
          <Feather name="file" size={20} color={BRAND} />
        </Pressable>
        {Platform.OS !== 'web' && (
          <>
            <Pressable style={s.pickerBtn} onPress={pickImage} accessibilityLabel={t('pick_image')}>
              <Feather name="image" size={20} color={BRAND} />
            </Pressable>
            <Pressable style={s.pickerBtn} onPress={takePhoto} accessibilityLabel={t('profile_avatar_camera')}>
              <Feather name="camera" size={20} color={BRAND} />
            </Pressable>
          </>
        )}
      </View>
    </BottomSheet>
  )
}

const s = StyleSheet.create({
  pickerRow: {
    flexDirection: 'row',
    gap: 12,
    paddingBottom: 8,
  },
  pickerBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: BRAND + '50',
    borderRadius: 14,
    paddingVertical: 18,
    backgroundColor: BRAND + '08',
  },
})
