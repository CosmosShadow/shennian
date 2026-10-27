// @arch docs/design/project-coordination-ios.md
// @test src/__tests__/project-coordination-composer.test.ts
import { useDirectoryUploadMenu } from '../../steward/useDirectoryUploadMenu'
import { ComposerActionMenu } from '../../chat/components/ComposerActionMenu'
import { useRef, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { ComposerIconButton } from '../../chat/components/ComposerIconButton'
import { ComposerVoiceControl } from '../../chat/components/ComposerVoiceControl'
import { useVoiceDraft } from '../../chat/hooks/useVoiceDraft'
import { useIsFocused } from '@react-navigation/native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { randomUUID } from 'expo-crypto'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../../config/auth'
import { useTheme } from '../../../hooks/useTheme'
import { projectCoordinationRequest } from './client'
import { usePersonalAiDataConsent } from '../../privacy/useAiDataConsent'
import { useChatUploads } from '../../chat/hooks/useChatUploads'
export function ProjectCoordinationComposer({ machineId, workDir, onSent, bottom = 8 }: { machineId: string; workDir: string; onSent?: () => void; bottom?: number }) {
  const { colors } = useTheme(), { t } = useTranslation(), router = useRouter()
  const [menu, setMenu] = useState(false)
  const directoryMenu = useDirectoryUploadMenu(t, () => setMenu(false))
  const [value, setValue] = useState(''), [busy, setBusy] = useState(false)
  const [inputHeight, setInputHeight] = useState(48)
  const receipt = useRef<{ text: string; id: string } | null>(null)
  const uploads = useChatUploads({ machineId, workDir, enabled: true })
  const ensureConsent = usePersonalAiDataConsent()
  const focused = useIsFocused()
  const accountId = useAuthStore(state => state.user?.id ?? null)
  const voice = useVoiceDraft({ sessionId: accountId ? `project-coordination:${accountId}:${machineId}:${workDir}` : null, sessionDraftEnabled: false, active: focused && !!accountId, currentDraft: value, onListeningTextChange: setValue, onDraftReady: result => setValue(result.draft) })
  const showVoice = !busy && ((!value.trim() && !uploads.pendingAttachments.length) || voice.phase === 'listening' || voice.phase === 'refining')
  const send = async () => {
    if ((!value.trim() && !uploads.pendingAttachments.length) || busy || uploads.isUploading) return
    const fingerprint = value + JSON.stringify(uploads.pendingAttachments.map(f => f.sha256))
    if (receipt.current?.text !== fingerprint) receipt.current = { text: fingerprint, id: randomUUID() }
    setBusy(true)
    try {
      if (!(await ensureConsent())) return
      await projectCoordinationRequest(machineId, workDir, { command: 'message', text: value.trim() || uploads.pendingAttachments.map(f => f.name).join('、'), requestId: receipt.current.id,
        attachments: uploads.pendingAttachments.map(f => ({ path: f.path, name: f.name, mimeType: f.mimeType, kind: f.kind, byteSize: f.byteSize, sha256: f.sha256 })) })
      setValue(''); setInputHeight(48); uploads.clearPendingAttachments(); receipt.current = null
      if (onSent) onSent()
      else router.push({ pathname: '/(main)/project-coordination', params: { machineId, workDir } })
    } catch { Alert.alert(t('coordination_error')) } finally { setBusy(false) }
  }
  return <View style={[styles.wrap, { paddingBottom: bottom, backgroundColor: colors.bg }]}>
    {menu ? <ComposerActionMenu vertical colors={colors} items={[
      ...directoryMenu.items,
      { id: 'image', icon: 'image', label: t('coordination_image'), onPress: () => { setMenu(false); void uploads.handleAttachNativeMedia() } },
      { id: 'file', icon: 'folder', label: t('coordination_file'), onPress: () => { setMenu(false); void uploads.handleAttachNativeFile() } },
    ]} /> : null}
    {uploads.pendingAttachments.map(file => <Pressable key={file.id} accessibilityRole="button" onPress={() => uploads.cancelUpload(file.id)}><Text style={{ color: colors.textMuted }}>{file.name} · {Math.round(file.progress * 100)}% ×</Text></Pressable>)}
    <View style={[styles.input, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('coordination_attach')} style={styles.send} onPress={() => setMenu(previous => !previous)}><Ionicons name="add" size={24} color={colors.textMuted} /></Pressable>
      <TextInput value={value} onChangeText={setValue} onContentSizeChange={event => setInputHeight(Math.max(48, Math.min(150, event.nativeEvent.contentSize.height)))} multiline editable={!busy} placeholder={t('coordination_placeholder')}
        placeholderTextColor={colors.textMuted} accessibilityLabel={t('coordination_chat_placeholder')}
        style={[styles.text, { color: colors.text, height: value ? inputHeight : 48 }]} />
      {showVoice ? <ComposerVoiceControl phase={voice.phase} onStart={voice.startRecording} onStop={voice.stopRecording} meterLevel={voice.meterLevel} colors={colors} disabled={uploads.isUploading} /> : <ComposerIconButton icon="arrow-up" colors={colors} busy={busy}
        emphasized={busy || (!uploads.isUploading && (!!value.trim() || uploads.pendingAttachments.length > 0))}
        onPress={() => void send()} disabled={uploads.isUploading || (!value.trim() && !uploads.pendingAttachments.length)}
        accessibilityLabel={t('send')} />}
    </View>
  </View>
}
const styles = StyleSheet.create({ wrap: { paddingHorizontal: 12, paddingTop: 8 }, input: { flexDirection: 'row', alignItems: 'flex-end', borderWidth: 1, borderRadius: 25, paddingLeft: 2 }, text: { flex: 1, fontSize: 17, paddingTop: 12, paddingBottom: 12, maxHeight: 150 }, send: { minWidth: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' } })
