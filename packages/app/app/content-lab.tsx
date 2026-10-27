// @arch docs/tasks/20261015-2124_互动HTML通用Agent内容流实施.md
// Development-only EMPTY surface. No fixture works or fake generation receipts.
import { useState } from 'react'
import { Redirect, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { ActionSheetIOS, Alert, Platform } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import * as DocumentPicker from 'expo-document-picker'
import { InteractiveContentShell } from '../src/features/interactive-content/InteractiveContentShell'
import { emptyContentSession } from '../src/features/interactive-content/contentSession'

export default function ContentLab() {
  const router = useRouter()
  const { t } = useTranslation()
  const [input, onInput] = useState('')
  const [session] = useState(emptyContentSession)
  const [materials, setMaterials] = useState<string[]>([])
  const unavailable = () => Alert.alert(t('content_ready_unavailable'))
  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], selectionLimit: 4, allowsMultipleSelection: true })
    if (!result.canceled) setMaterials(result.assets.map((asset) => asset.fileName ?? 'Image'))
  }
  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: false })
    if (!result.canceled) setMaterials(result.assets.slice(0, 4).map((asset) => asset.name))
  }
  const pick = () => {
    const options = [t('cancel'), t('content_pick_image'), t('content_pick_file')]
    const choose = (index: number) => { void (index === 1 ? pickImage() : index === 2 ? pickFile() : Promise.resolve()).catch(unavailable) }
    if (Platform.OS === 'ios') ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: 0 }, choose)
    else Alert.alert(t('content_assets'), '', options.map((text, i) => ({ text, onPress: () => choose(i) })))
  }
  if (!__DEV__) return <Redirect href="/" />
  return <InteractiveContentShell session={session} input={input} onInput={onInput}
    onBack={() => router.canGoBack() ? router.back() : router.replace('/')} available={false}
    onSubmit={unavailable} onPickMaterial={pick} onRecord={unavailable} onStopRecording={() => {}}
    onPage={async () => false} onShare={unavailable} onPublish={unavailable} onOpenCompleted={() => {}}
    materialNames={materials} developmentNote />
}
