// @arch docs/design/desktop/macos-interaction-baseline.md
// @test ../../__tests__/desktop-room-public-conversation.test.ts

import {
  focusDesktopComposerBlankArea,
  observeDesktopComposerInputFocus,
} from '../desktop-chat/desktopComposerFocus'
import Ionicons from '@expo/vector-icons/Ionicons'
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import type { Colors } from '../../hooks/useTheme'
import { useWebModalFocus } from '../../hooks/useWebModalFocus'
import type { VoiceComposerPhase } from '../chat/utils/voice'
import type { PendingRoomAttachment } from '../rooms/useRoomDraftPersistence'
import { desktopRoomSendBlockReason, shouldSubmitDesktopRoomMessage } from './desktopRoomComposer'
import { desktopComposerMetrics } from '../desktop-shell/desktopDesignTokens'
import { DESKTOP_MENTION_LIST_ID } from './desktopRoomMention'
import { DesktopComposerIconButton } from '../desktop-chat/DesktopComposerIconButton'
import { DesktopComposerVoiceControl } from '../desktop-chat/DesktopComposerVoiceControl'
import { DesktopRoomDraftImage } from './DesktopRoomDraftImage'
import {
  DESKTOP_CHAT_COMPOSER_BOTTOM_GUTTER,
  DESKTOP_CHAT_COMPOSER_SHELL_WIDTH,
} from '../desktop-shell/desktopWorkspaceMetrics'

function fitDesktopRoomInputHeight(node: HTMLTextAreaElement): void {
  node.style.resize = 'none'
  node.style.height = '0px'
  node.style.height = `${Math.max(desktopComposerMetrics.inputMinHeight, Math.min(node.scrollHeight, desktopComposerMetrics.inputMaxHeight))}px`
}

export function DesktopRoomPublicComposer(props: {
  active: boolean
  readOnlyLabel: string
  roomName: string
  draft: string
  selection?: TextInputProps['selection']
  inputRef: RefObject<TextInput | null>
  inputFocused: boolean
  setInputFocused(focused: boolean): void
  onChangeText(value: string): void
  onPasteImage(event: ClipboardEvent): void
  onSelectionChange: NonNullable<TextInputProps['onSelectionChange']>
  onSend(): void
  /** Lets the open mention list claim a key (arrows, Enter, Tab, Escape) before the composer's own handling. */
  onKeyIntercept?(input: { key: string; shiftKey: boolean; isComposing: boolean }): boolean
  /** Present only while the mention list is open, so the textarea then exposes the combobox pattern. */
  mentionCombobox?: { activeOptionId: string | null }
  pendingAttachments: PendingRoomAttachment[]
  setPendingAttachments: Dispatch<SetStateAction<PendingRoomAttachment[]>>
  onRetryAttachment(item: PendingRoomAttachment): void
  sendError: boolean
  attachmentError: boolean
  sending: boolean
  isOffline: boolean
  showMenu: boolean
  setShowMenu: Dispatch<SetStateAction<boolean>>
  onPickMedia(): void
  onPickFiles(): void
  voice: {
    phase: VoiceComposerPhase
    meterLevel: number
    startRecording(): Promise<unknown>
    stopRecording(): Promise<unknown>
  }
  colors: Colors
}) {
  const { t } = useTranslation()
  useEffect(() => {
    const node = props.inputRef.current as unknown as HTMLTextAreaElement | null
    if (!node) return
    fitDesktopRoomInputHeight(node)
    let previousWidth = node.clientWidth
    const observer = new ResizeObserver(() => {
      if (node.clientWidth === previousWidth) return
      previousWidth = node.clientWidth
      fitDesktopRoomInputHeight(node)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [props.inputRef, props.active])
  useEffect(() => {
    const node = props.inputRef.current as unknown as HTMLTextAreaElement | null
    if (node) fitDesktopRoomInputHeight(node)
  }, [props.draft, props.inputRef, props.active])
  useEffect(() => {
    const node = props.inputRef.current as unknown as HTMLTextAreaElement | null
    if (!node) return
    const onPaste = (event: Event) => props.onPasteImage(event as ClipboardEvent)
    node.addEventListener('paste', onPaste)
    return () => node.removeEventListener('paste', onPaste)
  }, [props.inputRef, props.onPasteImage, props.active])
  useEffect(() => {
    const node = props.inputRef.current as unknown as HTMLTextAreaElement | null
    if (!node) return
    return observeDesktopComposerInputFocus(node, (focused) => {
      // The React onFocus handler owns the focused transition. This document observer
      // only clears focus missed by React Native Web (embedded panes and file pickers).
      // Reporting `true` here would synchronously re-enter the parent on every effect
      // subscription and can form a render/scroll loop while typing.
      if (!focused) props.setInputFocused(false)
    })
  }, [props.active, props.inputRef, props.setInputFocused])
  const addRef = useRef<View>(null)
  const menuRef = useRef<View>(null)
  const firstMenuActionRef = useRef<View>(null)
  useWebModalFocus({
    visible: props.showMenu,
    containerRef: menuRef,
    initialFocusRef: firstMenuActionRef,
    returnFocusRef: addRef,
  })
  const readyAttachment = props.pendingAttachments.some((item) => item.status === 'ready')
  const uploading = props.pendingAttachments.some((item) => item.status === 'uploading')
  const sendBlockReason = desktopRoomSendBlockReason({
    offline: props.isOffline,
    sending: props.sending,
    uploading,
    hasContent: Boolean(props.draft.trim()) || readyAttachment,
  })
  const disabled = sendBlockReason !== null
  const sendLabel =
    sendBlockReason === 'offline'
      ? t('desktop_room_offline_unavailable')
      : sendBlockReason === 'sending'
        ? t('desktop_composer_sending')
        : sendBlockReason === 'uploading'
          ? t('desktop_composer_wait_upload')
          : sendBlockReason === 'empty'
            ? t('desktop_composer_enter_message')
            : t('send')
  const attachmentDisabled =
    props.sending || props.isOffline || props.pendingAttachments.length >= 10
  const attachmentLabel = props.isOffline
    ? t('desktop_room_offline_unavailable')
    : props.sending
      ? t('desktop_composer_sending')
      : props.pendingAttachments.length >= 10
        ? `${t('composer_more_actions')} · 10/10`
        : t('composer_more_actions')
  const voiceDisabled = props.sending || props.isOffline
  const voiceDisabledReason = props.isOffline
    ? t('desktop_room_offline_unavailable')
    : props.sending
      ? t('desktop_composer_sending')
      : null
  const retryAttachmentLabel = props.isOffline
    ? t('desktop_room_offline_unavailable')
    : props.sending
      ? t('desktop_composer_sending')
      : t('retry')

  if (!props.active)
    return (
      <View style={styles.readonly}>
        <Text style={[styles.readonlyText, { color: props.colors.textSecondary }]}>
          {props.readOnlyLabel}
        </Text>
      </View>
    )

  return (
    <View testID="desktop-room-public-composer" style={styles.area}>
      {props.pendingAttachments.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.attachments}
        >
          {props.pendingAttachments.map((item) => (
            <View
              key={item.id}
              style={[
                styles.attachment,
                {
                  borderColor: item.status === 'failed' ? props.colors.error : props.colors.border,
                  backgroundColor: props.colors.surface,
                },
              ]}
            >
              <DesktopRoomDraftImage item={item} colors={props.colors} />
              <Text numberOfLines={1} style={[styles.attachmentName, { color: props.colors.text }]}>
                {item.name}
              </Text>
              {item.status === 'uploading' ? (
                <ActivityIndicator size="small" color={props.colors.brand} />
              ) : null}
              {item.status === 'failed' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={retryAttachmentLabel}
                  accessibilityState={{ disabled: props.sending || props.isOffline }}
                  disabled={props.sending || props.isOffline}
                  onPress={() => props.onRetryAttachment(item)}
                  style={styles.attachmentAction}
                >
                  <Ionicons name="refresh" size={17} color={props.colors.brand} />
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('remove')}
                onPress={() =>
                  props.setPendingAttachments((current) =>
                    current.filter((candidate) => candidate.id !== item.id),
                  )
                }
                style={styles.attachmentAction}
              >
                <Ionicons name="close" size={16} color={props.colors.textSecondary} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}
      {props.sendError ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: props.colors.error }]}>
          {t('spaces_send_failed')}
        </Text>
      ) : null}
      {props.attachmentError ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: props.colors.error }]}>
          {t('desktop_room_attachment_failed')}
        </Text>
      ) : null}
      <View
        onPointerDown={event => focusDesktopComposerBlankArea(event, () => props.inputRef.current?.focus())}
        style={[
          styles.card,
          {
            borderColor: props.inputFocused ? props.colors.brand : props.colors.border,
            backgroundColor: props.colors.bg,
          },
        ]}
      >
        <TextInput
          ref={props.inputRef}
          nativeID="desktop-room-message-input"
          testID="desktop-room-message-input"
          multiline
          value={props.draft}
          selection={props.selection}
          accessibilityLabel={t('desktop_room_public_send_target', { name: props.roomName })}
          onChangeText={props.onChangeText}
          onSelectionChange={props.onSelectionChange}
          onFocus={() => props.setInputFocused(true)}
          onBlur={() => props.setInputFocused(false)}
          onKeyPress={(event) => {
            const native = event.nativeEvent as typeof event.nativeEvent & {
              shiftKey?: boolean
              isComposing?: boolean
            }
            const key = {
              key: native.key,
              shiftKey: Boolean(native.shiftKey),
              isComposing: Boolean(native.isComposing),
            }
            if (props.onKeyIntercept?.(key)) {
              event.preventDefault()
              return
            }
            if (!shouldSubmitDesktopRoomMessage(key)) return
            event.preventDefault()
            props.onSend()
          }}
          {...(props.mentionCombobox
            ? ({
                role: 'combobox',
                'aria-expanded': true,
                'aria-controls': DESKTOP_MENTION_LIST_ID,
                'aria-activedescendant': props.mentionCombobox.activeOptionId ?? undefined,
              } as object)
            : null)}
          placeholder={t('spaces_message_placeholder')}
          placeholderTextColor={props.colors.textSecondary}
          maxLength={4000}
          style={[styles.input, desktopComposerMetrics.input, { color: props.colors.text }]}
        />
        <View style={styles.controls}>
          <View style={styles.leftControls}>
            <DesktopComposerIconButton
              actionRef={addRef}
              testID="desktop-room-composer-add"
              icon="plus"
              colors={props.colors}
              accessibilityLabel={attachmentLabel}
              selected={props.showMenu}
              disabled={attachmentDisabled}
              onPress={() => props.setShowMenu((open) => !open)}
            />
            {props.showMenu ? (
              <View
                ref={menuRef}
                testID="desktop-room-attachment-menu"
                accessibilityRole="menu"
                accessibilityViewIsModal
                style={[
                  styles.menu,
                  {
                    backgroundColor: props.colors.bg,
                    borderColor: props.colors.border,
                    shadowColor: props.colors.text,
                  },
                ]}
              >
                <AttachmentAction
                  actionRef={firstMenuActionRef}
                  icon="images-outline"
                  label={t('pick_image')}
                  colors={props.colors}
                  onPress={props.onPickMedia}
                />
                <AttachmentAction
                  icon="document-outline"
                  label={t('pick_file')}
                  colors={props.colors}
                  onPress={props.onPickFiles}
                />
              </View>
            ) : null}
          </View>
          <View style={styles.rightControls}>
            <DesktopComposerVoiceControl
              phase={props.voice.phase}
              colors={props.colors}
              disabled={voiceDisabled}
              disabledReason={voiceDisabledReason}
              onStart={props.voice.startRecording}
              onStop={props.voice.stopRecording}
            />
            <DesktopComposerIconButton
              testID="desktop-room-message-send"
              icon="send"
              colors={props.colors}
              accessibilityLabel={sendLabel}
              variant={disabled ? 'neutral' : 'primary'}
              busy={props.sending}
              disabled={disabled}
              onPress={props.onSend}
            />
          </View>
        </View>
      </View>
    </View>
  )
}

function AttachmentAction({
  actionRef,
  icon,
  label,
  colors,
  onPress,
}: {
  actionRef?: RefObject<View | null>
  icon: keyof typeof Ionicons.glyphMap
  label: string
  colors: Colors
  onPress(): void
}) {
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      ref={actionRef}
      accessibilityRole="menuitem"
      accessibilityLabel={label}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.menuRow,
        {
          borderColor: focused ? colors.brand : 'transparent',
          backgroundColor: pressed ? colors.surfaceHover : 'transparent',
        },
      ]}
    >
      <Ionicons name={icon} size={18} color={colors.textSecondary} />
      <Text style={[styles.menuLabel, { color: colors.text }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  area: {
    position: 'relative',
    width: '100%',
    maxWidth: DESKTOP_CHAT_COMPOSER_SHELL_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: DESKTOP_CHAT_COMPOSER_BOTTOM_GUTTER,
  },
  targetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  target: { minWidth: 0, flex: 1, fontSize: 12, lineHeight: 17 },
  error: { marginBottom: 5, paddingHorizontal: 4, fontSize: 12, lineHeight: 17 },
  card: {
    minHeight: desktopComposerMetrics.minHeight,
    borderWidth: 1,
    borderRadius: desktopComposerMetrics.radius,
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
  },
  input: {
    minHeight: desktopComposerMetrics.inputMinHeight,
    maxHeight: desktopComposerMetrics.inputMaxHeight,
    paddingHorizontal: 0,
    paddingTop: 3,
    paddingBottom: 1,
    textAlignVertical: 'top',
  },
  controls: {
    minHeight: desktopComposerMetrics.toolbarHeight,
    marginTop: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  leftControls: { position: 'relative' },
  rightControls: { flexDirection: 'row', alignItems: 'center', gap: 0 },
  iconButton: {
    width: 44,
    height: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  send: {
    width: 44,
    height: 44,
    borderWidth: 2,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menu: {
    position: 'absolute',
    left: 0,
    bottom: 50,
    width: 188,
    zIndex: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 5,
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  menuRow: {
    minHeight: 44,
    borderWidth: 2,
    borderRadius: 7,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  menuLabel: { fontSize: 14, lineHeight: 20 },
  attachments: { gap: 8, paddingBottom: 8 },
  attachment: {
    minWidth: 180,
    maxWidth: 250,
    minHeight: 52,
    paddingHorizontal: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  attachmentName: { minWidth: 0, flex: 1, fontSize: 12, lineHeight: 17 },
  attachmentAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  readonly: { minHeight: 70, alignItems: 'center', justifyContent: 'center', padding: 16 },
  readonlyText: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
})
