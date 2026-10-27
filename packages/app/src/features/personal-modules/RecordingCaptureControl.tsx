// @arch docs/features/listening.md
// @test src/__tests__/listening-controls.test.ts
import { ActivityIndicator, Platform, Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'

/** Icon-only action retains an accessible start/stop label. */
export function RecordingCaptureControl({
  active,
  busy,
  toggle,
}: {
  active: boolean
  busy: boolean
  toggle: () => void
}) {
  const { t } = useTranslation(),
    { colors } = useTheme(),
    insets = useSafeAreaInsets()
  const actionColor = active ? colors.errorText : colors.groupedSurface
  const foreground = active ? colors.bg : colors.text
  return (
    <View
      testID="recording-bottom-control"
      style={{
        paddingHorizontal: 24,
        paddingTop: 16,
        paddingBottom: Math.max(16, insets.bottom),
        backgroundColor: colors.surfaceHover,
        alignItems: 'center',
        gap: 12,
      }}
    >
      <Pressable
        testID="listening-toggle"
        accessibilityRole="button"
        accessibilityLabel={t(active ? 'personal_stop' : 'personal_start')}
        accessibilityState={{ disabled: busy || Platform.OS === 'web', busy }}
        disabled={busy || Platform.OS === 'web'}
        onPress={toggle}
        style={({ pressed }) => ({
          width: 64,
          height: 64,
          borderRadius: 32,
          borderWidth: 1,
          borderColor: active ? colors.errorText : colors.border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          backgroundColor: actionColor,
          opacity: busy || Platform.OS === 'web' ? 0.5 : pressed ? 0.8 : 1,
        })}
      >
        {busy ? (
          <ActivityIndicator color={foreground} />
        ) : active ? (
          <View style={{ width: 18, height: 18, borderRadius: 4, backgroundColor: foreground }} />
        ) : (
          <View accessible={false} style={{ width: 22, height: 24, alignItems: 'center' }}>
            <View
              style={{
                width: 10,
                height: 16,
                borderWidth: 1.7,
                borderColor: foreground,
                borderRadius: 6,
              }}
            />
            <View
              style={{
                position: 'absolute',
                top: 9,
                width: 18,
                height: 11,
                borderWidth: 1.7,
                borderTopWidth: 0,
                borderColor: foreground,
                borderBottomLeftRadius: 10,
                borderBottomRightRadius: 10,
              }}
            />
            <View
              style={{
                position: 'absolute',
                top: 20,
                width: 1.7,
                height: 4,
                backgroundColor: foreground,
              }}
            />
          </View>
        )}
      </Pressable>
    </View>
  )
}
