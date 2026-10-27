import { RecoverableSection } from '../../../components/RecoverableSection'
// @arch docs/architecture/app/chat-composer-keyboard.md
// @arch docs/features/network-rooms/ui.md#五web--desktop-web
// @test src/__tests__/room-conversation-screen.test.ts

import { useEffect, useState, type ReactNode, type RefObject } from 'react'
import { Platform, StyleSheet, TextInput, View } from 'react-native'
import type { TextInputProps } from 'react-native'
import type { Colors } from '../../../hooks/useTheme'
import {
  focusDesktopComposerBlankArea,
  observeDesktopComposerInputFocus,
} from '../../desktop-chat/desktopComposerFocus'
import { desktopComposerMetrics } from '../../desktop-shell/desktopDesignTokens'
import {
  COMPOSER_TEXT_INPUT_MAX_HEIGHT,
  COMPOSER_TEXT_INPUT_MIN_HEIGHT,
  getComposerTextInputBounds,
  resolveComposerInputStyleHeight,
  resolveComposerTextInputHeight,
} from '../utils/composerLayout'

type Props = {
  inputStyle?: TextInputProps['style']
  value: string
  onChangeText: (value: string) => void
  selection?: TextInputProps['selection']
  onSelectionChange?: TextInputProps['onSelectionChange']
  inputRef?: RefObject<TextInput | null>
  inputFocused: boolean
  onFocus: () => void
  onBlur: () => void
  placeholder: string
  colors: Colors
  isDark: boolean
  leftActions?: ReactNode
  rightActions?: ReactNode
  testID?: string
  maxLength?: number
  compact?: boolean
  onSubmitEditing?: () => void
  blurOnSubmit?: boolean
  editable?: boolean
  caretHidden?: boolean
  accessibilityLabel?: string
  desktop?: boolean
}

export function ComposerInputCard(props: Props) {
  return <RecoverableSection scope="composer"><ComposerInputContent {...props} /></RecoverableSection>
}

function ComposerInputContent({
  inputStyle,
  value,
  onChangeText,
  selection,
  onSelectionChange,
  inputRef,
  inputFocused,
  onFocus,
  onBlur,
  placeholder,
  colors,
  isDark,
  leftActions,
  rightActions,
  testID,
  maxLength,
  compact = false,
  onSubmitEditing,
  blurOnSubmit,
  editable = true,
  caretHidden = false,
  accessibilityLabel,
  desktop = false,
}: Props) {
  const lineHeight = StyleSheet.flatten(inputStyle)?.lineHeight ?? (compact ? 19 : 20)
  const { minHeight: minInputHeight, maxHeight: maxInputHeight } = desktop
    ? { minHeight: desktopComposerMetrics.inputMinHeight, maxHeight: desktopComposerMetrics.inputMaxHeight }
    : getComposerTextInputBounds(compact, lineHeight)
  const [nativeInputHeight, setNativeInputHeight] = useState(minInputHeight)
  const displayedInputHeight = resolveComposerTextInputHeight({ contentHeight: nativeInputHeight, value, compact, lineHeight })
  const inputHeight = resolveComposerInputStyleHeight(Platform.OS, value, displayedInputHeight)

  useEffect(() => {
    if (Platform.OS === 'web') return
    if (value.length === 0) setNativeInputHeight(minInputHeight)
  }, [minInputHeight, value])

  useEffect(() => {
    if (!desktop || Platform.OS !== 'web' || !inputRef?.current) return
    const node = inputRef.current as unknown as HTMLTextAreaElement
    node.style.resize = 'none'
    node.style.height = '0px'
    node.style.height = `${Math.max(minInputHeight, Math.min(node.scrollHeight, maxInputHeight))}px`
  }, [desktop, inputRef, value, minInputHeight, maxInputHeight])

  useEffect(() => {
    if (!desktop || Platform.OS !== 'web' || !inputRef?.current) return
    const node = inputRef.current as unknown as HTMLTextAreaElement
    return observeDesktopComposerInputFocus(node, (focused) => {
      if (!focused) onBlur()
    })
  }, [desktop, inputRef, onBlur])

  return (
    <View
      onPointerDown={desktop && editable ? event => focusDesktopComposerBlankArea(event, () => inputRef?.current?.focus()) : undefined}
      style={[
        styles.card,
        compact && styles.cardCompact,
        desktop && styles.cardDesktop,
        {
          borderColor: inputFocused
            ? desktop ? colors.brand : `${colors.brand}80`
            : desktop ? colors.border
              : isDark ? colors.border
                : '#e0e0e0',
          backgroundColor: colors.bg,
          shadowColor: '#000',
        },
        inputFocused && styles.cardFocused,
        inputFocused && desktop && styles.cardFocusedDesktop,
      ]}
    >
      {/* Restored drafts and dictation can overflow before native measurement catches up. */}
      <TextInput
        testID={testID}
        ref={inputRef}
        style={[
          styles.input,
          compact && styles.inputCompact,
          desktop && styles.inputDesktop,
          inputStyle,
          {
            color: colors.text,
            minHeight: minInputHeight,
            maxHeight: maxInputHeight,
            height: inputHeight,
          },
        ]}
        placeholder={placeholder}
        placeholderTextColor={desktop ? colors.textSecondary : colors.textTertiary}
        value={value}
        onFocus={onFocus}
        onBlur={onBlur}
        onChangeText={onChangeText}
        onContentSizeChange={(event) => {
          if (Platform.OS === 'web') return
          setNativeInputHeight(
            resolveComposerTextInputHeight({
              contentHeight: event.nativeEvent.contentSize.height,
              value,
              compact,
              lineHeight,
            }),
          )
        }}
        selection={selection}
        onSelectionChange={onSelectionChange}
        onSubmitEditing={onSubmitEditing}
        blurOnSubmit={blurOnSubmit}
        editable={editable}
        caretHidden={caretHidden}
        accessibilityLabel={accessibilityLabel}
        multiline
        maxLength={maxLength}
        scrollEnabled
        textAlignVertical="top"
        disableFullscreenUI={Platform.OS === 'android'}
      />
      <View style={[styles.toolbar, compact && styles.toolbarCompact, desktop && styles.toolbarDesktop]}>
        <View style={styles.toolbarLeft}>{leftActions}</View>
        <View style={[styles.toolbarRight, desktop && styles.toolbarRightDesktop]}>{rightActions}</View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 16,
    minHeight: 82,
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardCompact: { minHeight: 64, paddingTop: 5, paddingBottom: 4 },
  cardDesktop: {
    minHeight: desktopComposerMetrics.minHeight,
    borderRadius: desktopComposerMetrics.radius,
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 2,
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 0,
  },
  cardFocused: { shadowOpacity: 0.1, shadowRadius: 8, elevation: 3 },
  cardFocusedDesktop: { shadowOpacity: 0.08, shadowRadius: 6, elevation: 0 },
  input: {
    minHeight: COMPOSER_TEXT_INPUT_MIN_HEIGHT,
    maxHeight: COMPOSER_TEXT_INPUT_MAX_HEIGHT,
    paddingHorizontal: 0,
    paddingVertical: 2,
    fontSize: 14,
    lineHeight: 20,
  },
  inputCompact: { minHeight: 24, maxHeight: 96, lineHeight: 19 },
  inputDesktop: { paddingTop: 3, paddingBottom: 1 },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    gap: 12,
  },
  toolbarCompact: { marginTop: 4 },
  toolbarDesktop: { minHeight: desktopComposerMetrics.toolbarHeight, marginTop: 0, gap: 8 },
  toolbarLeft: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    flex: 1,
    minWidth: 0,
  },
  toolbarRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toolbarRightDesktop: { gap: 0 },
})
