// @arch docs/architecture/mobile-navigation.md
// @test src/__tests__/steward-inspiration.test.ts

import { useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import BottomSheet from '../../../components/BottomSheet'
import { useTheme } from '../../../hooks/useTheme'
import { mobileTypography } from '../../../theme/mobileTypography'
import { inspirationSectionCards } from '../inspirationSections'
import { useInspirationSectionNavigation } from '../useInspirationSectionNavigation'

export function StewardInspirationSheet({
  isOpen,
  onClose,
  onSelect,
  disabled = false,
  disabledReason,
  shortcutVisible,
  onToggleShortcut,
  savingVisibility,
}: {
  isOpen: boolean
  onClose: () => void
  /** Resolve true only when the normal chat send path accepted the prompt. */
  onSelect: (prompt: string) => Promise<boolean>
  disabled?: boolean
  disabledReason?: string
  shortcutVisible: boolean
  onToggleShortcut: () => Promise<void>
  savingVisibility: boolean
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const navigation = useInspirationSectionNavigation(isOpen)
  const sections = inspirationSectionCards(t)
  const sendingRef = useRef(false)
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)
  const [visibilityFailed, setVisibilityFailed] = useState(false)
  const toggleVisibility = async () => {
    setVisibilityFailed(false)
    try {
      await onToggleShortcut()
    } catch {
      setVisibilityFailed(true)
    }
  }
  const select = async (prompt: string) => {
    if (disabled || sendingRef.current) return
    sendingRef.current = true
    setSending(true)
    setFailed(false)
    try {
      if (await onSelect(prompt)) onClose()
      else setFailed(true)
    } catch {
      setFailed(true)
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }
  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={t('inspiration_title')}
      closeButtonStyle="icon"
      closeButtonSide="left"
      bodyBackgroundColor={colors.bg}
      bodyScrollRef={navigation.bodyRef}
      bodyScrollProps={navigation.scrollProps}
      headerRight={
        <Pressable
          testID="steward-inspiration-toggle"
          accessibilityRole="button"
          accessibilityLabel={t(shortcutVisible ? 'inspiration_hide' : 'inspiration_show')}
          disabled={savingVisibility}
          onPress={() => void toggleVisibility()}
          style={styles.toggle}
        >
          <Text style={[styles.toggleLabel, { color: colors.textSecondary }]}>
            {t(shortcutVisible ? 'inspiration_hide_short' : 'inspiration_show_short')}
          </Text>
        </Pressable>
      }
    >
      <View
        testID="inspiration-tags"
        style={[styles.tagsHeader, { backgroundColor: colors.bg }]}
        onLayout={(event) => navigation.onTagsLayout(event.nativeEvent.layout.height)}
      >
        <ScrollView
          ref={navigation.tagsRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tags}
          keyboardShouldPersistTaps="handled"
        >
          {sections.map((section, index) => (
            <Pressable
              key={section.id}
              testID={`inspiration-tag-${section.id}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: navigation.active === index }}
              accessibilityLabel={section.title}
              onLayout={(event) => navigation.onTagLayout(index, event.nativeEvent.layout.x)}
              onPress={() => navigation.selectSection(index)}
              style={[
                styles.tag,
                { backgroundColor: navigation.active === index ? colors.text : colors.bg },
              ]}
            >
              <Text
                style={[
                  styles.tagText,
                  { color: navigation.active === index ? colors.bg : colors.textSecondary },
                ]}
              >
                {section.title}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <View style={styles.notices}>
        {disabledReason ? (
          <Text style={[styles.hint, { color: colors.textSecondary }]}>{disabledReason}</Text>
        ) : null}
        {visibilityFailed ? (
          <Text accessibilityRole="alert" style={[styles.hint, { color: colors.errorText }]}>
            {t('inspiration_save_failed')}
          </Text>
        ) : null}
        {failed ? (
          <Text accessibilityRole="alert" style={[styles.hint, { color: colors.errorText }]}>
            {t('inspiration_not_sent')}
          </Text>
        ) : null}
      </View>
      {sections.map((section, index) => (
        <View
          key={section.id}
          testID={`inspiration-section-${section.id}`}
          style={styles.section}
          onLayout={(event) => navigation.onSectionLayout(index, event.nativeEvent.layout.y)}
        >
          <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.text }]}>
            {section.title}
          </Text>
          {section.cards.map((card) => (
            <Pressable
              key={card.id}
              testID={`steward-inspiration-${card.id}`}
              accessibilityRole="button"
              accessibilityLabel={card.title}
              accessibilityHint={t('inspiration_send_hint')}
              accessibilityState={{ disabled: disabled || sending }}
              disabled={disabled || sending}
              onPress={() => void select(card.prompt)}
              style={({ pressed }) => [
                styles.card,
                {
                  backgroundColor: pressed ? colors.surfaceHover : colors.bg,
                  borderColor: colors.separator,
                  opacity: disabled || sending ? 0.5 : pressed ? 0.75 : 1,
                },
              ]}
            >
              <View style={styles.copy}>
                <Text style={[styles.title, { color: colors.text }]}>{card.title}</Text>
                <Text style={[styles.description, { color: colors.textSecondary }]}>
                  {card.description}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      ))}
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  tagsHeader: { paddingVertical: 8 },
  tags: { gap: 8 },
  tag: { minHeight: 44, justifyContent: 'center', borderRadius: 24, paddingHorizontal: 14 },
  tagText: { ...mobileTypography.compactAction },
  notices: { gap: 8 },
  section: { gap: 10, paddingTop: 14, paddingBottom: 12 },
  sectionTitle: { ...mobileTypography.sectionTitle, paddingHorizontal: 4, marginBottom: 4 },
  toggle: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 6,
  },
  toggleLabel: { ...mobileTypography.secondary },
  hint: { ...mobileTypography.secondary, marginBottom: 4 },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingVertical: 16,
    minHeight: 76,
  },
  copy: { minWidth: 0, gap: 5 },
  title: { ...mobileTypography.listTitle },
  description: { ...mobileTypography.secondary },
})
