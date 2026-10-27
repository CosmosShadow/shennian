// @arch docs/design/desktop/unified-desktop-control.md
// @test packages/app/src/__tests__/desktop-composer-controls.test.ts

import Feather from '@expo/vector-icons/Feather'
import { useEffect, type ReactNode, type RefObject } from 'react'
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import { useTranslation } from 'react-i18next'
import { desktopComposerMetrics } from '../desktop-shell/desktopDesignTokens'
import type { Colors } from '../../hooks/useTheme'
import type { UploadTask } from '../chat/hooks/useChatUploads'
import { insertPlainComposerNewline } from '../chat/utils/composerNewline'
import { isVoiceComposerInputReadOnly, type VoiceComposerPhase } from '../chat/utils/voice'
import { ComposerInputCard } from '../chat/components/ComposerInputCard'
import { shouldShowChatStopButton } from '../chat/utils/screen'
import {
  DESKTOP_CHAT_COMPOSER_BOTTOM_GUTTER,
  DESKTOP_CHAT_COMPOSER_SHELL_WIDTH,
} from '../desktop-shell/desktopWorkspaceMetrics'
import { DesktopComposerIconButton } from './DesktopComposerIconButton'
import { DesktopComposerVoiceControl } from './DesktopComposerVoiceControl'
import {
  resolveDesktopComposerKeyboardAction,
  resolveDesktopComposerPrimaryAction,
} from './desktopComposerControlState'

type Props = {
  input: string
  onInputChange: (value: string) => void
  inputFocused: boolean
  setInputFocused: (focused: boolean) => void
  textInputRef: RefObject<TextInput | null>
  isTyping: boolean
  isSending: boolean
  isStopping: boolean
  canStop?: boolean
  uploadTasks: UploadTask[]
  onCancelUpload: (taskId: string) => void
  onPreviewUpload?: (task: UploadTask) => void
  onWebPaste?: (event: ClipboardEvent) => boolean
  canSend: boolean
  reconnectAvailable: boolean
  sendDisabledReason?: string | null
  placeholder?: string
  editingQueued?: boolean
  onCancelQueuedEdit?: () => void
  onSend: () => void | Promise<void>
  onAbort: () => void | Promise<void>
  voicePhase: VoiceComposerPhase
  onVoiceStart: () => void | Promise<void>
  onVoiceStop: (options?: { skipRefine?: boolean }) => void | Promise<unknown>
  voiceDisabled: boolean
  voiceDisabledReason?: string | null
  voiceMeterLevel?: number
  voicePreviewPhase?: VoiceComposerPhase | null
  contextMenu?: ReactNode
  contextControls?: ReactNode
  toolbarActions: ReactNode[]
  colors: Colors
  isDark: boolean
  bottomInset: number
}

function CircularProgress({ progress, color }: { progress: number; color: string }) {
  const size = 24
  const strokeWidth = 2.5
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  return (
    <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
      <Circle
        cx={12}
        cy={12}
        r={radius}
        stroke="rgba(255,255,255,0.3)"
        strokeWidth={strokeWidth}
        fill="none"
      />
      <Circle
        cx={12}
        cy={12}
        r={radius}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={circumference * (1 - Math.min(progress, 1))}
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

function uploadIcon(task: UploadTask): keyof typeof Feather.glyphMap {
  if (task.kind === 'image') return 'image'
  if (task.kind === 'folder') return 'folder'
  if (isVideoUploadTask(task)) return 'film'
  return 'file'
}

export function DesktopChatComposer({
  input,
  onInputChange,
  inputFocused,
  setInputFocused,
  textInputRef,
  isTyping,
  isSending,
  isStopping,
  canStop,
  uploadTasks,
  onCancelUpload,
  onPreviewUpload,
  onWebPaste,
  canSend,
  reconnectAvailable,
  sendDisabledReason,
  placeholder,
  editingQueued = false,
  onCancelQueuedEdit,
  onSend,
  onAbort,
  voicePhase,
  onVoiceStart,
  onVoiceStop,
  voiceDisabled,
  voiceDisabledReason,
  voicePreviewPhase,
  contextMenu,
  contextControls,
  toolbarActions,
  colors,
  isDark,
  bottomInset,
}: Props) {
  const { t } = useTranslation()
  const primaryAction = resolveDesktopComposerPrimaryAction({ canSend, reconnectAvailable })

  const resize = () => {
    if (!textInputRef.current) return
    const node = textInputRef.current as unknown as HTMLTextAreaElement
    node.style.height = '0px'
    node.style.height = `${Math.max(desktopComposerMetrics.inputMinHeight, Math.min(node.scrollHeight, desktopComposerMetrics.inputMaxHeight))}px`
  }

  useEffect(() => {
    if (!textInputRef.current) return
    const node = textInputRef.current as unknown as HTMLTextAreaElement
    node.style.outline = 'none'
    node.style.resize = 'none'
    node.style.height = `${desktopComposerMetrics.inputMinHeight}px`
  }, [textInputRef])

  useEffect(() => {
    if (!textInputRef.current || !onWebPaste) return
    const node = textInputRef.current as unknown as HTMLTextAreaElement
    const handlePaste = (event: Event) => onWebPaste(event as ClipboardEvent)
    node.addEventListener('paste', handlePaste)
    return () => node.removeEventListener('paste', handlePaste)
  }, [onWebPaste, textInputRef])

  useEffect(() => {
    if (!textInputRef.current) return
    const node = textInputRef.current as unknown as HTMLTextAreaElement
    const handleKeyDown = (event: KeyboardEvent) => {
      const action = resolveDesktopComposerKeyboardAction(event)
      if (action === 'newline') {
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
          resize()
        })
        return
      }
      if (action !== 'submit') return
      event.preventDefault()
      event.stopPropagation()
      if (primaryAction.enabled) void onSend()
    }
    node.addEventListener('keydown', handleKeyDown)
    return () => node.removeEventListener('keydown', handleKeyDown)
  }, [onInputChange, onSend, primaryAction.enabled, textInputRef])

  useEffect(() => resize(), [input, textInputRef])

  const voiceInputReadOnly = isVoiceComposerInputReadOnly(voicePhase)

  const handleVoiceStart = () => {
    textInputRef.current?.blur()
    setInputFocused(false)
    return onVoiceStart()
  }

  useEffect(() => {
    if (!voiceInputReadOnly) return
    textInputRef.current?.blur()
    setInputFocused(false)
  }, [setInputFocused, textInputRef, voiceInputReadOnly])

  return (
    <View
      style={[
        styles.root,
        {
          paddingBottom: Math.max(bottomInset, DESKTOP_CHAT_COMPOSER_BOTTOM_GUTTER),
          maxWidth: DESKTOP_CHAT_COMPOSER_SHELL_WIDTH,
        },
      ]}
      testID="desktop-chat-composer"
    >
      {editingQueued ? (
        <View
          style={[
            styles.editBanner,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.editLabel}>
            <Feather name="edit-3" size={14} color={colors.brand} />
            <Text style={[styles.editText, { color: colors.textSecondary }]}>
              {t('msg_editing_queued')}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('cancel')}
            onPress={onCancelQueuedEdit}
            style={styles.editCancel}
          >
            <Text style={[styles.editCancelText, { color: colors.brand }]}>{t('cancel')}</Text>
          </Pressable>
        </View>
      ) : null}

      {uploadTasks.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.uploads}
        >
          {uploadTasks.map((task) => (
            <View
              key={task.id}
              style={[
                styles.upload,
                {
                  backgroundColor: `${colors.brand}10`,
                  borderColor: `${colors.brand}25`,
                },
              ]}
            >
              <Pressable
                style={styles.uploadBody}
                onPress={() => onPreviewUpload?.(task)}
                disabled={!onPreviewUpload}
                accessibilityRole="button"
                accessibilityLabel={task.name}
              >
                {task.kind === 'image' && task.previewData ? (
                  <View>
                    <Image
                      source={{
                        uri: /^(?:data:|file:|content:|blob:)/i.test(task.previewData)
                          ? task.previewData
                          : `data:${task.mimeType};base64,${task.previewData}`,
                      }}
                      style={styles.thumbnail}
                    />
                    {task.progress < 1 ? (
                      <View style={styles.progress}>
                        <CircularProgress progress={task.progress} color="#fff" />
                      </View>
                    ) : null}
                  </View>
                ) : (
                  <View style={[styles.uploadIcon, { backgroundColor: colors.surface }]}>
                    <Feather name={uploadIcon(task)} size={16} color={colors.textSecondary} />
                  </View>
                )}
                <View style={styles.uploadMeta}>
                  <Text style={[styles.uploadName, { color: colors.text }]} numberOfLines={1}>
                    {task.name}
                  </Text>
                  {task.progress < 1 ? (
                    <View style={[styles.track, { backgroundColor: `${colors.brand}15` }]}>
                      <View
                        style={[
                          styles.fill,
                          {
                            width: `${task.progress * 100}%` as `${number}%`,
                            backgroundColor: colors.brand,
                          },
                        ]}
                      />
                    </View>
                  ) : null}
                </View>
              </Pressable>
              <Pressable
                style={styles.uploadCancel}
                onPress={() => onCancelUpload(task.id)}
                accessibilityRole="button"
                accessibilityLabel={t('cancel')}
              >
                <Feather name="x" size={14} color={colors.textTertiary} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}

      <ComposerInputCard
        inputStyle={desktopComposerMetrics.input}
        testID="chat-input"
        inputRef={textInputRef}
        value={input}
        onChangeText={(next) => {
          if (voiceInputReadOnly) return
          onInputChange(next)
          resize()
        }}
        inputFocused={inputFocused}
        onFocus={() => {
          setInputFocused(true)
          if (voiceInputReadOnly) void onVoiceStop({ skipRefine: true })
        }}
        onBlur={() => setInputFocused(false)}
        placeholder={placeholder ?? t('input_placeholder')}
        colors={colors}
        isDark={isDark}
        desktop
        maxLength={4000}
        leftActions={
          <>
            {contextMenu ? <View style={styles.contextMenu}>{contextMenu}</View> : null}
            {toolbarActions}
          </>
        }
        rightActions={
          <>
            {contextControls}
            <DesktopComposerVoiceControl
              phase={voicePreviewPhase ?? voicePhase}
              onStart={handleVoiceStart}
              onStop={onVoiceStop}
              disabled={voiceDisabled}
              disabledReason={voiceDisabledReason}
              colors={colors}
            />
            {shouldShowChatStopButton({ isTyping, canSend, canStop }) ? (
              <DesktopComposerIconButton
                testID="stop-btn"
                icon="square"
                variant="primary"
                busy={isStopping}
                colors={colors}
                accessibilityLabel={t('stop')}
                onPress={() => void onAbort()}
              />
            ) : isSending ? (
              <DesktopComposerIconButton
                icon="send"
                variant="primary"
                busy
                colors={colors}
                accessibilityLabel={t('desktop_composer_sending')}
              />
            ) : (
              <DesktopComposerIconButton
                testID="send-btn"
                icon={primaryAction.kind === 'reconnect' ? 'refresh-cw' : 'send'}
                variant={
                  primaryAction.kind === 'send' && primaryAction.enabled ? 'primary' : 'neutral'
                }
                colors={colors}
                disabled={!primaryAction.enabled}
                accessibilityLabel={
                  primaryAction.kind === 'reconnect'
                    ? (sendDisabledReason ?? t('relay_disconnected_retry'))
                    : primaryAction.enabled
                      ? t('send')
                      : (sendDisabledReason ??
                        t(
                          uploadTasks.some((task) => task.progress < 1)
                            ? 'desktop_composer_wait_upload'
                            : 'desktop_composer_enter_message',
                        ))
                }
                accessibilityHint={
                  primaryAction.kind === 'reconnect' ? t('relay_status_action_hint') : undefined
                }
                onPress={() => void onSend()}
              />
            )}
          </>
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { width: '100%', alignSelf: 'center', paddingTop: 12, paddingHorizontal: 16 },
  editBanner: {
    minHeight: 44,
    marginBottom: 6,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  editLabel: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  editText: { fontSize: 13, lineHeight: 19 },
  editCancel: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  editCancelText: { fontSize: 13, lineHeight: 19, fontWeight: '600' },
  uploads: { gap: 6, marginBottom: 6, paddingRight: 4 },
  upload: {
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
  uploadBody: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  thumbnail: { width: 44, height: 44, borderRadius: 10, backgroundColor: '#ddd' },
  progress: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  uploadIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  uploadMeta: { flex: 1, gap: 6, minWidth: 0 },
  uploadName: { fontSize: 13, fontWeight: '500' },
  track: { height: 3, borderRadius: 1.5, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 1.5 },
  uploadCancel: {
    width: 44,
    height: 44,
    marginTop: -2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contextMenu: { position: 'absolute', left: 0, bottom: 44, zIndex: 20 },
})
