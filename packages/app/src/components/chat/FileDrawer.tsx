import { useContextualSteward } from '../../features/steward/ContextualStewardContext'
import { ActionIconButton } from '../ActionIconButton'
import { DownloadFeedback } from '../DownloadFeedback'
// @arch docs/architecture/app/chat-attachments-preview.md
// @arch docs/features/desktop-local-first-client.md#84-desktop-文件夹上传
// @test packages/app/src/__tests__/file-drawer-actions.test.ts

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { View, Text, Pressable, FlatList, ActivityIndicator, Platform } from 'react-native'
import { useTranslation } from 'react-i18next'
import Feather from '@expo/vector-icons/Feather'
import { useTheme } from '../../hooks/useTheme'
import { styles } from './FileDrawer.styles'
import { FileRow, isTreeNode, type FileListRow, type TreeNode } from './FileDrawerRow'
import { FilePreview } from './FilePreview'
import type { FsEntry } from '@shennian/wire'
import {
  FILE_SYSTEM_ROOTS_PATH,
  canGoUp,
  canGoUpWithinRoot,
  getParentDirectoryPath,
} from '../../utils/directoryNavigation'
import { isPreviewable, formatSize, sanitizeTestIdPart, type SendFn } from './fileOperations'
import {
  normalizeLocalResourceHref,
  parseLocalResourceLocation,
  resolveResourcePath,
} from '../../features/chat/utils/attachments'
import { getPreviewFileType } from './filePreviewLanguage'
import { getFileDrawerActionIds, getFilePreviewActionIds } from './fileDrawerActions'
import type {
  FilePreviewSelection,
  FileSelectionAiActionId,
  FileSelectionAiRequest,
  FileSelectionQuoteRequest,
} from './fileSelectionAi'
import { useKeyboardShortcut } from '../../hooks/useKeyboardShortcut'
import { ProgressBar } from './FileDrawerProgress'
import { MarkdownWysiwygEditor } from './MarkdownWysiwygEditor'
import { useFileTransfers } from './useFileTransfers'
import { useFilePreviewController } from './useFilePreviewController'
import { HeaderBackButton } from '../AppPageHeader'
import { FileDirectoryHeader } from './FileDirectoryHeader'
import { FileBrowserMenu } from './FileBrowserMenu'

export type { SendFn }

export function FilePanel({
  send,
  onDirectoryChange,
  workDir,
  previewRequest,
  onInsertRef,
  onSelectionAiAction,
  onSelectionQuoteAction,
  refreshToken = 0,
  onClose,
  presentation = 'sidebar',
  readOnly = false,
  rootPath = '',
  allowUpload = !readOnly,
}: {
  send: SendFn
  onDirectoryChange?: (path: string) => void
  workDir: string
  previewRequest?: {
    id: number
    path: string
    name: string
    kind?: 'folder'
    line?: number
    endLine?: number
  } | null
  onInsertRef: (path: string) => void
  onSelectionAiAction?: (request: FileSelectionAiRequest) => void
  onSelectionQuoteAction?: (request: FileSelectionQuoteRequest) => void
  refreshToken?: number
  onClose: () => void
  presentation?: 'sidebar' | 'fullscreen'
  readOnly?: boolean
  rootPath?: string
  allowUpload?: boolean
}) {
  const setDirectoryUpload = useContextualSteward()?.setDirectoryUpload
  const { t } = useTranslation()
  const { colors, isDark } = useTheme()

  const [currentPath, setCurrentPath] = useState('')
  useEffect(() => { onDirectoryChange?.(currentPath || workDir) }, [currentPath, workDir, onDirectoryChange])
  const [entries, setEntries] = useState<FsEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [menuVisible, setMenuVisible] = useState(false)
  const [showHiddenEntries, setShowHiddenEntries] = useState(false)
  const [treeMode, setTreeMode] = useState(false)
  const [expandedTreePaths, setExpandedTreePaths] = useState<Set<string>>(new Set())
  const [treeChildren, setTreeChildren] = useState<Map<string, FsEntry[]>>(new Map())
  const [treeLoadingPath, setTreeLoadingPath] = useState<string | null>(null)
  const [refFeedbackPath, setRefFeedbackPath] = useState<string | null>(null)
  const refFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [dropTarget, setDropTarget] = useState<View | null>(null)
  const bindDropTarget = useCallback((value: View | null) => setDropTarget(value), [])

  const visibleEntries = useMemo(
    () => (showHiddenEntries ? entries : entries.filter((e) => !e.name.startsWith('.'))),
    [entries, showHiddenEntries],
  )
  const downloadIndexByPath = useMemo(() => {
    const mapping = new Map<string, number>()
    let index = 0
    for (const entry of visibleEntries) {
      if (entry.isDir) continue
      mapping.set(entry.path, index)
      index += 1
    }
    return mapping
  }, [visibleEntries])
  const treeRows = useMemo(() => {
    const root: FsEntry = {
      name: currentPath || workDir || '~',
      path: currentPath || workDir || '~',
      isDir: true,
    }
    const rows: TreeNode[] = [{ entry: root, depth: 0 }]
    const append = (dir: FsEntry, depth: number) => {
      if (!expandedTreePaths.has(dir.path)) return
      const children = treeChildren.get(dir.path) ?? []
      for (const child of children.filter((e) => showHiddenEntries || !e.name.startsWith('.'))) {
        rows.push({ entry: child, depth })
        if (child.isDir) append(child, depth + 1)
      }
    }
    append(root, 1)
    return rows
  }, [currentPath, expandedTreePaths, showHiddenEntries, treeChildren, workDir])
  const listRows = useMemo(
    () => (treeMode ? treeRows : visibleEntries) as FileListRow[],
    [treeMode, treeRows, visibleEntries],
  )
  const loadDir = useCallback(
    async (p: string) => {
      setLoading(true)
      setError('')
      try {
        const res = await send({
          type: 'req',
          method: 'fs.ls',
          params: { path: p || workDir || '~' },
        })
        if (!res.ok) {
          setError(res.error ?? t('load_dir_failed'))
          return
        }
        const payload = res.payload as { path: string; entries: FsEntry[] }
        setCurrentPath(payload.path)
        setEntries(payload.entries)
        setTreeChildren((prev) => {
          const next = new Map(prev)
          next.set(payload.path, payload.entries)
          return next
        })
        if (treeMode) {
          setExpandedTreePaths((prev) => {
            if (prev.has(payload.path)) return prev
            const next = new Set(prev)
            next.add(payload.path)
            return next
          })
        }
      } catch {
        setError(t('load_dir_failed'))
      } finally {
        setLoading(false)
      }
    },
    [send, workDir, t, treeMode],
  )

  const {
    activePreviewPathRef,
    editDraft,
    editingMarkdown,
    loadFilePreview,
    previewCacheRef,
    previewContent,
    previewData,
    previewError,
    previewFile,
    previewLoading,
    savingEdit,
    setEditDraft,
    setEditingMarkdown,
    setPreviewContent,
    setPreviewData,
    setPreviewError,
    setPreviewFile,
    setSavingEdit,
    setView,
    view,
  } = useFilePreviewController({ loadDir, previewRequest, send, t })

  const [selectedListIndex, setSelectedListIndex] = useState(-1)
  const listRef = useRef<FlatList<FileListRow>>(null)

  useEffect(() => {
    setSelectedListIndex(-1)
  }, [currentPath, treeMode])

  useEffect(() => {
    if (view !== 'list' || selectedListIndex < 0 || listRows.length === 0) return
    try {
      listRef.current?.scrollToIndex({
        index: selectedListIndex,
        animated: true,
        viewPosition: 0.5,
      })
    } catch {
      // VirtualizedList may not know every row height yet; the visual selection still updates.
    }
  }, [listRows.length, selectedListIndex, view])

  const moveFileSelection = useCallback(
    (delta: number) => {
      if (view !== 'list' || listRows.length === 0) return
      setSelectedListIndex((current) =>
        Math.max(
          0,
          Math.min(
            listRows.length - 1,
            current < 0 ? (delta > 0 ? 0 : listRows.length - 1) : current + delta,
          ),
        ),
      )
    },
    [listRows.length, view],
  )

  useKeyboardShortcut({ key: 'j' }, view === 'list', () => moveFileSelection(1))
  useKeyboardShortcut({ key: 'k' }, view === 'list', () => moveFileSelection(-1))
  useKeyboardShortcut({ key: 'arrowdown' }, view === 'list', () => moveFileSelection(1))
  useKeyboardShortcut({ key: 'arrowup' }, view === 'list', () => moveFileSelection(-1))

  const loadTreeChildren = useCallback(
    async (dirPath: string) => {
      setTreeLoadingPath(dirPath)
      try {
        const res = await send({
          type: 'req',
          method: 'fs.ls',
          params: { path: dirPath || workDir || '~' },
        })
        if (!res.ok) throw new Error(res.error ?? t('load_dir_failed'))
        const payload = res.payload as { path: string; entries: FsEntry[] }
        setTreeChildren((prev) => {
          const next = new Map(prev)
          next.set(payload.path, payload.entries)
          return next
        })
      } catch (err) {
        setDownloadNotice({
          type: 'error',
          message: err instanceof Error ? err.message : t('load_dir_failed'),
        })
      } finally {
        setTreeLoadingPath(null)
      }
    },
    [send, t, workDir],
  )

  const toggleTreeNode = useCallback(
    (entry: FsEntry) => {
      if (!entry.isDir) {
        handlePress(entry)
        return
      }
      setExpandedTreePaths((prev) => {
        const next = new Set(prev)
        if (next.has(entry.path)) {
          next.delete(entry.path)
        } else {
          next.add(entry.path)
          if (!treeChildren.has(entry.path)) void loadTreeChildren(entry.path)
        }
        return next
      })
    },
    [loadTreeChildren, treeChildren],
  )

  const {
    downloadDirectoryFromList,
    downloadFileFromList,
    downloadNotice,
    downloadPct,
    downloadingPath,
    handleDownload,
    handleUpload,
    handleUploadFolder,
    setDownloadNotice,
    uploadLabel,
    uploadPct,
  } = useFileTransfers({
    currentPath,
    readOnly,
    allowUpload,
    dropTarget: readOnly ? null : dropTarget,
    loadDir,
    previewContent,
    previewData,
    previewFile,
    send,
    t,
    workDir,
  })

  const handleRename = useCallback(
    async (entry: FsEntry) => {
      if (typeof window === 'undefined') return
      const nextName = window.prompt(t('rename_prompt'), entry.name)
      if (!nextName || nextName === entry.name) return
      try {
        const res = await send({
          type: 'req',
          method: 'fs.rename',
          params: {
            path: entry.path,
            rootPath: currentPath || workDir || entry.path,
            newName: nextName,
          },
        })
        if (!res.ok) throw new Error(res.error ?? t('rename_failed'))
        previewCacheRef.current.delete(entry.path)
        setDownloadNotice({ type: 'success', message: t('rename_success') })
        void loadDir(currentPath || workDir || '~')
      } catch (err) {
        setDownloadNotice({
          type: 'error',
          message: err instanceof Error ? err.message : t('rename_failed'),
        })
      }
    },
    [currentPath, loadDir, send, t, workDir],
  )

  useEffect(() => {
    if (!currentPath) {
      void loadDir(workDir || '~')
    }
  }, [currentPath, loadDir, workDir])

  useEffect(
    () => () => {
      if (refFeedbackTimerRef.current) {
        clearTimeout(refFeedbackTimerRef.current)
      }
    },
    [],
  )

  const insertRefWithFeedback = useCallback(
    (path: string) => {
      if (refFeedbackPath === path) return
      if (refFeedbackTimerRef.current) {
        clearTimeout(refFeedbackTimerRef.current)
      }
      setRefFeedbackPath(path)
      onInsertRef(path)
      refFeedbackTimerRef.current = setTimeout(() => {
        setRefFeedbackPath(null)
        refFeedbackTimerRef.current = null
      }, 900)
    },
    [onInsertRef, refFeedbackPath],
  )

  const goUp = () => {
    void loadDir(getParentDirectoryPath(currentPath))
  }

  const canNavigateUp = rootPath ? canGoUpWithinRoot(currentPath, rootPath) : canGoUp(currentPath)
  const isFullscreen = presentation === 'fullscreen'

  useEffect(() => {
    if (!isFullscreen || !allowUpload || !setDirectoryUpload || view !== 'list') return
    setDirectoryUpload({ path: currentPath || workDir, disabled: loading || !!error || uploadPct != null, onPress: handleUpload })
    return () => setDirectoryUpload(undefined)
  }, [isFullscreen, allowUpload, setDirectoryUpload, view, currentPath, workDir, loading, error, uploadPct, handleUpload])

  const handlePress = (entry: FsEntry) => {
    if (entry.isDir) {
      void loadDir(entry.path)
    } else {
      void loadFilePreview(entry)
    }
  }

  const handleMarkdownResourcePress = useCallback(
    (href: string) => {
      if (!previewFile) return
      const location = parseLocalResourceLocation(normalizeLocalResourceHref(href))
      if (!location.path || /^(?:https?:|mailto:|tel:)/i.test(location.path)) return
      const path = resolveResourcePath(location.path, getParentDirectoryPath(previewFile.path))
      const name = path.split(/[\\/]/).pop() || path
      if (!isPreviewable(name)) return
      void loadFilePreview({
        path,
        name,
        ...(location.line ? { line: location.line } : {}),
        ...(location.endLine ? { endLine: location.endLine } : {}),
      })
    },
    [loadFilePreview, previewFile],
  )

  const handleBackToList = () => {
    activePreviewPathRef.current = null
    setView('list')
    setPreviewFile(null)
    setPreviewContent(null)
    setPreviewData(null)
    setPreviewError('')
    setEditingMarkdown(false)
    setEditDraft('')
  }

  const handleInsertPreviewRef = useCallback(() => {
    if (!previewFile) return
    insertRefWithFeedback(previewFile.path)
  }, [insertRefWithFeedback, previewFile])

  const handleToggleMarkdownEdit = useCallback(() => {
    setEditingMarkdown((value) => {
      if (value) return false
      setEditDraft(previewContent ?? '')
      return true
    })
  }, [previewContent])

  const handleSaveMarkdownEdit = useCallback(async () => {
    if (!previewFile || savingEdit) return
    setSavingEdit(true)
    setDownloadNotice(null)
    try {
      const res = await send({
        type: 'req',
        method: 'fs.write',
        params: { path: previewFile.path, content: editDraft },
      })
      if (!res.ok) throw new Error(res.error ?? t('file_save_failed'))
      previewCacheRef.current.set(previewFile.path, { content: editDraft, data: null, error: '' })
      activePreviewPathRef.current = previewFile.path
      setPreviewContent(editDraft)
      setPreviewData(null)
      setEditingMarkdown(false)
      setDownloadNotice({
        type: 'success',
        message: t('file_saved', { name: previewFile.name }),
      })
      void loadDir(currentPath || workDir || '~')
    } catch (error) {
      setDownloadNotice({
        type: 'error',
        message: error instanceof Error && error.message ? error.message : t('file_save_failed'),
      })
    } finally {
      setSavingEdit(false)
    }
  }, [currentPath, editDraft, loadDir, previewFile, savingEdit, send, t, workDir])

  const handleSelectionAiAction = useCallback(
    (actionId: FileSelectionAiActionId, selection: FilePreviewSelection) => {
      if (!previewFile || !selection.text.trim()) return
      onSelectionAiAction?.({
        actionId,
        filePath: previewFile.path,
        filename: previewFile.name,
        selectedText: selection.text,
      })
    },
    [onSelectionAiAction, previewFile],
  )

  const handleSelectionQuoteAction = useCallback(
    (selection: FilePreviewSelection) => {
      if (!previewFile || !selection.text.trim()) return
      onSelectionQuoteAction?.({
        filePath: previewFile.path,
        filename: previewFile.name,
        selectedText: selection.text,
        ...(selection.line ? { line: selection.line } : {}),
        ...(selection.endLine ? { endLine: selection.endLine } : {}),
      })
    },
    [onSelectionQuoteAction, previewFile],
  )

  useEffect(() => {
    if (!refreshToken || !previewFile || activePreviewPathRef.current !== previewFile.path) return
    void loadFilePreview(previewFile, { force: true })
  }, [loadFilePreview, previewFile, refreshToken])

  const renderDownloadNotice = () => {
    if (!downloadNotice) return null
    return <DownloadFeedback notice={downloadNotice} onHide={() => setDownloadNotice(null)} />
  }

  if (view === 'preview' && previewFile) {
    const isPreviewDownloading = downloadingPath === previewFile.path
    const previewRefFeedbackActive = refFeedbackPath === previewFile.path
    const canEditMarkdown =
      !readOnly && getPreviewFileType(previewFile.name) === 'markdown' && previewContent != null
    const previewActionIds = getFilePreviewActionIds(isFullscreen, canEditMarkdown, readOnly)
    return (
      <View
        ref={bindDropTarget}
        style={[styles.container, { backgroundColor: colors.bg }]}
        testID="file-browser-preview"
      >
        <View
          style={[
            styles.header,
            {
              borderBottomColor: colors.border,
              backgroundColor: isFullscreen ? colors.bg : colors.surface,
            },
          ]}
        >
          <HeaderBackButton onPress={handleBackToList} />
          <View style={styles.headerLeft}>
            <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
              {previewFile.name}
            </Text>
          </View>
          <View style={styles.headerActions}>
            {previewActionIds.map((actionId) => {
              if (actionId === 'edit') {
                return (
                  <Pressable
                    key={actionId}
                    style={[
                      styles.headerActionBtn,
                      editingMarkdown && { backgroundColor: `${colors.brand}14` },
                    ]}
                    onPress={handleToggleMarkdownEdit}
                    disabled={!canEditMarkdown || savingEdit}
                    accessibilityLabel={editingMarkdown ? t('preview_mode') : t('edit_markdown')}
                    testID="file-preview-edit"
                  >
                    <Feather
                      name={editingMarkdown ? 'eye' : 'edit-3'}
                      size={14}
                      color={editingMarkdown ? colors.brand : colors.textSecondary}
                    />
                  </Pressable>
                )
              }
              if (actionId === 'insert-ref') {
                return (
                  <Pressable
                    key={actionId}
                    style={[
                      styles.headerActionBtn,
                      previewRefFeedbackActive && { backgroundColor: `${colors.brand}14` },
                    ]}
                    onPress={handleInsertPreviewRef}
                    disabled={previewRefFeedbackActive}
                    accessibilityLabel={t('insert_ref')}
                    accessibilityState={{
                      disabled: previewRefFeedbackActive,
                      selected: previewRefFeedbackActive,
                    }}
                    testID="file-preview-insert-ref"
                  >
                    {previewRefFeedbackActive ? (
                      <Feather name="check" size={15} color={colors.brand} />
                    ) : (
                      <Text style={[styles.headerAtText, { color: colors.brand }]}>@</Text>
                    )}
                  </Pressable>
                )
              }
              return (
                <Pressable
                  key={actionId}
                  style={[styles.closeBtn, { backgroundColor: colors.surfaceHover }]}
                  onPress={onClose}
                  accessibilityLabel={t('close')}
                >
                  <Feather name="x" size={15} color={colors.textSecondary} />
                </Pressable>
              )
            })}
          </View>
        </View>

        {renderDownloadNotice()}

        {editingMarkdown ? (
          <View
            style={[
              styles.editToolbar,
              {
                borderBottomColor: colors.border,
                backgroundColor: isFullscreen ? colors.bg : colors.surface,
              },
            ]}
          >
            <Text style={[styles.editToolbarText, { color: colors.textTertiary }]}>
              {t('markdown_editing')}
            </Text>
            <View style={styles.editToolbarActions}>
              <Pressable
                style={[styles.editToolbarBtn, { backgroundColor: colors.surfaceHover }]}
                onPress={() => {
                  setEditDraft(previewContent ?? '')
                  setEditingMarkdown(false)
                }}
                disabled={savingEdit}
              >
                <Text style={[styles.editToolbarBtnText, { color: colors.textSecondary }]}>
                  {t('cancel')}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.editToolbarBtn, { backgroundColor: colors.brand }]}
                onPress={() => void handleSaveMarkdownEdit()}
                disabled={savingEdit}
                testID="file-preview-save-markdown"
              >
                <Text style={[styles.editToolbarBtnText, { color: '#fff' }]}>
                  {savingEdit ? t('saving') : t('save')}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <View style={styles.previewArea}>
          {editingMarkdown ? (
            Platform.OS === 'web' ? (
              <MarkdownWysiwygEditor
                value={editDraft}
                colors={colors}
                isDark={isDark}
                onChange={setEditDraft}
              />
            ) : (
              <Text style={[styles.errorText, { color: colors.textTertiary, padding: 16 }]}>
                {t('preview_not_supported')}
              </Text>
            )
          ) : getPreviewFileType(previewFile.name) === 'unknown' || previewError ? (
            <View style={styles.fileDetails}>
              <View style={[styles.fileDetailIcon, { backgroundColor: colors.surfaceHover }]}>
                <Feather name="file" size={40} color={colors.brand} />
              </View>
              <Text selectable style={[styles.fileDetailName, { color: colors.text }]}>
                {previewFile.name}
              </Text>
              <Text style={[styles.fileDetailMeta, { color: colors.textSecondary }]}>
                {previewFile.size != null ? formatSize(previewFile.size) : t('file_size_unknown')}
              </Text>
              <Text selectable style={[styles.fileDetailPath, { color: colors.textTertiary }]}>
                {previewFile.path}
              </Text>
              <Text style={[styles.fileDetailMeta, { color: colors.textTertiary }]}>
                {previewError || t('preview_not_supported')}
              </Text>
            </View>
          ) : (
            <FilePreview
              filename={previewFile.name}
              content={previewContent}
              data={previewData}
              loading={previewLoading}
              error={previewError}
              colors={colors}
              isDark={isDark}
              onSelectionAiAction={onSelectionAiAction ? handleSelectionAiAction : undefined}
              onSelectionQuoteAction={
                onSelectionQuoteAction ? handleSelectionQuoteAction : undefined
              }
              onResourcePress={handleMarkdownResourcePress}
              targetLine={previewFile.line}
              targetEndLine={previewFile.endLine}
            />
          )}
        </View>
        <View
          style={[
            styles.downloadFooter,
            {
              borderTopColor: colors.border,
              backgroundColor: isFullscreen ? colors.bg : colors.surface,
            },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('file_action_download', { name: previewFile.name })}
            disabled={isPreviewDownloading}
            onPress={handleDownload}
            testID="file-preview-download"
            style={[styles.downloadButton, { backgroundColor: colors.brand }]}
          >
            {isPreviewDownloading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Feather name="download" size={18} color="#fff" />
            )}
            <Text style={styles.downloadButtonText}>
              {isPreviewDownloading ? `${downloadPct}%` : t('download')}
            </Text>
          </Pressable>
        </View>
      </View>
    )
  }

  const drawerActionIds = getFileDrawerActionIds(isFullscreen, !allowUpload)
  const displayPath = currentPath || workDir || '~'
  const directoryTitle =
    currentPath === FILE_SYSTEM_ROOTS_PATH
      ? t('fs_roots')
      : displayPath.split(/[\\/]/).filter(Boolean).pop() || displayPath

  return (
    <View
      ref={bindDropTarget}
      style={[styles.container, { backgroundColor: colors.bg }]}
      testID="file-browser-panel"
    >
      {isFullscreen ? (
        <FileDirectoryHeader
          title={directoryTitle}
          path={displayPath}
          rootPath={rootPath || workDir}
          onNavigate={(path) => void loadDir(path)}
          onBack={canNavigateUp ? goUp : onClose}
          onMore={() => setMenuVisible(true)}
        />
      ) : (
        <View
          style={[
            styles.header,
            {
              borderBottomColor: colors.border,
              backgroundColor: isFullscreen ? colors.bg : colors.surface,
            },
          ]}
        >
          {isFullscreen ? <HeaderBackButton onPress={onClose} /> : null}
          <View style={styles.headerLeft}>
            <Text
              style={[styles.headerTitle, { color: colors.text }]}
              numberOfLines={1}
              ellipsizeMode="middle"
              accessibilityLabel={currentPath || workDir}
            >
              {currentPath === FILE_SYSTEM_ROOTS_PATH
                ? t('fs_roots')
                : currentPath || workDir || '~'}
            </Text>
          </View>
          <View style={styles.headerActions}>
            {drawerActionIds.map((actionId) => {
              if (actionId === 'upload') {
                return uploadPct != null ? (
                  <Text key={actionId} style={[styles.pctText, { color: colors.brand }]}>
                    {uploadPct}%
                  </Text>
                ) : (
                  <Pressable
                    key={actionId}
                    style={styles.headerActionBtn}
                    onPress={handleUpload}
                    accessibilityLabel={t('attach_file')}
                  >
                    <Feather name="upload" size={14} color={colors.textSecondary} />
                  </Pressable>
                )
              }
              if (actionId === 'upload-folder') {
                if (Platform.OS !== 'web') return null
                return uploadPct != null ? null : (
                  <Pressable
                    key={actionId}
                    style={styles.headerActionBtn}
                    onPress={handleUploadFolder}
                    accessibilityLabel={t('upload_folder')}
                  >
                    <Feather name="folder-plus" size={14} color={colors.textSecondary} />
                  </Pressable>
                )
              }
              if (actionId === 'tree') {
                return (
                  <Pressable
                    key={actionId}
                    style={[
                      styles.headerActionBtn,
                      treeMode && { backgroundColor: colors.brand + '14' },
                    ]}
                    onPress={() => {
                      setTreeMode((value) => {
                        const next = !value
                        if (next && currentPath) {
                          setExpandedTreePaths(new Set([currentPath]))
                          if (!treeChildren.has(currentPath)) void loadTreeChildren(currentPath)
                        }
                        return next
                      })
                    }}
                    accessibilityLabel={t('tree_view')}
                    accessibilityState={{ checked: treeMode }}
                  >
                    <Feather
                      name="list"
                      size={14}
                      color={treeMode ? colors.brand : colors.textSecondary}
                    />
                  </Pressable>
                )
              }
              if (actionId === 'more') {
                return (
                  <ActionIconButton icon="more" color={colors.textSecondary}
                    key={actionId}
                    style={styles.headerActionBtn}
                    onPress={() => setMenuVisible(true)}
                    label={t('more')}
                    testID="file-browser-more"
                   />
                )
              }
              return (
                <Pressable
                  key={actionId}
                  style={[styles.closeBtn, { backgroundColor: colors.surfaceHover }]}
                  onPress={onClose}
                  accessibilityLabel={t('close')}
                >
                  <Feather name="x" size={15} color={colors.textSecondary} />
                </Pressable>
              )
            })}
            {loading && <ActivityIndicator size="small" color={colors.brand} />}
          </View>
        </View>
      )}

      <FileBrowserMenu
        visible={menuVisible}
        showHidden={showHiddenEntries}
        onClose={() => setMenuVisible(false)}
        onToggleHidden={setShowHiddenEntries}
        onUpload={isFullscreen && allowUpload && !setDirectoryUpload && !loading && !error && uploadPct == null ? handleUpload : undefined}
      />
      {renderDownloadNotice()}

      {uploadPct != null && (
        <>
          {uploadLabel ? (
            <View
              style={[
                styles.noticeBar,
                { backgroundColor: `${colors.brand}10`, borderBottomColor: `${colors.brand}22` },
              ]}
            >
              <Text style={[styles.noticeText, { color: colors.brand }]}>
                {uploadLabel} {uploadPct}%
              </Text>
            </View>
          ) : null}
          <ProgressBar pct={uploadPct} color={colors.brand} />
        </>
      )}

      {error ? (
        <View
          style={[
            styles.errorBar,
            { backgroundColor: colors.error + '18', borderBottomColor: colors.error + '40' },
          ]}
        >
          <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
          <Pressable onPress={() => void loadDir(currentPath || workDir || '~')}>
            <Text style={[styles.retryText, { color: colors.error }]}>{t('retry')}</Text>
          </Pressable>
        </View>
      ) : null}

      {canNavigateUp && !isFullscreen ? (
        <Pressable
          style={[
            styles.navRow,
            {
              borderBottomColor: colors.border,
              backgroundColor: isFullscreen ? colors.bg : colors.surface,
            },
          ]}
          onPress={goUp}
          accessibilityLabel={t('go_up')}
        >
          <Feather
            name="arrow-up"
            size={14}
            color={colors.textTertiary}
            style={styles.entryIconFeather}
          />
          <Text style={[styles.navText, { color: colors.textSecondary }]}>{t('go_up')}</Text>
        </Pressable>
      ) : null}

      <FlatList
        ref={listRef}
        data={listRows}
        keyExtractor={(item) => (isTreeNode(item) ? item.entry.path : item.path)}
        horizontal={false}
        style={[styles.list, { backgroundColor: colors.bg }]}
        contentContainerStyle={styles.listContent}
        renderItem={({ item, index }) => {
          const row = isTreeNode(item) ? item : { entry: item, depth: 0 }
          const entry = row.entry
          const expanded = expandedTreePaths.has(entry.path)
          return (
            <View
              style={[
                treeMode ? { paddingLeft: Math.min(28, row.depth * 12) } : undefined,
                index === selectedListIndex ? { backgroundColor: `${colors.brand}10` } : null,
              ]}
            >
              <FileRow
                item={entry}
                downloadTestId={
                  entry.isDir
                    ? `folder-download-${sanitizeTestIdPart(entry.path)}`
                    : `file-download-${downloadIndexByPath.get(entry.path) ?? 0}`
                }
                colors={colors}
                onPress={() => (treeMode ? toggleTreeNode(entry) : handlePress(entry))}
                onDownload={
                  Platform.OS !== 'web' || (readOnly && entry.isDir)
                    ? undefined
                    : () =>
                        void (entry.isDir
                          ? downloadDirectoryFromList(entry)
                          : downloadFileFromList(entry))
                }
                onRef={readOnly ? undefined : () => insertRefWithFeedback(entry.path)}
                onRename={readOnly ? undefined : () => void handleRename(entry)}
                refFeedbackActive={refFeedbackPath === entry.path}
                isDownloading={downloadingPath === entry.path || treeLoadingPath === entry.path}
                downloadPct={downloadingPath === entry.path ? downloadPct : expanded ? 100 : 0}
              />
            </View>
          )
        }}
        ListEmptyComponent={
          !loading && !error ? (
            <Text style={[styles.emptyText, { color: colors.textTertiary }]}>{t('empty_dir')}</Text>
          ) : null
        }
      />
    </View>
  )
}
