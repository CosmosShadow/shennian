import { ComposerIconButton } from '../../chat/components/ComposerIconButton'
import { ActionIconButton } from '../../../components/ActionIconButton'
// @arch docs/features/network-rooms/local-first-persistence.md#本机草稿
// @test src/__tests__/room-conversation-screen.test.ts

import { useState, useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react'
import {
  ActivityIndicator,
  Image,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native'
import Feather from '@expo/vector-icons/Feather'
import { useTranslation } from 'react-i18next'
import type { Colors } from '../../../hooks/useTheme'
import { isVoiceComposerInputReadOnly, type VoiceComposerPhase } from '../../chat/utils/voice'
import { ComposerInputCard } from '../../chat/components/ComposerInputCard'
import { ComposerActionMenu } from '../../chat/components/ComposerActionMenu'
import { ComposerVoiceControl } from '../../chat/components/ComposerVoiceControl'
import { useChatFontSize } from '../../../hooks/useChatFontSize'
import { RoomDraftImageViewer } from './RoomDraftImageViewer'
import { buildRoomDraftImageGallery, canPreviewRoomDraftImage } from '../roomDraftImagePreview'
import type { PendingRoomAttachment } from '../useRoomDraftPersistence'
import { isInlineImage } from '../../uploads/heicFile'

type Props = {
  roomId: string
  active: boolean
  readonlyMessage?: string
  draft: string
  selection?: TextInputProps['selection']
  inputRef: RefObject<TextInput | null>
  inputFocused: boolean
  setInputFocused: (focused: boolean) => void
  onFocus: () => void
  onChangeText: (value: string) => void
  onSelectionChange: NonNullable<TextInputProps['onSelectionChange']>
  onSend: () => void
  pendingAttachments: PendingRoomAttachment[]
  setPendingAttachments: Dispatch<SetStateAction<PendingRoomAttachment[]>>
  sendError: boolean
  sending: boolean
  isOffline: boolean
  showMenu: boolean
  setShowMenu: Dispatch<SetStateAction<boolean>>
  onPickMedia: () => void
  onTakePhoto: () => void
  onPickFiles: () => void
  voice: {
    phase: VoiceComposerPhase
    meterLevel: number
    startRecording: () => Promise<unknown>
    stopRecording: (options?: { skipRefine?: boolean }) => Promise<unknown>
  }
  colors: Colors
  isDark: boolean
  bottomInset: number
}

export function RoomComposer(props: Props) {
  const [preview, setPreview] = useState<ReturnType<typeof buildRoomDraftImageGallery>>(null)
  useEffect(() => setPreview(null), [props.roomId, props.active])
  const { typography: roomTypography } = useChatFontSize()
  const { t } = useTranslation()
  const hasReadyAttachment = props.pendingAttachments.some((item) => item.status === 'ready')
  const hasUploadingAttachment = props.pendingAttachments.some(
    (item) => item.status === 'uploading',
  )
  const sendDisabled =
    (!props.draft.trim() && !hasReadyAttachment) ||
    hasUploadingAttachment ||
    props.sending ||
    props.isOffline
  const voiceInputReadOnly = isVoiceComposerInputReadOnly(props.voice.phase)

  const handleVoiceStart = () => {
    props.inputRef.current?.blur()
    Keyboard.dismiss()
    props.setInputFocused(false)
    return props.voice.startRecording()
  }

  useEffect(() => {
    if (!voiceInputReadOnly) return
    props.inputRef.current?.blur()
    Keyboard.dismiss()
    props.setInputFocused(false)
  }, [props.inputRef, props.setInputFocused, voiceInputReadOnly])

  return (
    <View style={[styles.area, { paddingBottom: props.bottomInset }]}>
      {preview ? (
        <RoomDraftImageViewer
          roomId={props.roomId}
          preview={preview}
          onClose={() => setPreview(null)}
        />
      ) : null}
      {props.active ? (
        <>
          {props.pendingAttachments.length ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.strip}
            >
              {props.pendingAttachments.map((item) => (
                <View
                  key={item.id}
                  style={[
                    styles.attachment,
                    {
                      backgroundColor: `${props.colors.brand}10`,
                      borderColor: `${props.colors.brand}25`,
                    },
                  ]}
                >
                  <Pressable
                    style={styles.attachmentBody}
                    disabled={!canPreviewRoomDraftImage(item)}
                    accessibilityRole="button"
                    accessibilityLabel={t('spaces_attachment_preview', { name: item.name })}
                    onPress={() => {
                      Keyboard.dismiss()
                      setPreview(buildRoomDraftImageGallery(props.pendingAttachments, item.id))
                    }}
                  >
                    {isInlineImage(item) && item.uri ? (
                      <View>
                        <Image source={{ uri: item.uri }} style={styles.thumb} />
                        {item.status === 'uploading' ? (
                          <View style={styles.progress}>
                            <ActivityIndicator size="small" color="#fff" />
                          </View>
                        ) : null}
                      </View>
                    ) : (
                      <View style={[styles.icon, { backgroundColor: props.colors.surface }]}>
                        <Feather
                          name={item.status === 'failed' ? 'alert-circle' : 'file'}
                          size={16}
                          color={
                            item.status === 'failed'
                              ? props.colors.error
                              : props.colors.textSecondary
                          }
                        />
                      </View>
                    )}
                    <Text numberOfLines={1} style={[styles.name, { color: props.colors.text }]}>
                      {item.name}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={styles.cancel}
                    hitSlop={8}
                    onPress={() =>
                      props.setPendingAttachments((current) =>
                        current.filter((candidate) => candidate.id !== item.id),
                      )
                    }
                  >
                    <Feather name="x" size={14} color={props.colors.textTertiary} />
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          ) : null}
          {props.sendError ? (
            <Text style={[styles.error, { color: props.colors.error }]}>
              {t('spaces_send_failed')}
            </Text>
          ) : null}
          {props.showMenu ? (
            <View style={styles.nativeMenuWrap}>
              <ComposerActionMenu
                colors={props.colors}
                items={[
                  { id: 'media', icon: 'image', label: t('composer_menu_photos'), onPress: props.onPickMedia },
                  ...(Platform.OS !== 'web' ? [{ id: 'camera', icon: 'camera' as const, label: t('profile_avatar_camera'), onPress: props.onTakePhoto }] : []),
                  { id: 'file', icon: 'file', label: t('composer_menu_files'), onPress: props.onPickFiles },
                ]}
              />
            </View>
          ) : null}
          <ComposerInputCard
            testID="room-message-input"
            inputStyle={roomTypography.body}
            inputRef={props.inputRef}
            value={props.draft}
            onChangeText={(value) => {
              if (!voiceInputReadOnly) props.onChangeText(value)
            }}
            selection={props.selection}
            onSelectionChange={props.onSelectionChange}
            onSubmitEditing={props.onSend}
            blurOnSubmit={false}
            placeholder={t('spaces_message_placeholder')}
            maxLength={4000}
            editable
            caretHidden={voiceInputReadOnly}
            inputFocused={props.inputFocused}
            onFocus={() => {
              props.onFocus()
            }}
            onBlur={() => props.setInputFocused(false)}
            colors={props.colors}
            isDark={props.isDark}
            leftActions={
              <>
                <ActionIconButton icon="add" color={props.showMenu ? props.colors.brand : props.colors.textSecondary}
                  testID="room-composer-more-btn"
                  onPress={() => props.setShowMenu((current) => !current)}
                  disabled={
                    props.sending || props.isOffline || props.pendingAttachments.length >= 10
                  }
                  label={t('composer_more_actions')}
                 />
              </>
            }
            rightActions={
              <>
                {Platform.OS !== 'web' ? (
                  <ComposerVoiceControl
                    phase={props.voice.phase}
                    onStart={handleVoiceStart}
                    onStop={props.voice.stopRecording}
                    disabled={props.sending || props.isOffline}
                    meterLevel={props.voice.meterLevel}
                    colors={props.colors}
                  />
                ) : null}
                <RoomSendButton
                  disabled={sendDisabled}
                  sending={props.sending}
                  onPress={props.onSend}
                  colors={props.colors}
                />
              </>
            }
          />
        </>
      ) : (
        <Text style={[styles.readonly, { color: props.colors.textSecondary }]}>
          {props.readonlyMessage ?? t('spaces_public_readonly')}
        </Text>
      )}
    </View>
  )
}

function RoomSendButton(props: {
  disabled: boolean
  sending: boolean
  onPress: () => void
  colors: Colors
}) {
  const { t } = useTranslation()
  return <ComposerIconButton testID="room-message-send" icon="arrow-up" colors={props.colors}
    disabled={props.disabled} busy={props.sending} emphasized={!props.disabled || props.sending}
    accessibilityLabel={t('send')} onPress={props.onPress} />
}

const styles = StyleSheet.create({
  area: {
    width: '100%',
    maxWidth: 860,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  strip: { gap: 6, marginBottom: 6, paddingRight: 4 },
  attachment: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
    minWidth: 180,
    maxWidth: 240,
  },
  attachmentBody: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  thumb: { width: 44, height: 44, borderRadius: 10, backgroundColor: '#ddd' },
  progress: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  icon: { width: 44, height: 44, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  name: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: '500' },
  cancel: { padding: 4, marginTop: -2 },
  error: { position: 'absolute', top: -16, left: 18, fontSize: 11 },
  nativeMenuWrap: { marginHorizontal: -16, marginBottom: 8 },
  readonly: { flex: 1, textAlign: 'center', fontSize: 13 },
})
