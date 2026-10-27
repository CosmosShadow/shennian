// @arch docs/architecture/launch-config.md#目录选择器
// @test packages/app/src/__tests__/dir-browser-entries.test.ts

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Modal,
  FlatList,
  Platform,
  ScrollView,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import Feather from '@expo/vector-icons/Feather'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { FsEntry } from '@shennian/wire'
import { accountRuntime } from '../features/account-runtime/accountRuntime'
import { AppPageHeader } from './AppPageHeader'
import { useTheme } from '../hooks/useTheme'
import { mobileTypography } from '../theme/mobileTypography'
import { FILE_SYSTEM_ROOTS_PATH } from '../utils/directoryNavigation'
import {
  DIR_BROWSER_WEB_PAGE_SIZE,
  filterDirBrowserEntries,
  getVisibleDirBrowserEntries,
} from '../utils/dirBrowserEntries'
import {
  buildDirBrowserLsParams,
  canNavigateUpForDirBrowser,
  getParentForDirBrowser,
  type DirBrowserMode,
} from '../utils/dirBrowserMode'

export function DirBrowser({
  machineId,
  onDirectoryChange,
  initialPath,
  onSelect,
  onClose,
  mode = 'session',
  inline = false,
  closeOnSelect = true,
}: {
  machineId: string
  onDirectoryChange?: (path: string) => void
  inline?: boolean
  closeOnSelect?: boolean
  initialPath: string
  onSelect: (path: string) => void
  onClose: () => void
  /**
   * session: start at the current workDir but allow moving upward and choosing
   * sibling projects. Machine authorization is the product boundary.
   * workDirPicker: choose a new session workDir with the same navigation rules.
   */
  mode?: DirBrowserMode
}) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const [currentPath, setCurrentPath] = useState(initialPath || '~')
  useEffect(() => { onDirectoryChange?.(currentPath) }, [currentPath, onDirectoryChange])
  const [entries, setEntries] = useState<FsEntry[]>([])
  const [visibleCount, setVisibleCount] = useState(DIR_BROWSER_WEB_PAGE_SIZE)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const didLoadRef = useRef(false)
  const insets = useSafeAreaInsets()

  const loadDir = useCallback(
    async (p: string) => {
      const pathToLoad = p || initialPath || '~'
      setCurrentPath(pathToLoad)
      setEntries([])
      setLoading(true)
      setError('')
      try {
        const params = buildDirBrowserLsParams(mode, pathToLoad, initialPath)
        const res = await accountRuntime.requestMachine(machineId, 'fs.ls', params)
        if (!res.ok) {
          setError(res.error ?? '加载失败')
          return
        }
        const payload = res.payload as { path: string; entries: FsEntry[] }
        setCurrentPath(payload.path)
        setEntries(payload.entries as FsEntry[])
        setVisibleCount(DIR_BROWSER_WEB_PAGE_SIZE)
      } catch (e) {
        setError(e instanceof Error ? e.message : '加载失败')
      } finally {
        setLoading(false)
      }
    },
    [machineId, initialPath, mode],
  )

  useEffect(() => {
    let active = true
    void accountRuntime
      .observeMachine(machineId)
      .then((observed) => {
        if (!active) return
        if (!observed) throw new Error('认证失败，请重新登录')
        if (didLoadRef.current) return
        didLoadRef.current = true
        return loadDir(initialPath || '~')
      })
      .catch((error) => {
        if (!active) return
        setError(error instanceof Error ? error.message : '无法连接到机器')
        setLoading(false)
      })

    return () => {
      active = false
      void accountRuntime.unobserveMachine(machineId)
    }
  }, [machineId, initialPath, loadDir])

  const filteredDirs = useMemo(() => filterDirBrowserEntries(entries, ''), [entries])
  const visibleWebDirs = useMemo(
    () => getVisibleDirBrowserEntries(filteredDirs, visibleCount),
    [filteredDirs, visibleCount],
  )
  const remainingWebDirs = Math.max(0, filteredDirs.length - visibleWebDirs.length)
  const canNavigateUp = canNavigateUpForDirBrowser(mode, currentPath, initialPath)

  const canSelect = !loading && !error && !!currentPath && currentPath !== FILE_SYSTEM_ROOTS_PATH

  const goUp = () => {
    void loadDir(getParentForDirBrowser(mode, currentPath, initialPath))
  }

  const renderEntry = (item: FsEntry) => (
    <Pressable
      key={item.path}
      style={[styles.entry, { borderBottomColor: colors.border }]}
      disabled={loading}
      accessibilityState={{ disabled: loading }}
      onPress={() => void loadDir(item.path)}
      accessibilityRole="button"
      accessibilityLabel={item.name}
    >
      <Feather name="folder" size={14} color={colors.brand} />
      <Text style={[styles.entryName, styles.entryDir, { color: colors.text }]} numberOfLines={1}>
        {item.name}
      </Text>
      <Feather name="chevron-right" size={14} color={colors.textTertiary} />
    </Pressable>
  )

  const emptyLabel = t('no_subdirs')

  const content = (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {inline ? (
        <>
          <AppPageHeader title={t('remote_folder_add')} onBack={onClose} />
          <Text
            selectable
            numberOfLines={2}
            ellipsizeMode="middle"
            style={{
              paddingHorizontal: 18,
              paddingVertical: 12,
              color: colors.textSecondary,
              ...mobileTypography.metadata,
            }}
          >
            {currentPath === FILE_SYSTEM_ROOTS_PATH ? t('fs_roots') : currentPath}
          </Text>
        </>
      ) : (
        <View
          style={[
            styles.header,
            {
              borderBottomColor: colors.border,
              paddingTop: Platform.OS === 'ios' ? 8 : insets.top + 8,
            },
          ]}
        >
          <View style={styles.headerStatus}>
            {loading ? <ActivityIndicator size="small" color={colors.brand} /> : null}
          </View>
          <View style={styles.headerCenter}>
            <Text
              style={[styles.headerTitle, { color: colors.text }]}
              numberOfLines={2}
              ellipsizeMode="middle"
            >
              {currentPath === FILE_SYSTEM_ROOTS_PATH ? t('fs_roots') : currentPath}
            </Text>
          </View>
          <Pressable
            style={({ pressed }) => [
              styles.closeBtn,
              pressed && { backgroundColor: colors.surfaceHover },
            ]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t('close')}
          >
            <Feather name="x" size={24} color={colors.text} />
          </Pressable>
        </View>
      )}

      {!!error && (
        <View style={[styles.errorBar, { backgroundColor: colors.error + '18' }]}>
          <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
          <Pressable onPress={() => void loadDir(currentPath || initialPath || '~')}>
            <Text style={[styles.retryText, { color: colors.error }]}>{t('retry')}</Text>
          </Pressable>
        </View>
      )}

      {canNavigateUp ? (
        <Pressable
          style={[
            styles.navRow,
            { borderBottomColor: colors.border, backgroundColor: colors.surface },
          ]}
          onPress={goUp}
          disabled={loading}
          accessibilityRole="button"
          accessibilityState={{ disabled: loading }}
          accessibilityLabel={t('go_up')}
        >
          <Feather name="arrow-up" size={14} color={colors.textTertiary} />
          <Text style={[styles.navText, { color: colors.textSecondary }]}>{t('go_up')}</Text>
        </Pressable>
      ) : null}

      {Platform.OS === 'web' ? (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.webListContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
        >
          {visibleWebDirs.map(renderEntry)}
          {!loading && !error && filteredDirs.length === 0 ? (
            <Text style={[styles.empty, { color: colors.textTertiary }]}>{emptyLabel}</Text>
          ) : null}
          {remainingWebDirs > 0 ? (
            <Pressable
              style={[
                styles.loadMoreBtn,
                { borderColor: colors.border, backgroundColor: colors.surface },
              ]}
              onPress={() => setVisibleCount((count) => count + DIR_BROWSER_WEB_PAGE_SIZE)}
              accessibilityRole="button"
              accessibilityLabel={t('load_more_dirs', {
                count: Math.min(DIR_BROWSER_WEB_PAGE_SIZE, remainingWebDirs),
              })}
            >
              <Text style={[styles.loadMoreText, { color: colors.brand }]}>
                {t('load_more_dirs', {
                  count: Math.min(DIR_BROWSER_WEB_PAGE_SIZE, remainingWebDirs),
                })}
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      ) : (
        <FlatList
          data={filteredDirs}
          keyExtractor={(item) => item.path}
          style={styles.list}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => renderEntry(item)}
          initialNumToRender={12}
          maxToRenderPerBatch={24}
          windowSize={9}
          ListEmptyComponent={
            !loading && !error ? (
              <Text style={[styles.empty, { color: colors.textSecondary }]}>{emptyLabel}</Text>
            ) : null
          }
        />
      )}

      <View
        style={[
          styles.footer,
          {
            borderTopColor: colors.border,
            backgroundColor: inline ? colors.bg : colors.surface,
            paddingBottom: inline ? 12 : Math.max(12, insets.bottom + 12),
          },
        ]}
      >
        <Pressable
          style={[
            styles.selectBtn,
            { backgroundColor: colors.brand },
            !canSelect && { opacity: 0.5 },
          ]}
          onPress={() => {
            if (!canSelect) return
            onSelect(currentPath)
            if (closeOnSelect) onClose()
          }}
          disabled={!canSelect}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSelect }}
          accessibilityLabel={t('select_this_dir')}
        >
          <Text style={styles.selectBtnText}>{t('select_this_dir')}</Text>
        </Pressable>
      </View>
    </View>
  )
  return inline ? (
    content
  ) : (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {content}
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: 12,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  closeBtn: {
    width: Platform.OS === 'android' ? 48 : 44,
    height: Platform.OS === 'android' ? 48 : 44,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  headerCenter: { flex: 1, minWidth: 0 },
  headerTitle: {
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
    ...(Platform.OS !== 'web' && mobileTypography.compactAction),
  },
  headerStatus: { width: 24, alignItems: 'center', justifyContent: 'center' },
  errorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  errorText: { fontSize: 12, flex: 1, ...(Platform.OS !== 'web' && mobileTypography.metadata) },
  retryText: {
    fontSize: 12,
    marginLeft: 8,
    textDecorationLine: 'underline',
    ...(Platform.OS !== 'web' && mobileTypography.compactAction),
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navText: {
    fontSize: 13,
    fontWeight: '500',
    ...(Platform.OS !== 'web' && mobileTypography.secondary),
  },
  list: { flex: 1, minHeight: 0 },
  webListContent: { flexGrow: 1 },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  entryName: { flex: 1, fontSize: 14, ...(Platform.OS !== 'web' && mobileTypography.secondary) },
  entryDir: { fontWeight: Platform.OS === 'web' ? '500' : '400' },
  empty: { textAlign: 'center', paddingVertical: 32, fontSize: 13 },
  loadMoreBtn: {
    alignSelf: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 9,
    paddingHorizontal: 16,
    paddingVertical: 9,
    marginVertical: 12,
  },
  loadMoreText: { fontSize: 13, fontWeight: '600' },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  selectBtn: { borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  selectBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    ...(Platform.OS !== 'web' && mobileTypography.navigationTitle),
  },
})
