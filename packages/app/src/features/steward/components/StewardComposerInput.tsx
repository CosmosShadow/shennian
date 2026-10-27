import { ComposerVoiceControl } from '../../chat/components/ComposerVoiceControl'
import { ComposerIconButton } from '../../chat/components/ComposerIconButton'
import { HoldToSpeak } from '../holdToSpeak'
// @arch docs/features/personal-modules.md
// @test src/__tests__/personal-modules.test.ts
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import type { Colors } from '../../../hooks/useTheme'
import type { VoiceComposerPhase } from '../../chat/utils/voice'

const touchHeight = Platform.OS === 'android' ? 48 : 44

export function StewardComposerInput(props: {
  placeholder?: string
  testID?: string
  selection?: TextInputProps['selection']
  onSelectionChange?: TextInputProps['onSelectionChange']
  input: string
  onChange: (value: string) => void
  inputRef: RefObject<TextInput | null>
  onFocus: () => void
  onBlur: () => void
  actions: ReactNode
  colors: Colors
  phase: VoiceComposerPhase
  meterLevel?: number
  disabled: boolean
  canSend: boolean
  sending: boolean
  onSend: () => unknown
  onStart: (held: () => boolean) => Promise<boolean>
  onDictationStop: () => Promise<unknown>
  onRelease: () => Promise<unknown>
  onCancel: () => unknown
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const latest = useRef(props)
  latest.current = props
  const [hold] = useState(
    () =>
      new HoldToSpeak({
        start: (held) => latest.current.onStart(held),
        send: () => latest.current.onRelease(),
        cancel: () => latest.current.onCancel(),
      }),
  )
  const tapping = useRef(false)
  const previousPhase = useRef(props.phase)
  useEffect(() => {
    if (props.phase === 'error' || (props.phase === 'idle' && previousPhase.current === 'listening')) tapping.current = false
    previousPhase.current = props.phase
  }, [props.phase])
  useEffect(() => () => { if (tapping.current) { tapping.current = false; latest.current.onCancel() } }, [])
  const origin = useRef({ x: 0, y: 0 })
  const moved = useRef(false)
  useEffect(() => () => hold.dispose(), [hold])
  const listening = props.phase === 'listening'
  const busy = props.phase === 'refining'
  function start() {
    if (props.disabled || busy || hold.active || tapping.current || listening) return
    Keyboard.dismiss()
    hold.start()
  }
  function release(cancel = false) {
    void hold.release(cancel).catch(() => latest.current.onCancel())
  }
  return (
    <View>
      {props.phase === 'error' ? (
        <Text accessibilityRole="alert" style={{ color: props.colors.errorText, padding: 8 }}>
          {t('voice_recording_failed')}
        </Text>
      ) : null}
      <View
        testID="floating-composer-pill"
        style={[
          styles.row,
          {
            backgroundColor: props.colors.bg,
            borderColor: props.colors.separator,
          },
        ]}
      >
        <View style={styles.plus}>{props.actions}</View>
        <View style={styles.field}>
          {editing ? (
            <TextInput
              testID={props.testID ?? 'chat-input'}
              ref={props.inputRef}
              autoFocus
              multiline={false}
              returnKeyType="send"
              submitBehavior="submit"
              onSubmitEditing={() => {
                if (props.canSend && !props.sending) void props.onSend()
              }}
              maxLength={4000}
              selection={props.selection}
              onSelectionChange={props.onSelectionChange}
              value={props.input}
              onChangeText={props.onChange}
              placeholder={props.placeholder ?? t('steward_placeholder')}
              placeholderTextColor={props.colors.textMuted}
              accessibilityLabel={props.placeholder ?? t('steward_placeholder')}
              onFocus={props.onFocus}
              onBlur={() => {
                setEditing(false)
                props.onBlur()
              }}
              style={[styles.textInput, { color: props.colors.text }]}
            />
          ) : (
            <Pressable
              testID="steward-hold-input"
              accessibilityRole="button"
              accessibilityLabel={props.placeholder ?? t('steward_placeholder')}
              accessibilityHint={t('steward_hold_hint')}
              accessibilityActions={[
                { name: 'activate', label: t('steward_type') },
                { name: 'longpress', label: t('voice_input') },
              ]}
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === 'longpress') {
                  if (hold.active) release()
                  else start()
                } else setEditing(true)
              }}
              onPressIn={(event) => {
                origin.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY }
                moved.current = false
              }}
              onTouchMove={(event) => {
                if (
                  Math.abs(event.nativeEvent.pageX - origin.current.x) > 60 ||
                  Math.abs(event.nativeEvent.pageY - origin.current.y) > 60
                ) {
                  moved.current = true
                  release(true)
                }
              }}
              delayLongPress={300}
              onLongPress={start}
              onPress={() => {
                if (!moved.current && !hold.active && !listening && !busy) setEditing(true)
              }}
              onPressOut={() => release(moved.current)}
              onTouchCancel={() => release(true)}
              style={styles.hold}
            >
              <Text
                numberOfLines={1}
                ellipsizeMode={listening && tapping.current ? 'head' : 'tail'}
                style={[
                  styles.text,
                  { color: props.input ? props.colors.text : props.colors.textMuted },
                ]}
              >
                {listening
                  ? tapping.current ? props.input || t('listening_waiting') : t('personal_release_voice')
                  : busy
                    ? t('voice_optimizing_inline')
                    : props.input || props.placeholder || t('steward_placeholder')}
              </Text>
            </Pressable>
          )}

        </View>
        {Platform.OS !== 'web' ? <ComposerVoiceControl phase={props.phase} meterLevel={props.meterLevel} colors={props.colors} disabled={props.disabled || hold.active}
          onStart={async () => {
            if (tapping.current || hold.active) return
            tapping.current = true
            Keyboard.dismiss()
            try { if (!(await props.onStart(() => tapping.current))) tapping.current = false }
            catch { tapping.current = false; props.onCancel() }
          }}
          onStop={async () => {
            if (!tapping.current) { release(); return }
            tapping.current = false
            try { await props.onDictationStop() } catch { props.onCancel() }
          }} /> : null}
        {props.canSend && !listening && !busy ? <ComposerIconButton icon="arrow-up" accessibilityLabel={t('send')} colors={props.colors} emphasized busy={props.sending} testID="steward-send-btn" disabled={props.disabled || props.sending} onPress={() => void props.onSend()} /> : null}
      </View>
    </View>
  )
}
const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    paddingLeft: 3,
    paddingRight: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  plus: { minWidth: touchHeight, minHeight: touchHeight, justifyContent: 'center', alignItems: 'center' },
  field: {
    flex: 1,
    minHeight: touchHeight,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 3,
  },
  hold: { flex: 1, minHeight: touchHeight, justifyContent: 'center', paddingVertical: 8 },
  text: { fontSize: 16, lineHeight: 22 },
  textInput: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    minHeight: touchHeight,
    height: touchHeight,
    maxHeight: touchHeight,
    paddingVertical: 10,
  },
})
