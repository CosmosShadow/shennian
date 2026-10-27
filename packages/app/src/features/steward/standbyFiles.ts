// @arch docs/features/personal-modules.md
// @test src/__tests__/chat-composer-input.test.ts
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
export type ComposerFile = { uri: string; name: string; size: number; mimeType: string }
export type ComposerFiles = { id: number; files: ComposerFile[] }
export async function pickStandbyFiles(kind: 'file' | 'media' | 'camera'): Promise<ComposerFile[]> {
  if (kind === 'file') {
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      multiple: true,
      copyToCacheDirectory: true,
    })
    return result.canceled
      ? []
      : result.assets.map((file) => ({
          uri: file.uri,
          name: file.name,
          size: file.size ?? 0,
          mimeType: file.mimeType ?? 'application/octet-stream',
        }))
  }
  const permission =
    kind === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!permission.granted) throw new Error('permission_denied')
  const result =
    kind === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images', 'videos'],
          allowsMultipleSelection: true,
          quality: 0.85,
        })
  return result.canceled
    ? []
    : result.assets.map((file, i) => ({
        uri: file.uri,
        name:
          file.fileName ??
          `${Date.now()}-${i}.${file.mimeType?.split('/')[1] ?? (file.type === 'video' ? 'mp4' : 'jpg')}`,
        size: 0,
        mimeType: file.mimeType ?? (file.type === 'video' ? 'video/mp4' : 'image/jpeg'),
      }))
}
