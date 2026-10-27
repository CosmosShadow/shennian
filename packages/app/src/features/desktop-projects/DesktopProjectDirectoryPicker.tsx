// @arch docs/architecture/compatibility.md
// @arch docs/features/desktop-project-creation.md
// @arch docs/design/desktop/unified-desktop-control.md
// @test ../../__tests__/desktop-project-directory-picker.test.ts
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import type { ResFrame } from '@shennian/wire'
import { DesktopDialog } from '../desktop-shell/DesktopDialog'
import { desktopTypography } from '../desktop-shell/desktopDesignTokens'
import { useAuthStore } from '../../config/auth'
import { useTheme } from '../../hooks/useTheme'
import { canGoUp, FILE_SYSTEM_ROOTS_PATH } from '../../utils/directoryNavigation'
import { desktopAccountActions } from '../desktop-control/useDesktopAccountSync'
import { DesktopProjectDirectoryModel } from './desktopProjectDirectoryModel'
import { DesktopMachineAction } from '../desktop-machines/DesktopMachineAction'

export type DesktopProjectDirectoryPickerProps = {
  machineId: string
  initialPath: string
  onSelect(path: string): void
  onClose(): void
}
export function DesktopProjectDirectoryPicker({
  machineId,
  initialPath,
  onSelect,
  onClose,
}: DesktopProjectDirectoryPickerProps) {
  const accountId = useAuthStore((state) => state.user?.id ?? '')
  const scope = useMemo(
    () => ({ accountId, machineId, initialPath }),
    [accountId, machineId, initialPath],
  )
  const currentScope = useRef<typeof scope | null>(scope)
  currentScope.current = scope
  const model = useMemo(
    () =>
      new DesktopProjectDirectoryModel({
        machineId,
        initialPath,
        isCurrent: () =>
          !!accountId &&
          currentScope.current === scope &&
          useAuthStore.getState().user?.id === accountId,
        list: (target, path) =>
          desktopAccountActions.requestMachineOperation<ResFrame>('machine.fs.list', target, {
            path,
          }),
      }),
    [accountId, machineId, initialPath, scope],
  )
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot)
  useEffect(() => {
    currentScope.current = scope
    const unsubscribe = useAuthStore.subscribe((next, previous) => {
      if (next.user?.id !== previous.user?.id) model.stop()
    })
    model.start()
    return () => {
      unsubscribe()
      if (currentScope.current === scope) currentScope.current = null
      model.stop()
    }
  }, [model, scope])
  const { colors } = useTheme()
  const { t } = useTranslation()
  const { height } = useWindowDimensions()
  const [searchFocused, setSearchFocused] = useState(false)
  const visible = model.visible()
  const close = () => {
    if (currentScope.current !== scope) return
    currentScope.current = null
    model.stop()
    onClose()
  }
  const select = () => {
    const path = model.selectedPath()
    if (!path) return
    model.stop()
    onSelect(path)
    onClose()
  }
  const button = (label: string, action: () => void, disabled = false) => (
    <DesktopMachineAction compact label={label} onPress={action} disabled={disabled} />
  )
  return (
    <DesktopDialog onClose={close} title={t('select_this_dir')}>
      <View testID="desktop-project-directory-picker" style={styles.content}>
        <View style={styles.toolbar}>
          {button(t('home_dir'), () => {
            void model.home()
          })}
          {button(t('fs_roots'), () => {
            void model.roots()
          })}
          {button(t('go_up'), model.up, !canGoUp(state.path))}
          {state.loading ? <ActivityIndicator color={colors.brand} /> : null}
        </View>
        <Text
          selectable
          numberOfLines={2}
          {...{ title: state.path || initialPath || '~' }}
          style={[styles.path, { color: colors.textSecondary }]}
        >
          {state.path === FILE_SYSTEM_ROOTS_PATH ? t('fs_roots') : state.path || initialPath || '~'}
        </Text>
        {state.error ? (
          <View style={styles.toolbar}>
            <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>
              {state.error === 'directory_load_failed' ? t('error') : state.error}
            </Text>
            {button(t('retry'), () => {
              void model.retry()
            })}
          </View>
        ) : null}
        <View style={styles.toolbar}>
          <View
            style={[
              styles.searchFrame,
              { borderColor: searchFocused ? colors.brand : colors.border },
            ]}
          >
            <TextInput
              value={state.query}
              onChangeText={model.search}
              placeholder={t('search_dirs')}
              accessibilityLabel={t('search_dirs')}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.search, { color: colors.text, borderColor: colors.border }]}
            />
          </View>
          {state.query ? button(t('clear_search'), () => model.search('')) : null}
          <Text style={[desktopTypography.metadata, { color: colors.textSecondary }]}>
            {state.loading ? t('loading') : t('dir_result_count', { count: visible.count })}
          </Text>
        </View>
        <ScrollView
          style={[
            styles.list,
            { height: Math.min(280, height * 0.35), borderColor: colors.border },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {visible.entries.map((entry) => (
            <DirectoryRow
              key={entry.path}
              name={entry.name}
              path={entry.path}
              onPress={() => {
                void model.navigate(entry.path)
              }}
            />
          ))}
          {!state.loading && !state.error && !visible.count ? (
            <Text style={[styles.empty, { color: colors.textSecondary }]}>
              {t(state.query.trim() ? 'no_matching_dirs' : 'no_subdirs')}
            </Text>
          ) : null}
          {visible.remaining
            ? button(t('load_more_dirs', { count: Math.min(100, visible.remaining) }), model.more)
            : null}
        </ScrollView>
        <View testID="desktop-project-directory-select" style={styles.footer}>
          <DesktopMachineAction compact label={t('cancel')} onPress={close} />
          <DesktopMachineAction
            compact
            primary
            label={t('select_this_dir')}
            disabled={!model.selectedPath()}
            onPress={select}
          />
        </View>
      </View>
    </DesktopDialog>
  )
}
function DirectoryRow({ name, path, onPress }: { name: string; path: string; onPress(): void }) {
  const { colors } = useTheme()
  const [focused, setFocused] = useState(false)
  const [hovered, setHovered] = useState(false)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      {...{ title: path }}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [
        styles.directory,
        {
          borderColor: focused ? colors.brand : 'transparent',
          backgroundColor: hovered || pressed ? colors.surfaceHover : colors.bg,
        },
      ]}
    >
      <Ionicons name="folder-outline" size={16} color={colors.textSecondary} />
      <Text numberOfLines={1} style={[desktopTypography.control, { flex: 1, color: colors.text }]}>
        {name}
      </Text>
      <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
    </Pressable>
  )
}
const styles = StyleSheet.create({
  content: { gap: 12 },
  toolbar: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  path: { ...desktopTypography.metadata },
  searchFrame: { flex: 1, minWidth: 160, borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  search: { ...desktopTypography.body, minHeight: 36, paddingHorizontal: 8 },
  list: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  directory: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderRadius: 6,
  },
  footer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 },
  error: { ...desktopTypography.body, flex: 1 },
  empty: { ...desktopTypography.body, paddingVertical: 24, textAlign: 'center' },
})
