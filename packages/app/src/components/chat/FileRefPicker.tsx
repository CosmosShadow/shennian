import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  StyleSheet,
  Modal,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import Feather from '@expo/vector-icons/Feather'
import { useSheetsStore } from '@shennian/shared'
import { useTheme } from '../../hooks/useTheme'
import type { FsEntry, ReqFrame, ResFrame } from '@shennian/wire'
import { FILE_SYSTEM_ROOTS_PATH, canGoUp, getParentDirectoryPath } from '../../utils/directoryNavigation'

type SendFn = (frame: Omit<ReqFrame, 'id'>) => Promise<ResFrame>

export function FileRefPicker({
  send,
  workDir,
  onInsertRef,
}: {
  send: SendFn
  workDir: string
  onInsertRef: (path: string) => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const isOpen = useSheetsStore((s) => s.fileRefPickerOpen)
  const close = useSheetsStore((s) => s.closeFileRefPicker)
  const { width } = useWindowDimensions()
  const isMobile = Platform.OS !== 'web' || width < 768

  const [search, setSearch] = useState('')
  const [currentPath, setCurrentPath] = useState('')
  const [entries, setEntries] = useState<FsEntry[]>([])
  const [loading, setLoading] = useState(false)
  const searchRef = useRef<TextInput>(null)

  const filteredEntries = useMemo(() => {
    const visible = entries.filter((e) => !e.name.startsWith('.'))
    if (!search.trim()) return visible
    const q = search.trim().toLowerCase()
    return visible.filter((e) => e.name.toLowerCase().includes(q))
  }, [entries, search])

  const loadDir = useCallback(
    async (p: string) => {
      setLoading(true)
      try {
        const res = await send({
          type: 'req',
          method: 'fs.ls',
          params: { path: p || workDir || '~' },
        })
        if (res.ok) {
          const payload = res.payload as { path: string; entries: FsEntry[] }
          setCurrentPath(payload.path)
          setEntries(payload.entries)
        }
      } catch {
        // ignore
      } finally {
        setLoading(false)
      }
    },
    [send, workDir],
  )

  useEffect(() => {
    if (isOpen) {
      setSearch('')
      void loadDir(workDir || '~')
      setTimeout(() => searchRef.current?.focus(), 300)
    }
  }, [isOpen, loadDir, workDir])

  const handleSelect = (entry: FsEntry) => {
    if (entry.isDir) {
      setSearch('')
      void loadDir(entry.path)
    } else {
      onInsertRef(entry.path)
      close()
    }
  }

  const goUp = () => {
    setSearch('')
    void loadDir(getParentDirectoryPath(currentPath))
  }

  const canNavigateUp = canGoUp(currentPath)

  const content = (
    <View style={[styles.card, { backgroundColor: colors.bg, borderColor: colors.border }, isMobile && styles.cardMobile]}>
      {/* Search header */}
      <View style={[styles.searchRow, { borderBottomColor: colors.border }]}>
        <Feather name="search" size={14} color={colors.textTertiary} />
        <TextInput
          ref={searchRef}
          style={[styles.searchInput, { color: colors.text }]}
          placeholder={t('search_files')}
          placeholderTextColor={colors.textTertiary}
          value={search}
          onChangeText={setSearch}
          autoFocus={!isMobile}
        />
        {canNavigateUp && (
          <Pressable onPress={goUp} hitSlop={8} accessibilityLabel={t('go_up')}>
            <Feather name="arrow-up" size={14} color={colors.brand} />
          </Pressable>
        )}
        <Pressable onPress={close} hitSlop={8} accessibilityLabel={t('close')}>
          <Feather name="x" size={16} color={colors.textTertiary} />
        </Pressable>
      </View>

      {/* Path breadcrumb */}
      {currentPath ? (
        <View style={[styles.pathRow, { borderBottomColor: colors.border }]}>
          <Text style={[styles.pathText, { color: colors.textTertiary }]} numberOfLines={1}>
            {currentPath === FILE_SYSTEM_ROOTS_PATH ? t('fs_roots') : currentPath}
          </Text>
        </View>
      ) : null}

      {/* File list */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="small" color={colors.brand} />
        </View>
      ) : (
        <FlatList
          data={filteredEntries}
          keyExtractor={(item) => item.path}
          keyboardShouldPersistTaps="handled"
          style={styles.list}
          renderItem={({ item }) => (
            <Pressable style={[styles.entry, { borderBottomColor: colors.border }]} onPress={() => handleSelect(item)}>
              <Feather
                name={item.isDir ? 'folder' : 'file-text'}
                size={13}
                color={item.isDir ? colors.brand : colors.textTertiary}
                style={styles.entryIcon}
              />
              <Text
                style={[
                  styles.entryName,
                  { color: item.isDir ? colors.text : colors.textSecondary },
                  item.isDir && { fontWeight: '600' as const },
                ]}
                numberOfLines={1}
              >
                {item.name}
              </Text>
              {!item.isDir && <Text style={[styles.atHint, { color: colors.brand }]}>@</Text>}
            </Pressable>
          )}
          ListEmptyComponent={
            <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
              {search ? t('no_files') : t('empty_dir')}
            </Text>
          }
        />
      )}
    </View>
  )

  return (
    <Modal visible={isOpen} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.overlay} onPress={close}>
        <View style={isMobile ? styles.mobileWrap : styles.desktopWrap}>
          <Pressable>{content}</Pressable>
        </View>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
    justifyContent: 'flex-end',
  },
  desktopWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mobileWrap: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  card: {
    width: 380,
    maxHeight: 420,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 20,
  },
  cardMobile: {
    width: '100%',
    maxHeight: '60%',
    borderRadius: 0,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 0,
    borderTopWidth: 1,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 2,
  },
  pathRow: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pathText: {
    fontSize: 10,
  },
  center: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  list: {
    maxHeight: 320,
  },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  entryIcon: {
    width: 18,
    textAlign: 'center',
  },
  entryName: {
    fontSize: 13,
    flex: 1,
  },
  atHint: {
    fontSize: 12,
    fontWeight: '700',
    opacity: 0.6,
  },
  emptyText: {
    textAlign: 'center',
    paddingVertical: 24,
    fontSize: 12,
  },
})
