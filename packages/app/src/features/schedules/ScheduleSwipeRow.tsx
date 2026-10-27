// @arch docs/features/conversation-schedules.md
import { useRef, type ReactNode } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { Swipeable } from 'react-native-gesture-handler'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { mobileTypography } from '../../theme/mobileTypography'

/** Swipe shortcuts supplement the same actions in the expanded task. */
export function ScheduleSwipeRow({ children, disabled, paused, canPause, onToggle, onDelete }: {
  children: ReactNode; disabled: boolean; paused: boolean; canPause: boolean
  onToggle: () => void; onDelete: () => void
}) {
  const ref = useRef<Swipeable>(null)
  const { t } = useTranslation()
  const { colors } = useTheme()
  const invoke = (action: () => void) => { ref.current?.close(); action() }
  if (Platform.OS === 'web') return <>{children}</>
  return <Swipeable ref={ref} enabled={!disabled} overshootRight={false} renderRightActions={() =>
    <View style={styles.actions}>
      {canPause ? <Pressable accessibilityRole="button" disabled={disabled} onPress={() => invoke(onToggle)}
        style={[styles.action, { backgroundColor: colors.surfaceHover }]}>
        <Text style={[mobileTypography.body, { color: colors.text }]}>{t(paused ? 'schedules_resume' : 'schedules_pause')}</Text>
      </Pressable> : null}
      <Pressable accessibilityRole="button" disabled={disabled} onPress={() => invoke(onDelete)}
        style={[styles.action, { backgroundColor: colors.surface }]}>
        <Text style={[mobileTypography.body, { color: colors.errorText }]}>{t('delete')}</Text>
      </Pressable>
    </View>
  }>{children}</Swipeable>
}
const styles = StyleSheet.create({
  actions: { flexDirection: 'row' },
  action: { minWidth: 76, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center' },
})
