// @arch docs/features/desktop-settings-information-architecture.md
// @test src/__tests__/desktop-settings-shell.test.ts

import type { ReactNode, ComponentProps, RefObject } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { useLocalSearchParams } from 'expo-router'
import { useTheme } from '../../hooks/useTheme'
import { useKeyboardShortcut } from '../../hooks/useKeyboardShortcut'
import {
  handleDesktopSettingsEscape,
  selectDesktopSettingsCategory,
} from './desktopSettingsCategoryInteraction'
import { desktopControlMetrics, desktopTypography } from '../desktop-shell/desktopDesignTokens'

export const DESKTOP_SETTINGS_CATEGORIES = [
  {
    id: 'general',
    labelKey: 'desktop_settings_general',
    icon: 'options-outline',
  },
  {
    id: 'account',
    labelKey: 'desktop_settings_account',
    icon: 'person-circle-outline',
  },
  {
    id: 'machines',
    labelKey: 'desktop_settings_machines',
    icon: 'desktop-outline',
  },
  {
    id: 'shortcuts',
    labelKey: 'desktop_settings_shortcuts',
    icon: 'keypad-outline',
  },
  {
    id: 'version',
    labelKey: 'desktop_settings_version_updates',
    icon: 'arrow-down-circle-outline',
  },
] as const

export type DesktopSettingsCategoryId = (typeof DESKTOP_SETTINGS_CATEGORIES)[number]['id']

export function resolveDesktopSettingsCategory(
  value: string | undefined,
): DesktopSettingsCategoryId {
  return DESKTOP_SETTINGS_CATEGORIES.some((category) => category.id === value)
    ? (value as DesktopSettingsCategoryId)
    : 'general'
}

type Props = {
  logoutTriggerRef?: RefObject<View | null>
  onLogout: () => void
  onBack: () => void
  onEscape: () => void
  onRequestCategoryChange: (change: () => void) => void
  sections: Record<DesktopSettingsCategoryId, ReactNode>
}

export function DesktopSettingsShell({
  logoutTriggerRef,
  onLogout,
  onBack,
  onEscape,
  onRequestCategoryChange,
  sections,
}: Props) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { category } = useLocalSearchParams<{ category?: string }>()
  const [activeCategory, setActiveCategory] = useState<DesktopSettingsCategoryId>(() =>
    resolveDesktopSettingsCategory(category),
  )
  const narrow = useWindowDimensions().width < 760
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [focusedControl, setFocusedControl] = useState<string | null>(null)
  const categoryPickerRef = useRef<View>(null)
  useEffect(() => {
    if (!narrow) setCategoriesOpen(false)
  }, [narrow])
  useKeyboardShortcut({ key: 'escape', allowEditable: true }, true, () => {
    handleDesktopSettingsEscape({
      categoryPickerOpen: narrow && categoriesOpen,
      closeCategoryPicker: () => setCategoriesOpen(false),
      focusCategoryPicker: () => categoryPickerRef.current?.focus(),
      leaveSettings: onEscape,
    })
  })
  const activeDefinition = useMemo(
    () => DESKTOP_SETTINGS_CATEGORIES.find((category) => category.id === activeCategory)!,
    [activeCategory],
  )

  return (
    <View testID="desktop-settings-shell" style={[styles.shell, { backgroundColor: colors.bg }]}>
      <View style={[styles.body, narrow && styles.narrowBody]}>
        {!narrow ? (
          <View
            style={[
              styles.categoryRail,
              {
                backgroundColor: colors.sidebarBackground,
                borderRightColor: colors.border,
              },
            ]}
          >
            <View {...{ dataSet: { desktopDrag: 'true' } }} style={styles.windowDragArea} />
            <SettingsBackButton
              colors={colors}
              focused={focusedControl === 'back'}
              label={t('back')}
              onBlur={() => setFocusedControl(null)}
              onFocus={event => setFocusedControl((event.nativeEvent.target as unknown as HTMLElement)?.matches?.(':focus-visible') ? 'back' : null)}
              onPress={onBack}
            />
            <View accessibilityRole="tablist" style={styles.categoryList}>
              {renderCategories()}
            </View>
            <Pressable ref={logoutTriggerRef} accessibilityRole="button" onPress={() => onRequestCategoryChange(() => { setActiveCategory('account'); onLogout() })} style={{marginTop: 'auto', minHeight: 36, paddingHorizontal: 12, justifyContent: 'center'}}><Text style={[desktopTypography.sidebarItem, {color: colors.text}]}>{t('logout')}</Text></Pressable>
          </View>
        ) : null}

        <View style={styles.contentColumn}>
          {!narrow ? (
            <View {...{ dataSet: { desktopDrag: 'true' } }} style={styles.contentDragArea} />
          ) : null}
          {narrow ? (
            <View
              {...{ dataSet: { desktopDrag: 'true' } }}
              style={[styles.header, { paddingLeft: 86, borderBottomColor: colors.border }]}
            >
              <SettingsBackButton
                compact
                colors={colors}
                focused={focusedControl === 'back'}
                label={t('back')}
                onBlur={() => setFocusedControl(null)}
                onFocus={event => setFocusedControl((event.nativeEvent.target as unknown as HTMLElement)?.matches?.(':focus-visible') ? 'back' : null)}
                onPress={onBack}
              />
              <Text style={[styles.windowTitle, { color: colors.text }]}>{t('settings')}</Text>
            </View>
          ) : null}
          {narrow ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('settings')}
              ref={categoryPickerRef}
              accessibilityState={{ expanded: categoriesOpen }}
              aria-expanded={categoriesOpen}
              testID="desktop-settings-category-picker"
              onFocus={event => setFocusedControl((event.nativeEvent.target as unknown as HTMLElement)?.matches?.(':focus-visible') ? 'picker' : null)}
              onBlur={() => setFocusedControl(null)}
              style={({ pressed }) => [
                styles.narrowPicker,
                { borderBottomColor: colors.border },
                focusedControl === 'picker' && { borderColor: colors.brand, borderWidth: 2 },
                pressed && styles.pressed,
              ]}
              onPress={() => setCategoriesOpen((open) => !open)}
            >
              <Text style={{ color: colors.text }}>{t(activeDefinition.labelKey)}</Text>
              <Ionicons
                name={categoriesOpen ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={colors.textSecondary}
              />
            </Pressable>
          ) : null}
          {narrow && categoriesOpen ? (
            <View
              accessibilityRole="tablist"
              style={[styles.narrowRail, { borderBottomColor: colors.border }]}
            >
              {renderCategories()}
            </View>
          ) : null}

          <ScrollView
            key={activeCategory}
            testID={`desktop-settings-panel-${activeCategory}`}
            style={styles.contentScroll}
            contentContainerStyle={[styles.contentContainer, narrow && styles.narrowContent]}
            showsVerticalScrollIndicator
          >
            <Text
              accessibilityRole="header"
              nativeID={`desktop-settings-panel-title-${activeCategory}`}
              style={[styles.contentTitle, { color: colors.text }]}
            >
              {t(activeDefinition.labelKey)}
            </Text>
            <View style={styles.contentBody}>{sections[activeCategory]}</View>
            {narrow ? <Pressable ref={logoutTriggerRef} accessibilityRole="button" onPress={() => onRequestCategoryChange(() => { setActiveCategory('account'); onLogout() })} style={{padding: 16}}><Text style={[desktopTypography.sidebarItem, {color: colors.text}]}>{t('logout')}</Text></Pressable> : null}
          </ScrollView>
        </View>
      </View>
    </View>
  )

  function renderCategories() {
    return DESKTOP_SETTINGS_CATEGORIES.map((category) => {
      const selected = category.id === activeCategory
      return (
        <Pressable
          key={category.id}
          accessibilityRole="tab"
          accessibilityState={{ selected }}
          aria-selected={selected}
          onFocus={event => setFocusedControl((event.nativeEvent.target as unknown as HTMLElement)?.matches?.(':focus-visible') ? category.id : null)}
          onBlur={() => setFocusedControl(null)}
          testID={`desktop-settings-category-${category.id}`}
          style={({ pressed }) => [
            styles.categoryButton,
            selected && { backgroundColor: colors.selectionBackground },
            focusedControl === category.id && { borderColor: colors.brand },
            pressed && styles.pressed,
          ]}
          onPress={() => {
            if (selected) return
            onRequestCategoryChange(() =>
              selectDesktopSettingsCategory(
                () => setActiveCategory(category.id),
                () => setCategoriesOpen(false),
                () => {
                  if (narrow) categoryPickerRef.current?.focus()
                },
              ),
            )
          }}
        >
          <Ionicons name={category.icon} size={19} color={colors.text} />
          <Text
            style={[
              styles.categoryLabel,
              { color: colors.text },
              selected && styles.categoryLabelSelected,
            ]}
          >
            {t(category.labelKey)}
          </Text>
        </Pressable>
      )
    })
  }
}

function SettingsBackButton({
  compact = false,
  colors,
  focused: _focused,
  label,
  onBlur,
  onFocus,
  onPress,
}: {
  compact?: boolean
  colors: ReturnType<typeof useTheme>['colors']
  focused: boolean
  label: string
  onBlur: () => void
  onFocus: NonNullable<ComponentProps<typeof Pressable>['onFocus']>
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID="desktop-settings-back"
      onBlur={onBlur}
      onFocus={onFocus}
      style={({ pressed }) => [
        styles.backButton,
        compact && styles.backButtonCompact,
        // Keyboard focus is drawn by the shared :focus-visible rule.
        pressed && styles.pressed,
      ]}
      onPress={onPress}
    >
      <Ionicons name="arrow-back" size={desktopControlMetrics.iconGlyphSize} color={colors.text} />
      {!compact ? <Text style={[styles.backLabel, { color: colors.text }]}>{label}</Text> : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  shell: { flex: 1, minWidth: 0, minHeight: 0 },
  header: {
    height: desktopControlMetrics.headerHeight,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    gap: 8,
  },
  backButton: {
    minWidth: 36,
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    borderRadius: desktopControlMetrics.radiusControl,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: 12,
    gap: 10,
  },
  backButtonCompact: { width: 36, paddingHorizontal: 7, justifyContent: 'center' },
  backLabel: desktopTypography.control,
  windowTitle: desktopTypography.windowTitle,
  body: { flex: 1, minHeight: 0, flexDirection: 'row' },
  contentColumn: { flex: 1, minWidth: 0, minHeight: 0 },
  categoryRail: {
    width: 240,
    flexShrink: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: desktopControlMetrics.headerHeight,
    paddingBottom: 20,
    gap: 12,
  },
  categoryList: {
    gap: 2,
  },
  windowDragArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: desktopControlMetrics.headerHeight,
  },
  contentDragArea: { position: 'absolute', top: 0, left: 0, right: 0, height: 28, zIndex: 1 },
  categoryButton: {
    minHeight: 34,
    borderWidth: 1,
    borderColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    paddingHorizontal: 10,
    gap: 8,
  },
  categoryLabel: { flex: 1, minWidth: 0, ...desktopTypography.sidebarItem, fontWeight: '500' },
  categoryLabelSelected: { fontWeight: '600' },
  contentScroll: { flex: 1, minWidth: 0 },
  contentContainer: {
    width: '100%',
    maxWidth: 880,
    paddingHorizontal: 40,
    paddingTop: 32,
    paddingBottom: 56,
  },
  contentTitle: desktopTypography.pageTitle,
  contentBody: { paddingTop: 24, gap: 20 },
  narrowBody: { flexDirection: 'column' },
  narrowRail: {
    width: '100%',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 4,
  },
  narrowContent: { paddingHorizontal: 20, paddingTop: 20 },
  narrowPicker: {
    minHeight: 44,
    borderWidth: 0,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pressed: { opacity: 0.72 },
})
