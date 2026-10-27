import { useDirectoryUploadMenu } from '../useDirectoryUploadMenu'
import { ActionIconButton } from '../../../components/ActionIconButton'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useComposerBottomInset } from '../../chat/hooks/useComposerBottomInset'
// @arch docs/features/personal-modules.md
// @test src/__tests__/steward-navigation.test.ts
import { useRef, useState } from 'react'
import { Alert, Keyboard, Pressable, Text, TextInput, View } from 'react-native'
import { useIsFocused } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import Feather from '@expo/vector-icons/Feather'
import { useAuthStore } from '../../../config/auth'
import { useTheme } from '../../../hooks/useTheme'
import { useVoiceDraft } from '../../chat/hooks/useVoiceDraft'
import { ComposerActionMenu } from '../../chat/components/ComposerActionMenu'
import { useStewardInspiration } from '../useStewardInspiration'
import { StewardComposerInput } from './StewardComposerInput'
import { pickStandbyFiles, type ComposerFiles } from '../standbyFiles'
import { ComposerDock } from '../../../components/ComposerDock'

/** No Agent/session is required to compose text, transcribe speech, or select local files. */
export function StewardStandbyComposer({
  input,
  onChange,
  files,
  onFiles,
  reason,
  placeholder,
  inspirationEnabled = true,
  onBusyChange = () => {},
}: {
  onBusyChange?: (busy: boolean) => void
  input: string
  onChange: (text: string) => void
  files?: ComposerFiles
  onFiles: (files: ComposerFiles | undefined) => void
  reason: string
  placeholder?: string
  inspirationEnabled?: boolean
}) {
  const { t } = useTranslation(),
    { colors } = useTheme()
  const accountId = useAuthStore((state) => state.user?.id ?? '')
  const focused = useIsFocused()
  const insets = useSafeAreaInsets()
  const bottomInset = useComposerBottomInset(insets.bottom)
  const inputRef = useRef<TextInput>(null)
  const [menu, setMenu] = useState(false)
  const directoryMenu = useDirectoryUploadMenu(t, () => setMenu(false))
  const notify = () => Alert.alert(t('steward_title'), reason)
  const voice = useVoiceDraft({
    sessionId: `composer:${accountId}`,
    active: focused && Boolean(accountId),
    sessionDraftEnabled: false,
    shareContinuousRecording: true,
    currentDraft: input,
    onListeningTextChange: onChange,
    onDraftReady: (result) => onChange(result.draft),
  })
  const { openInspiration, inspirationUi } = useStewardInspiration({
    enabled: inspirationEnabled,
    accountId,
    input,
    attachments: files?.files.length ?? 0,
    sending: false,
    uploading: false,
    editing: false,
    voicePhase: voice.phase,
    ready: false,
    closeMenu: () => setMenu(false),
    send: async () => false,
    showError: (message) => Alert.alert(message),
  })
  const pick = async (kind: 'file' | 'media' | 'camera') => {
    setMenu(false)
    onBusyChange(true)
    try {
      const selected = await pickStandbyFiles(kind)
      if (selected.length && useAuthStore.getState().user?.id === accountId)
        onFiles({ id: Date.now(), files: [...(files?.files ?? []), ...selected] })
    } catch {
      Alert.alert(t('personal_action_failed'))
    } finally {
      onBusyChange(false)
    }
  }
  return (
    <View>
      {inspirationUi}
      <ComposerDock bottomInset={bottomInset}>
        {files?.files.map((file, index) => (
          <View
            key={`${index}:${file.uri}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
          >
            <Text style={{ color: colors.text, flex: 1 }} numberOfLines={1}>
              {file.name}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${t('cancel')} ${file.name}`}
              style={{
                minHeight: 44,
                minWidth: 44,
                justifyContent: 'center',
                alignItems: 'center',
              }}
              onPress={() =>
                onFiles({ id: Date.now(), files: files.files.filter((_, i) => i !== index) })
              }
            >
              <Feather name="x" size={18} color={colors.textSecondary} />
            </Pressable>
          </View>
        ))}
        {menu ? (
          <View style={{ position: 'absolute', bottom: 74, left: 0, zIndex: 30 }}>
            <ComposerActionMenu
              vertical
              colors={colors}
              items={[
                ...directoryMenu.items,
                ...(inspirationEnabled ? [{
                  id: 'inspiration',
                  icon: 'zap' as const,
                  label: t('inspiration_title'),
                  onPress: () => {
                    setMenu(false)
                    openInspiration()
                  },
                }] : []),
                {
                  id: 'file',
                  icon: 'folder',
                  label: directoryMenu.fileLabel,
                  onPress: () => void pick('file'),
                },
                {
                  id: 'camera',
                  icon: 'camera',
                  label: directoryMenu.cameraLabel,
                  onPress: () => void pick('camera'),
                },
                {
                  id: 'media',
                  icon: 'image',
                  label: directoryMenu.mediaLabel,
                  onPress: () => void pick('media'),
                },
              ]}
            />
          </View>
        ) : null}
        <StewardComposerInput
          placeholder={placeholder}
          input={input}
          onChange={onChange}
          inputRef={inputRef}
          onFocus={() => setMenu(false)}
          onBlur={() => {}}
          colors={colors}
          phase={voice.phase}
          meterLevel={voice.meterLevel}
          disabled={!accountId}
          canSend={Boolean(input.trim() || files?.files.length)}
          sending={false}
          actions={
            <ActionIconButton icon="add" color={colors.textSecondary}
              testID="composer-more-btn"
              label={t('composer_more_actions')}
              onPress={() => {
                Keyboard.dismiss()
                setMenu((value) => !value)
              }}

             />
          }
          onStart={async (held) => {
            onBusyChange(true)
            try {
              const started = await voice.startRecording(held)
              if (!started) onBusyChange(false)
              return started
            } catch {
              onBusyChange(false)
              return false
            }
          }}
          onCancel={async () => {
            try {
              await voice.cancelRecording()
            } finally {
              onBusyChange(false)
            }
          }}
          onDictationStop={async () => {
            try { await voice.stopRecording({ skipRefine: true }) } finally { onBusyChange(false) }
          }}
          onRelease={async () => {
            try {
              const result = await voice.stopRecording({ skipRefine: true })
              if (result?.draft.trim()) notify()
            } finally {
              onBusyChange(false)
            }
          }}
          onSend={notify}
        />
      </ComposerDock>
    </View>
  )
}
