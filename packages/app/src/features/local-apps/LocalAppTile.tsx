import { ActionIconButton } from '../../components/ActionIconButton'
// @arch docs/architecture/local-apps.md
// @test src/__tests__/interactive-content-session.test.ts
import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
export function LocalAppTile({
  title,
  machineName,
  testID,
  removeLabel,
  moreLabel,
  menuOpen,
  colors,
  preview,
  width,
  onOpen,
  onMore,
  onRemove,
  shortcutLabel,
  onToggleShortcut,
}: {
  preview?: ReactNode
  width?: number
  shortcutLabel?: string
  onToggleShortcut?(): void
  title: string
  machineName: string
  testID: string
  removeLabel: string
  moreLabel: string
  menuOpen: boolean
  colors: { surface: string; brand: string; text: string; textMuted: string }
  onOpen(): void
  onMore(): void
  onRemove(): void
}) {
  return (
    <View style={{ width: width ?? '47%', gap: 8, marginBottom: 8, zIndex: menuOpen ? 10 : 0 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        testID={testID}
        onPress={onOpen}
        style={{ gap: 10 }}
      >
        <View
          style={{
            height: (width ?? 160) * 1.32,
            borderRadius: 18,
            overflow: 'hidden',
            backgroundColor: colors.surface,
            borderWidth: 0.5,
            borderColor: colors.textMuted + '26',
          }}
        >
          {preview ?? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons
                name="code-slash-outline"
                size={30}
                color={colors.brand}
                accessible={false}
              />
            </View>
          )}
        </View>
        <View style={{ paddingHorizontal: 2, gap: 5 }}>
          <Text
            numberOfLines={2}
            style={{ color: colors.text, fontSize: 15, lineHeight: 21, fontWeight: '600' }}
          >
            {title}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Ionicons
              name="desktop-outline"
              size={12}
              color={colors.textMuted}
              accessible={false}
            />
            <Text numberOfLines={1} style={{ flex: 1, color: colors.textMuted, fontSize: 11 }}>
              {machineName}
            </Text>
          </View>
        </View>
      </Pressable>
      <ActionIconButton icon="more" color={colors.text}
        label={moreLabel + ' ' + title}
        expanded={menuOpen}
        onPress={onMore}
        surface
        style={{ position: 'absolute', top: 4, right: 4 }}
       />
      {menuOpen && (
        <View
          style={{
            position: 'absolute',
            right: 0,
            top: 56,
            minWidth: 132,
            backgroundColor: colors.surface,
            borderRadius: 16,
            padding: 4,
            shadowColor: '#000',
            shadowOpacity: 0.12,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 4 },
            elevation: 4,
          }}
        >
          {shortcutLabel && onToggleShortcut ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={shortcutLabel}
              onPress={onToggleShortcut}
              style={{ padding: 12 }}
            >
              <Text style={{ color: colors.text }}>{shortcutLabel}</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={removeLabel}
            onPress={onRemove}
            style={{ padding: 12 }}
          >
            <Text style={{ color: colors.text }}>{removeLabel}</Text>
          </Pressable>
        </View>
      )}
    </View>
  )
}
