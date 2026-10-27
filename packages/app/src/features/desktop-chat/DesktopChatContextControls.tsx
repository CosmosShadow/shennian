// @arch docs/design/desktop/macos-interaction-baseline.md
// @test packages/app/src/__tests__/desktop-personal-chat-presentation.test.ts

import Feather from '@expo/vector-icons/Feather'
import type { ModelInfo } from '@shennian/wire'
import { useEffect, useRef, useState, type RefObject } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import type { Colors } from '../../hooks/useTheme'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useWebModalFocus } from '../../hooks/useWebModalFocus'
import { desktopControlMetrics, desktopTypography } from '../desktop-shell/desktopDesignTokens'
import { desktopListMenuPosition } from '../desktop-shell/desktopListMenuPosition'
import {
  filterDesktopModels,
  nextDesktopContextMenuIndex,
  resolveDesktopContextControlMode,
  toggleDesktopContextMenu,
} from './desktopChatContextControlState'

type ReasoningEffort = { id: string; name?: string }

type Props = {
  colors: Colors
  showModelControl: boolean
  canSwitchModel: boolean
  modelMenuOpen: boolean
  modelBusy: boolean
  refreshBusy: boolean
  models: ModelInfo[]
  effectiveModelId?: string
  currentModelLabel: string
  followsAgentModel: boolean
  followAgentDescription?: string
  canFollowAgentModel: boolean
  onModelMenuOpenChange: (open: boolean) => void
  onSelectModel: (modelId: string) => void
  onFollowAgentModel: () => void
  onRefreshModels: () => void | Promise<void>
  showReasoningEffort: boolean
  effectiveReasoningEffort?: string
  currentReasoningLabel: string
  reasoningEfforts: ReasoningEffort[]
  onSelectReasoningEffort: (effort: string) => void
}

export function DesktopChatContextControls(props: Props) {
  const { t } = useTranslation()
  const viewport = useWindowDimensions()
  const [reasoningMenuOpen, setReasoningMenuOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [modelMenuHeight, setModelMenuHeight] = useState(420)
  const [reasoningMenuHeight, setReasoningMenuHeight] = useState(240)
  const [modelMenuPosition, setModelMenuPosition] = useState({ left: 8, top: 8 })
  const [reasoningMenuPosition, setReasoningMenuPosition] = useState({ left: 8, top: 8 })
  const filteredModels = filterDesktopModels(props.models, query)
  const modelButtonRef = useRef<View>(null)
  const modelMenuRef = useRef<View>(null)
  const firstModelRef = useRef<View>(null)
  const reasoningButtonRef = useRef<View>(null)
  const reasoningMenuRef = useRef<View>(null)
  const firstReasoningRef = useRef<View>(null)
  const modelMenuWidth = Math.max(
    1,
    Math.min(desktopControlMetrics.popoverWidth, viewport.width - 16),
  )
  const reasoningMenuWidth = Math.max(1, Math.min(220, viewport.width - 16))
  useEffect(() => {
    if ((!props.modelMenuOpen && !reasoningMenuOpen) || typeof document === 'undefined') return
    const navigateMenu = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      const menu = [modelMenuRef.current, reasoningMenuRef.current]
        .map((node) => node as unknown as HTMLElement | null)
        .find((node) => node?.contains(target))
      if (!menu) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        props.onModelMenuOpenChange(false)
        setReasoningMenuOpen(false)
        return
      }
      const items = Array.from(
        menu.querySelectorAll<HTMLElement>(
          '[role="menuitem"]:not([aria-disabled="true"]), [role="menuitemradio"]:not([aria-disabled="true"])',
        ),
      )
      const next = nextDesktopContextMenuIndex(
        event.key,
        items.indexOf(target),
        items.length,
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA',
      )
      if (next === null) return
      event.preventDefault()
      event.stopPropagation()
      items[next]?.focus()
      items[next]?.scrollIntoView({ block: 'nearest' })
    }
    document.addEventListener('keydown', navigateMenu, true)
    return () => document.removeEventListener('keydown', navigateMenu, true)
  }, [props.modelMenuOpen, props.onModelMenuOpenChange, reasoningMenuOpen])
  const modelMode = resolveDesktopContextControlMode({
    visible: props.showModelControl,
    optionCount: props.canSwitchModel ? 2 : 1,
  })
  const reasoningMode = resolveDesktopContextControlMode({
    visible: props.showReasoningEffort && Boolean(props.effectiveReasoningEffort),
    optionCount: props.reasoningEfforts.length,
  })

  useEscapeKey(props.modelMenuOpen, () => props.onModelMenuOpenChange(false))
  useEscapeKey(reasoningMenuOpen, () => setReasoningMenuOpen(false))
  useWebModalFocus({
    visible: props.modelMenuOpen,
    containerRef: modelMenuRef,
    initialFocusRef: firstModelRef,
    returnFocusRef: modelButtonRef,
  })
  useWebModalFocus({
    visible: reasoningMenuOpen,
    containerRef: reasoningMenuRef,
    initialFocusRef: firstReasoningRef,
    returnFocusRef: reasoningButtonRef,
  })

  useEffect(() => {
    if (props.modelMenuOpen) setReasoningMenuOpen(false)
    else setQuery('')
  }, [props.modelMenuOpen])

  useEffect(() => {
    if (modelMode !== 'menu' && props.modelMenuOpen) props.onModelMenuOpenChange(false)
    if (reasoningMode !== 'menu') setReasoningMenuOpen(false)
  }, [modelMode, reasoningMode, props.modelMenuOpen, props.onModelMenuOpenChange])

  useEffect(() => {
    if (!props.modelMenuOpen) return
    modelButtonRef.current?.measureInWindow((x, y, width, height) => {
      setModelMenuPosition(
        desktopListMenuPosition(
          { x, y, width, height },
          { width: viewport.width, height: viewport.height },
          { width: modelMenuWidth, height: modelMenuHeight },
        ),
      )
    })
  }, [modelMenuHeight, modelMenuWidth, props.modelMenuOpen, viewport.height, viewport.width])

  useEffect(() => {
    if (!reasoningMenuOpen) return
    reasoningButtonRef.current?.measureInWindow((x, y, width, height) => {
      setReasoningMenuPosition(
        desktopListMenuPosition(
          { x, y, width, height },
          { width: viewport.width, height: viewport.height },
          { width: reasoningMenuWidth, height: reasoningMenuHeight },
        ),
      )
    })
  }, [
    reasoningMenuHeight,
    reasoningMenuOpen,
    reasoningMenuWidth,
    viewport.height,
    viewport.width,
  ])

  useEffect(() => {
    if ((!props.modelMenuOpen && !reasoningMenuOpen) || typeof document === 'undefined') return
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node
      const contains = (ref: RefObject<View | null>) =>
        (ref.current as unknown as HTMLElement | null)?.contains(target)
      if (
        contains(modelMenuRef) ||
        contains(reasoningMenuRef) ||
        contains(modelButtonRef) ||
        contains(reasoningButtonRef)
      )
        return
      props.onModelMenuOpenChange(false)
      setReasoningMenuOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [props.modelMenuOpen, reasoningMenuOpen, props.onModelMenuOpenChange])

  const openModelMenu = () => {
    setReasoningMenuOpen(false)
    props.onModelMenuOpenChange(
      toggleDesktopContextMenu(props.modelMenuOpen, modelMode, props.modelBusy),
    )
  }
  const openReasoningMenu = () => {
    props.onModelMenuOpenChange(false)
    setReasoningMenuOpen((open) => toggleDesktopContextMenu(open, reasoningMode))
  }

  return (
    <View style={styles.root} testID="desktop-chat-context-controls">
      {modelMode !== 'hidden' ? (
        modelMode === 'menu' ? (
          <ContextButton
            actionRef={modelButtonRef}
            label={props.currentModelLabel || t('model')}
            accessibilityLabel={t('model_selector_title')}
            expanded={props.modelMenuOpen}
            colors={props.colors}
            onPress={openModelMenu}
            testID="desktop-model-menu-button"
          />
        ) : (
          <Text
            testID="desktop-model-status"
            accessibilityRole="text"
            numberOfLines={1}
            style={[styles.readonlyLabel, { color: props.colors.textSecondary }]}
          >
            {props.currentModelLabel || t('model')}
          </Text>
        )
      ) : null}

      {reasoningMode !== 'hidden' ? (
        reasoningMode === 'menu' ? (
          <ContextButton
            actionRef={reasoningButtonRef}
            label={props.currentReasoningLabel}
            accessibilityLabel={t('reasoning_effort')}
            expanded={reasoningMenuOpen}
            colors={props.colors}
            onPress={openReasoningMenu}
            testID="desktop-reasoning-menu-button"
          />
        ) : (
          <Text
            testID="desktop-reasoning-status"
            accessibilityRole="text"
            numberOfLines={1}
            style={[styles.readonlyLabel, { color: props.colors.textSecondary }]}
          >
            {props.currentReasoningLabel}
          </Text>
        )
      ) : null}

      {props.modelMenuOpen && modelMode === 'menu' ? (
        <Modal
          transparent
          visible
          animationType="none"
          onRequestClose={() => props.onModelMenuOpenChange(false)}
        >
          <View style={styles.overlay}>
            <Pressable
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={StyleSheet.absoluteFill}
              onPress={() => props.onModelMenuOpenChange(false)}
            />
            <View
              ref={modelMenuRef}
              accessibilityRole="menu"
              onLayout={(event) => setModelMenuHeight(event.nativeEvent.layout.height)}
              style={[
                styles.popover,
                { width: modelMenuWidth, ...modelMenuPosition },
                { backgroundColor: props.colors.surface, borderColor: props.colors.border },
              ]}
              testID="desktop-model-popover"
            >
              <View style={[styles.popoverHeader, { borderBottomColor: props.colors.border }]}>
                <Text style={[styles.popoverTitle, { color: props.colors.text }]}>
                  {t('model_selector_title')}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('model_selector_refresh')}
                  disabled={props.modelBusy || props.refreshBusy}
                  onPress={() => void props.onRefreshModels()}
                  style={styles.refreshButton}
                >
                  {props.refreshBusy ? (
                    <ActivityIndicator size="small" color={props.colors.brand} />
                  ) : (
                    <Feather name="refresh-cw" size={14} color={props.colors.textSecondary} />
                  )}
                </Pressable>
              </View>
              <TextInput
                value={query}
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setQuery}
                placeholder={t('model_selector_search')}
                accessibilityLabel={t('model_selector_search')}
                placeholderTextColor={props.colors.textTertiary}
                style={[
                  styles.search,
                  { color: props.colors.text, borderColor: props.colors.border },
                ]}
              />
              <ScrollView
                style={[styles.menuScroll, { maxHeight: Math.max(80, viewport.height - 160) }]}
                keyboardShouldPersistTaps="handled"
              >
                {filteredModels.length === 0 ? (
                  <Text
                    style={[
                      desktopTypography.metadata,
                      { padding: 8, color: props.colors.textSecondary },
                    ]}
                  >
                    {t('model_selector_no_results')}
                  </Text>
                ) : null}
                {props.canFollowAgentModel ? (
                  <MenuRow
                    actionRef={firstModelRef}
                    label={t('model_follow_agent')}
                    description={props.followAgentDescription}
                    selected={props.followsAgentModel}
                    disabled={props.modelBusy}
                    colors={props.colors}
                    onPress={props.onFollowAgentModel}
                  />
                ) : null}
                {filteredModels.map((model, index) => (
                  <MenuRow
                    key={model.id}
                    actionRef={
                      !props.canFollowAgentModel && index === 0 ? firstModelRef : undefined
                    }
                    label={model.name}
                    description={model.description}
                    selected={!props.followsAgentModel && props.effectiveModelId === model.id}
                    disabled={props.modelBusy}
                    colors={props.colors}
                    onPress={() => props.onSelectModel(model.id)}
                  />
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>
      ) : null}

      {reasoningMenuOpen && reasoningMode === 'menu' ? (
        <Modal
          transparent
          visible
          animationType="none"
          onRequestClose={() => setReasoningMenuOpen(false)}
        >
          <View style={styles.overlay}>
            <Pressable
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={StyleSheet.absoluteFill}
              onPress={() => setReasoningMenuOpen(false)}
            />
            <View
              ref={reasoningMenuRef}
              accessibilityRole="menu"
              onLayout={(event) => setReasoningMenuHeight(event.nativeEvent.layout.height)}
              style={[
                styles.popover,
                { width: reasoningMenuWidth, ...reasoningMenuPosition },
                { backgroundColor: props.colors.surface, borderColor: props.colors.border },
              ]}
              testID="desktop-reasoning-popover"
            >
              {props.reasoningEfforts.map((effort, index) => (
                <MenuRow
                  key={effort.id}
                  actionRef={index === 0 ? firstReasoningRef : undefined}
                  label={effort.name || effort.id}
                  selected={props.effectiveReasoningEffort === effort.id}
                  colors={props.colors}
                  onPress={() => {
                    props.onSelectReasoningEffort(effort.id)
                    setReasoningMenuOpen(false)
                  }}
                />
              ))}
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  )
}

function ContextButton({
  actionRef,
  accessibilityLabel,
  colors,
  expanded,
  label,
  onPress,
  testID,
}: {
  actionRef: RefObject<View | null>
  accessibilityLabel: string
  colors: Colors
  expanded: boolean
  label: string
  onPress: () => void
  testID: string
}) {
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      ref={actionRef}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ expanded }}
      aria-expanded={expanded}
      aria-haspopup="menu"
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      testID={testID}
      style={(state) => [
        styles.button,
        {
          backgroundColor:
            expanded || (state as { hovered?: boolean }).hovered
              ? colors.surfaceHover
              : 'transparent',
          borderColor: focused ? colors.brand : 'transparent',
        },
      ]}
    >
      <Text numberOfLines={1} style={[styles.buttonText, { color: colors.textSecondary }]}>
        {label}
      </Text>
      <Feather name="chevron-down" size={13} color={colors.textTertiary} />
    </Pressable>
  )
}

function MenuRow({
  actionRef,
  colors,
  description,
  disabled = false,
  label,
  onPress,
  selected,
}: {
  actionRef?: RefObject<View | null>
  colors: Colors
  description?: string
  disabled?: boolean
  label: string
  onPress: () => void
  selected: boolean
}) {
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      ref={actionRef}
      accessibilityRole="menuitem"
      // Native's Role union omits the ARIA radio-menu role supported by RN Web.
      role={'menuitemradio' as 'menuitem'}
      accessibilityState={{ checked: selected, disabled }}
      aria-checked={selected}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={(state) => [
        styles.menuRow,
        { borderWidth: 1, borderColor: focused ? colors.brand : 'transparent' },
        (state as { hovered?: boolean }).hovered || selected
          ? { backgroundColor: colors.surfaceHover }
          : null,
      ]}
    >
      <View style={styles.menuText}>
        <Text numberOfLines={1} style={[styles.menuLabel, { color: colors.text }]}>
          {label}
        </Text>
        {description ? (
          <Text numberOfLines={1} style={[styles.menuDescription, { color: colors.textSecondary }]}>
            {description}
          </Text>
        ) : null}
      </View>
      {selected ? <Feather name="check" size={15} color={colors.brand} /> : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: { position: 'relative', flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  button: {
    height: 32,
    maxWidth: 180,
    paddingHorizontal: 8,
    borderRadius: desktopControlMetrics.radiusControl,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  buttonText: { flexShrink: 1, ...desktopTypography.control },
  readonlyLabel: { maxWidth: 180, paddingHorizontal: 8, ...desktopTypography.metadata },
  popover: {
    position: 'absolute',
    zIndex: 100,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: desktopControlMetrics.radiusContainer,
    padding: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    elevation: 20,
  },
  overlay: { flex: 1 },
  popoverHeader: {
    height: 36,
    paddingLeft: 8,
    paddingRight: 2,
    marginBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  popoverTitle: desktopTypography.sectionTitle,
  refreshButton: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  menuScroll: { maxHeight: 320 },
  search: {
    ...desktopTypography.control,
    minHeight: 32,
    paddingHorizontal: 8,
    marginBottom: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: desktopControlMetrics.radiusSmall,
  },
  menuRow: {
    minHeight: 40,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: desktopControlMetrics.radiusSmall,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  menuText: { flex: 1, minWidth: 0 },
  menuLabel: desktopTypography.control,
  menuDescription: desktopTypography.caption,
})
