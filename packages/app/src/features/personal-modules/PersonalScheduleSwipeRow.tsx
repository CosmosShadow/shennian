// @arch docs/features/personal-modules.md
// @test src/__tests__/personal-schedule-screen.test.ts
import { useRef, type ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Swipeable } from 'react-native-gesture-handler'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { mobileTypography } from '../../theme/mobileTypography'

/** Like Aido TaskItemView: release a deliberate right/left swipe to act. */
export function PersonalScheduleSwipeRow({
  children,
  disabled,
  completed,
  onToggle,
  onDelete,
}: {
  children: ReactNode
  disabled: boolean
  completed: boolean
  onToggle: () => void
  onDelete: () => void
}) {
  const ref = useRef<Swipeable>(null)
  const { t } = useTranslation()
  const { colors } = useTheme()
  const action = (label: string, backgroundColor: string) => (
    <View
      // These are swipe feedback, not extra focusable actions. The row exposes
      // the equivalent labelled VoiceOver/TalkBack actions even while closed.
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.action, { backgroundColor }]}
    >
      <Text style={[mobileTypography.compactAction, { color: '#ffffff' }]}>{label}</Text>
    </View>
  )
  return (
    <Swipeable
      ref={ref}
      enabled={!disabled}
      friction={1}
      leftThreshold={56}
      rightThreshold={56}
      dragOffsetFromLeftEdge={20}
      dragOffsetFromRightEdge={20}
      overshootLeft={false}
      overshootRight={false}
      renderLeftActions={() =>
        action(
          t(completed ? 'personal_restore' : 'personal_complete'),
          completed ? colors.brand : colors.successText,
        )
      }
      renderRightActions={() => action(t('delete'), colors.errorText)}
      onSwipeableOpen={(direction) => {
        ref.current?.close()
        if (!disabled) (direction === 'left' ? onToggle : onDelete)()
      }}
    >
      {children}
    </Swipeable>
  )
}
const styles = StyleSheet.create({
  action: { minWidth: 100, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
})
