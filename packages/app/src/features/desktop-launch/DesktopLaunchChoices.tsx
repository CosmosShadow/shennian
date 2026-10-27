// @arch docs/features/desktop-personal-session-navigation.md
// @test ../../__tests__/desktop-launch-choices.test.ts

import Ionicons from '@expo/vector-icons/Ionicons'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { AgentType, ModelInfo } from '@shennian/wire'
import { useTheme } from '../../hooks/useTheme'
import { isModelSelected, modelSelectionValue, shouldUseCollapsedModelSelector } from '../../utils/models'
import { buildDesktopLaunchModelOptions, desktopModelTabStopIndex, nextDesktopLaunchChoiceIndex } from './desktopLaunchModels'
import { desktopControlMetrics, desktopTypography } from '../desktop-shell/desktopDesignTokens'

export function DesktopAgentChoices({ agents, selected, disabled, getLabel, onSelect }: {
  agents: AgentType[]
  selected: AgentType
  disabled: boolean
  getLabel(agent: AgentType): string
  onSelect(agent: AgentType): void
}) {
  const { t } = useTranslation()
  return <DesktopChoiceSection label={t('desktop_machine_tools')}>
    <DesktopRadioGroup>
      {agents.map(agent => <DesktopChoice key={agent} label={getLabel(agent)} selected={selected === agent}
        disabled={disabled} onPress={() => onSelect(agent)} />)}
    </DesktopRadioGroup>
  </DesktopChoiceSection>
}

export function DesktopModelChoices({ models, selected, disabled, onSelect, compact = false, autoSelectOnlyModel = true }: {
  models: ModelInfo[]
  selected: string | null
  disabled: boolean
  onSelect(model: string | null): void
  compact?: boolean
  autoSelectOnlyModel?: boolean
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const options = useMemo(() => buildDesktopLaunchModelOptions(models, t('agents_default_model')), [models, t])
  const collapsed = shouldUseCollapsedModelSelector(options.length)

  useEffect(() => {
    if (!autoSelectOnlyModel || options.length !== 1 || isModelSelected(options[0]!, selected)) return
    onSelect(modelSelectionValue(options[0]!))
  }, [autoSelectOnlyModel, onSelect, options, selected])

  if (compact && (!models.length || (options.length === 1 && isModelSelected(options[0]!, selected)))) {
    return <DesktopChoiceSection label={t('model')}>
      <Text selectable style={[desktopTypography.body, { color: colors.text }]}>{models.length ? options[0]!.name : selected ?? t('agents_default_model')}</Text>
    </DesktopChoiceSection>
  }
  if (options.length === 0) return null
  return <DesktopChoiceSection label={t('model')}>
    <ScrollView style={collapsed ? styles.modelScroll : undefined} nestedScrollEnabled keyboardShouldPersistTaps="handled">
      <DesktopRadioGroup>
        {options.map((model, index) => <DesktopChoice key={model.id} label={model.name} compact={compact}
          tabStop={index === desktopModelTabStopIndex(options, selected)}
          detail={compact ? undefined : model.description ?? model.provider}
          selected={isModelSelected(model, selected)} disabled={disabled} onPress={() => onSelect(modelSelectionValue(model))} />)}
      </DesktopRadioGroup>
    </ScrollView>
  </DesktopChoiceSection>
}

/** Web renders Desktop choices as native-looking radios; arrow keys move and select per radio-group semantics. */
function DesktopRadioGroup({ children }: { children: ReactNode }) {
  const groupRef = useRef<View>(null)
  useEffect(() => {
    const node = groupRef.current as unknown as HTMLElement | null
    if (!node || typeof document === 'undefined') return
    const onKeyDown = (event: KeyboardEvent) => {
      const choices = Array.from(node.querySelectorAll<HTMLElement>('[role="radio"]:not([aria-disabled="true"])'))
      const current = choices.indexOf(document.activeElement as HTMLElement)
      const next = nextDesktopLaunchChoiceIndex(event.key, current, choices.length)
      if (next === null) return
      event.preventDefault()
      choices[next]?.focus()
      choices[next]?.click()
    }
    node.addEventListener('keydown', onKeyDown)
    return () => node.removeEventListener('keydown', onKeyDown)
  }, [])
  return <View ref={groupRef} accessibilityRole="radiogroup" style={styles.grid}>{children}</View>
}

function DesktopChoiceSection({ label, children }: { label: string; children: ReactNode }) {
  const { colors } = useTheme()
  return <View style={styles.section}>
    <Text style={[styles.sectionTitle, { color: colors.text }]}>{label}</Text>
    {children}
  </View>
}

function DesktopChoice({ label, detail, selected, disabled, onPress, compact = false, tabStop = false }: {
  label: string
  detail?: string
  selected: boolean
  disabled: boolean
  onPress(): void
  compact?: boolean
  tabStop?: boolean
}) {
  const { colors } = useTheme()
  const [focused, setFocused] = useState(false)
  return <Pressable
    accessibilityRole="radio"
    accessibilityLabel={label}
    accessibilityState={{ checked: selected, disabled }}
    aria-checked={selected}
    aria-disabled={disabled}
    tabIndex={selected || tabStop ? 0 : -1}
    disabled={disabled}
    onPress={onPress}
    onFocus={event => setFocused((event.nativeEvent.target as unknown as HTMLElement)?.matches?.(':focus-visible') ?? false)}
    onBlur={() => setFocused(false)}
    style={({ pressed }) => [styles.choice, compact && styles.compactChoice, {
      borderColor: focused ? colors.brand : colors.border,
      backgroundColor: selected ? colors.selectionBackground : pressed ? colors.surfaceHover : colors.bg,
      opacity: disabled ? 0.5 : 1,
    }]}
  >
    <View style={styles.choiceCopy}>
      <Text style={[styles.choiceLabel, compact && desktopTypography.control, { color: colors.text }]}>{label}</Text>
      {detail ? <Text style={[styles.choiceDetail, { color: colors.textSecondary }]}>{detail}</Text> : null}
    </View>
    {selected ? <Ionicons name={compact ? 'checkmark' : 'checkmark-circle'} size={compact ? 16 : 19} color={colors.textSecondary} /> : null}
  </Pressable>
}

const styles = StyleSheet.create({
  section: { gap: 9 },
  sectionTitle: { fontSize: 13, lineHeight: 19, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { minWidth: 156, minHeight: 48, flexGrow: 1, flexBasis: 0, paddingHorizontal: 13, paddingVertical: 8, borderWidth: 2, borderRadius: 9, flexDirection: 'row', alignItems: 'center', gap: 10 },
  compactChoice: { minWidth: 0, minHeight: desktopControlMetrics.standardControlHeight, flexGrow: 0, flexBasis: 'auto', paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderRadius: desktopControlMetrics.radiusControl, gap: 6 },
  choiceCopy: { minWidth: 0, flex: 1, gap: 1 },
  choiceLabel: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  choiceDetail: { fontSize: 12, lineHeight: 17 },
  modelScroll: { maxHeight: 224 },
})
