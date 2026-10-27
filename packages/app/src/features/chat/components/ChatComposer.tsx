import { StewardComposerInput } from '../../steward/components/StewardComposerInput'
// @arch docs/architecture/app/modular-features.md#聊天-feature
// @arch docs/architecture/app/chat-composer-keyboard.md
// @arch docs/architecture/app/chat-voice-draft.md

import { useEffect, type ReactNode, type RefObject } from 'react'
import {
  Image,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import Feather from '@expo/vector-icons/Feather'
import { useTranslation } from 'react-i18next'
import { useChatFontSize } from '../../../hooks/useChatFontSize'
import type { Colors } from '../../../hooks/useTheme'
import type { UploadTask } from '../hooks/useChatUploads'
import { insertPlainComposerNewline } from '../utils/composerNewline'
import { clampComposerTextInputHeight } from '../utils/composerLayout'
import { isVoiceComposerInputReadOnly, type VoiceComposerPhase } from '../utils/voice'
import { ComposerInputCard } from './ComposerInputCard'
import { ComposerIconButton } from './ComposerIconButton'
import { ComposerVoiceControl } from './ComposerVoiceControl'
import { shouldShowChatStopButton } from '../utils/screen'

function CircularProgress({
  progress,
  size,
  color,
}: {
  progress: number
  size: number
  color: string
}) {
  const strokeWidth = 2.5
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference * (1 - Math.min(progress, 1))

  return (
    <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="rgba(255,255,255,0.3)"
        strokeWidth={strokeWidth}
        fill="none"
      />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round"
      />
    </Svg>
  )
}

function isVideoUploadTask(task: UploadTask): boolean {
  return (
    task.mimeType.toLowerCase().startsWith('video/') ||
    /\.(?:mp4|m4v|mov|webm|avi)$/i.test(task.name)
  )
}

function getUploadTaskIcon(task: UploadTask): keyof typeof Feather.glyphMap {
  if (task.kind === 'image') return 'image'
  if (task.kind === 'folder') return 'folder'
  if (isVideoUploadTask(task)) return 'film'
  return 'file'
}

type Props = {
  stewardMode?: boolean
  onHoldStart?: (held: () => boolean) => Promise<boolean>
  onHoldRelease?: () => Promise<unknown>
  input: string
  onInputChange: (value: string) => void
  inputFocused: boolean
  setInputFocused: (focused: boolean) => void
  textInputRef: RefObject<TextInput | null>
  isTyping: boolean
  isSending: boolean
  isStopping: boolean
  canStop?: boolean
  /** The steward's conversation never shows a stop control, even mid-reply. */
  hideStopButton?: boolean
  uploadTasks: UploadTask[]
  onCancelUpload: (taskId: string) => void
  onPreviewUpload?: (task: UploadTask) => void
  onWebPaste?: (event: ClipboardEvent) => boolean
  canSend: boolean
  sendDisabledReason?: string | null
  placeholder?: string
  editingQueued?: boolean
  onCancelQueuedEdit?: () => void
  onSend: () => void | Promise<void>
  onAbort: () => void | Promise<void>
  voicePhase: VoiceComposerPhase
  onVoiceStart: () => void | Promise<void>
  onVoiceStop: (options?: { skipRefine?: boolean }) => void | Promise<unknown>
  onVoiceCancel: () => void | Promise<void>
  voiceDisabled: boolean
  voiceMeterLevel?: number
  voicePreviewPhase?: VoiceComposerPhase | null
  contextMenu?: ReactNode
  toolbarActions: ReactNode[]
  colors: Colors
  isDark: boolean
  bottomInset: number
}

export function ChatComposer({
  stewardMode = false, onHoldStart, onHoldRelease,
  input,
  onInputChange,
  inputFocused,
  setInputFocused,
  textInputRef,
  isTyping,
  isSending,
  isStopping,
  canStop,
  hideStopButton = false,
  uploadTasks,
  onCancelUpload,
  onPreviewUpload,
  onWebPaste,
  canSend,
  sendDisabledReason,
  placeholder,
  editingQueued = false,
  onCancelQueuedEdit,
  onSend,
  onAbort,
  voicePhase,
  onVoiceStart,
  onVoiceStop,
  onVoiceCancel,
  voiceDisabled,
  voiceMeterLevel = 0,
  voicePreviewPhase,
  contextMenu,
  toolbarActions,
  colors,
  isDark,
  bottomInset,
}: Props) {
  const { typography } = useChatFontSize()
  const { t } = useTranslation()

  const resizeWebComposer = () => {
    if (Platform.OS !== 'web' || !textInputRef.current) return
    const node = textInputRef.current as unknown as HTMLTextAreaElement
    node.style.height = '0px'
    node.style.height = `${clampComposerTextInputHeight(node.scrollHeight)}px`
  }

  useEffect(() => {
    if (Platform.OS !== 'web' || !textInputRef.current) return
    const node = textInputRef.current as unknown as HTMLTextAreaElement
    node.style.outline = 'none'
    node.style.resize = 'none'
    node.style.height = '30px'
  }, [textInputRef])

  useEffect(() => {
    if (Platform.OS !== 'web' || !textInputRef.current || !onWebPaste) return
    const node = textInputRef.current as unknown as HTMLTextAreaElement
    const handlePaste = (event: Event) => {
      onWebPaste(event as ClipboardEvent)
    }
    node.addEventListener('paste', handlePaste)
    return () => node.removeEventListener('paste', handlePaste)
  }, [onWebPaste, textInputRef])

  useEffect(() => {
    if (Platform.OS !== 'web' || !textInputRef.current) return
    const node = textInputRef.current as unknown as HTMLTextAreaElement
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === 'Enter' &&
        event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.isComposing
      ) {
        // React Native Web's TextInput ultimately maps to a browser textarea. Some browsers / input
        // helpers try to continue Markdown-like ordered lists after Shift+Enter ("1." -> "2.").
        // For the composer we want a plain newline only; final Markdown is authored explicitly.
        event.preventDefault()
        event.stopPropagation()
        const next = insertPlainComposerNewline(
          node.value,
          node.selectionStart ?? node.value.length,
          node.selectionEnd ?? node.value.length,
        )
        onInputChange(next.value)
        window.requestAnimationFrame(() => {
          node.selectionStart = next.cursor
          node.selectionEnd = next.cursor
          resizeWebComposer()
        })
        return
      }
      if (
        event.key !== 'Enter' ||
        !(event.metaKey || event.ctrlKey) ||
        event.shiftKey ||
        event.altKey
      ) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      if (canSend) void onSend()
    }
    node.addEventListener('keydown', handleKeyDown)
    return () => node.removeEventListener('keydown', handleKeyDown)
  }, [canSend, onInputChange, onSend, textInputRef])

  useEffect(() => {
    resizeWebComposer()
  }, [input, textInputRef, typography.body.fontSize])

  const voiceInputReadOnly = isVoiceComposerInputReadOnly(voicePhase)

  const handleVoiceStart = () => {
    textInputRef.current?.blur()
    Keyboard.dismiss()
    setInputFocused(false)
    return onVoiceStart()
  }

  useEffect(() => {
    if (!voiceInputReadOnly) return
    textInputRef.current?.blur()
    Keyboard.dismiss()
    setInputFocused(false)
  }, [setInputFocused, textInputRef, voiceInputReadOnly])

  const effectiveVoicePhase = voicePreviewPhase ?? voicePhase

  return (
    <View style={[styles.inputBar, { paddingBottom: bottomInset || 8 }]}>
      {editingQueued ? (
        <View
          style={[
            styles.queuedEditBanner,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.queuedEditLabel}>
            <Feather name="edit-3" size={14} color={colors.brand} />
            <Text style={[styles.queuedEditText, { color: colors.textSecondary }]}>
              {t('msg_editing_queued')}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('cancel')}
            hitSlop={8}
            onPress={onCancelQueuedEdit}
            style={styles.queuedEditCancel}
          >
            <Text style={[styles.queuedEditCancelText, { color: colors.brand }]}>{t('cancel')}</Text>
          </Pressable>
        </View>
      ) : null}
      {uploadTasks.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.uploadBarContainer}
        >
          {uploadTasks.map((task) => (
            <View
              key={task.id}
              style={[
                styles.uploadBar,
                {
                  backgroundColor: `${colors.brand}10`,
                  borderColor: `${colors.brand}25`,
                },
              ]}
            >
              <Pressable
                style={styles.attachmentBody}
                onPress={() => onPreviewUpload?.(task)}
                disabled={!onPreviewUpload}
                accessibilityRole="button"
                accessibilityLabel={task.name}
                hitSlop={4}
              >
                {task.kind === 'image' && task.previewData ? (
                  <View>
                    <Image
                      source={{
                        uri: /^(?:data:|file:|content:|blob:)/i.test(task.previewData)
                          ? task.previewData
                          : `data:${task.mimeType};base64,${task.previewData}`,
                      }}
                      style={styles.attachmentThumb}
                    />
                    {task.progress < 1 && (
                      <View style={styles.thumbProgressOverlay}>
                        <CircularProgress progress={task.progress} size={24} color="#fff" />
                      </View>
                    )}
                  </View>
                ) : (
                  <View
                    style={[
                      styles.attachmentIcon,
                      {
                        backgroundColor:
                          task.kind === 'image' || isVideoUploadTask(task)
                            ? `${colors.brand}15`
                            : colors.surface,
                      },
                    ]}
                  >
                    <Feather
                      name={getUploadTaskIcon(task)}
                      size={16}
                      color={
                        task.kind === 'image' || isVideoUploadTask(task)
                          ? colors.brand
                          : colors.textSecondary
                      }
                    />
                  </View>
                )}
                <View style={styles.attachmentMeta}>
                  <Text style={[styles.uploadBarName, { color: colors.text }]} numberOfLines={1}>
                    {task.name}
                  </Text>
                  {task.progress < 1 && (
                    <View style={[styles.uploadBarTrack, { backgroundColor: `${colors.brand}15` }]}>
                      <View
                        style={[
                          styles.uploadBarFill,
                          {
                            width: `${task.progress * 100}%` as `${number}%`,
                            backgroundColor: colors.brand,
                          },
                        ]}
                      />
                    </View>
                  )}
                </View>
              </Pressable>
              <Pressable
                style={styles.uploadBarCancel}
                onPress={() => onCancelUpload(task.id)}
                hitSlop={8}
              >
                <Feather name="x" size={14} color={colors.textTertiary} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}

      {Platform.OS !== 'web' && contextMenu ? (
        <View style={[styles.nativeContextMenuWrap, stewardMode && { position: 'absolute', bottom: 74, left: 16, zIndex: 30 }]}>{contextMenu}</View>
      ) : null}
      {stewardMode && Platform.OS !== 'web' && onHoldStart && onHoldRelease ? (
        <StewardComposerInput placeholder={placeholder} input={input}
          onChange={onInputChange} inputRef={textInputRef}
          onFocus={() => setInputFocused(true)} onBlur={() => setInputFocused(false)}
          actions={toolbarActions.slice(0, 1)} colors={colors} phase={voicePhase} meterLevel={voiceMeterLevel}
          disabled={voiceDisabled} canSend={canSend} sending={isSending}
          onDictationStop={async () => { await onVoiceStop({ skipRefine: true }) }}
          onSend={onSend} onStart={onHoldStart} onRelease={onHoldRelease} onCancel={onVoiceCancel} />
      ) : <ComposerInputCard
        inputStyle={typography.body}
        testID="chat-input"
        inputRef={textInputRef}
        value={input}
        onChangeText={(next) => {
          if (voiceInputReadOnly) return
          onInputChange(next)
          resizeWebComposer()
        }}
        inputFocused={inputFocused}
        onFocus={() => {
          if (voicePhase === 'listening' || voicePhase === 'refining') void onVoiceCancel()
          setInputFocused(true)
        }}
        onBlur={() => setInputFocused(false)}
        placeholder={placeholder ?? t('input_placeholder')}
        colors={colors}
        isDark={isDark}
        maxLength={4000}
        editable
        caretHidden={voiceInputReadOnly}
        leftActions={
          <>
            {Platform.OS === 'web' && contextMenu ? <View style={styles.contextMenuWrap}>{contextMenu}</View> : null}
            {toolbarActions}
          </>
        }
        rightActions={
          <>
            <ComposerVoiceControl
              phase={effectiveVoicePhase}
              onStart={handleVoiceStart}
              onStop={onVoiceStop}
              disabled={voiceDisabled}
              meterLevel={voiceMeterLevel}
              colors={colors}
            />
            {!hideStopButton && shouldShowChatStopButton({ isTyping, canSend, canStop }) ? (
              <ComposerIconButton testID="stop-btn" icon="square" colors={colors} emphasized
                busy={isStopping} accessibilityLabel={t('agent_task_stop_action')} onPress={() => void onAbort()} />
            ) : (
              <ComposerIconButton testID="send-btn" icon="arrow-up" colors={colors}
                emphasized={canSend || isSending} busy={isSending}
                disabled={!canSend && !sendDisabledReason}
                onPress={() => void onSend()}
                accessibilityLabel={canSend ? t('send') : (sendDisabledReason ?? t('send'))}
                accessibilityHint={!canSend && sendDisabledReason ? t('relay_status_action_hint') : undefined} />
            )}
          </>
        }
      />}
    </View>
  )
}

const styles = StyleSheet.create({
  inputBar: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    width: '100%',
  },
  uploadBarContainer: {
    gap: 6,
    marginBottom: 6,
    paddingRight: 4,
  },
  queuedEditBanner: {
    minHeight: 44,
    marginBottom: 6,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  queuedEditLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  queuedEditText: {
    fontSize: 13,
    lineHeight: 19,
  },
  queuedEditCancel: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queuedEditCancelText: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  uploadBar: {
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
  attachmentBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  attachmentThumb: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#ddd',
  },
  thumbProgressOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  attachmentIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  attachmentMeta: {
    flex: 1,
    gap: 6,
    minWidth: 0,
  },
  uploadBarName: {
    fontSize: 13,
    fontWeight: '500',
  },
  uploadBarTrack: {
    height: 3,
    borderRadius: 1.5,
    overflow: 'hidden',
  },
  uploadBarFill: {
    height: '100%',
    borderRadius: 1.5,
  },
  uploadBarCancel: {
    padding: 4,
    marginTop: -2,
  },
  contextMenuWrap: {
    position: 'absolute',
    left: 0,
    bottom: 44,
    zIndex: 20,
  },
  nativeContextMenuWrap: {
    marginHorizontal: -16,
    marginBottom: 8,
  },

})
