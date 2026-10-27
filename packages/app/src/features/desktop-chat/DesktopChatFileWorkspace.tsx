// @arch docs/design/desktop/unified-desktop-control.md
// @test ../../__tests__/desktop-chat-file-workspace.test.ts

import Ionicons from '@expo/vector-icons/Ionicons'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import type { FsEntry } from '@shennian/wire'
import { isImageFile, sanitizeTestIdPart } from '../../components/chat/fileOperations'
import type {
  FileSelectionAiRequest,
  FileSelectionQuoteRequest,
} from '../../components/chat/fileSelectionAi'
import { useAuthStore } from '../../config/auth'
import type { Colors } from '../../hooks/useTheme'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useTheme } from '../../hooks/useTheme'
import { desktopControlMetrics, desktopTypography } from '../desktop-shell/desktopDesignTokens'
import { canGoUp, getParentDirectoryPath } from '../../utils/directoryNavigation'
import { getDesktopPointerEventTarget } from '../chat/utils/desktopPointerEvents'
import {
  DesktopFilePanelResize,
  bindDesktopFilePanelPointerEvents,
  desktopFilePanelState,
} from '../desktop-shell/desktopFilePanelState'
import { DesktopChatFilePreview, type DesktopChatFilePreviewState } from './DesktopChatFilePreview'
import { DesktopFileWorkspaceOperations } from './desktopFileWorkspaceOperations'
import {
  DESKTOP_SESSION_FILE_IMAGE_PREVIEW_MAX_BYTES,
  DESKTOP_SESSION_FILE_TEXT_PREVIEW_MAX_BYTES,
  desktopBytesToBase64,
  downloadDesktopSessionFile,
  listDesktopSessionFiles,
  readDesktopSessionFilePreview,
  revealDesktopSessionFile,
  type DesktopSessionFileScope,
} from './desktopSessionFiles'

type Props = {
  narrow: boolean
  width: number
  colors: Colors
  machineId: string
  sessionId: string
  workDir: string
  previewRequest?: {
    id: number
    path: string
    name: string
    kind?: 'folder'
    line?: number
    endLine?: number
  } | null
  onInsertRef?: (path: string) => void
  onSelectionAiAction?: (request: FileSelectionAiRequest) => void
  onSelectionQuoteAction?: (request: FileSelectionQuoteRequest) => void
  refreshRevision?: number
  onClose: () => void
}

const desktopNoDragStyle: ViewStyle & { WebkitAppRegion?: 'no-drag' } = {
  WebkitAppRegion: 'no-drag',
}

export function DesktopChatFileWorkspace(props: Props) {
  const {
    narrow,
    width,
    colors,
    machineId,
    sessionId,
    workDir,
    previewRequest,
    onInsertRef,
    onSelectionAiAction,
    onSelectionQuoteAction,
    refreshRevision = 0,
    onClose,
  } = props
  const { t } = useTranslation()
  const { isDark } = useTheme()
  useEscapeKey(true, onClose)

  const accountId = useAuthStore((state) => state.user?.id ?? '')
  const sessionFileScope = useMemo<DesktopSessionFileScope>(
    () => ({ accountId, machineId, sessionId, rootPath: workDir }),
    [accountId, machineId, sessionId, workDir],
  )
  const scope = useMemo(() => ({ accountId, width, narrow }), [accountId, width, narrow])
  const currentScope = useRef<typeof scope | null>(scope)
  currentScope.current = scope
  const resize = useMemo(
    () =>
      new DesktopFilePanelResize(
        desktopFilePanelState,
        accountId,
        width,
        narrow,
        () => currentScope.current === scope,
      ),
    [accountId, narrow, scope, width],
  )
  const pointerListeners = useMemo(() => ({ detach: null as (() => void) | null }), [resize])
  const [dragWidth, setDragWidth] = useState<{
    resize: DesktopFilePanelResize
    width: number
  } | null>(null)
  const panelWidth =
    dragWidth?.resize === resize
      ? dragWidth.width
      : desktopFilePanelState.displayedWidth(accountId, width)

  const handleResizeMove = useCallback(
    (event: PointerEvent) => {
      const next = resize.move(event.clientX)
      if (next !== null) setDragWidth({ resize, width: next })
    },
    [resize],
  )
  const finishResize = useCallback(() => resize.finish(), [resize])
  const cancelResize = useCallback(() => {
    resize.cancel()
    if (currentScope.current === scope) setDragWidth(null)
  }, [resize, scope])
  const startResize = useCallback(
    (event: { nativeEvent?: PointerEvent; preventDefault?: () => void }) => {
      if (narrow || !event.nativeEvent) return
      const pointerTarget = getDesktopPointerEventTarget()
      if (!pointerTarget) return
      event.preventDefault?.()
      if (!resize.start(event.nativeEvent.clientX, panelWidth)) return
      pointerListeners.detach?.()
      pointerListeners.detach = bindDesktopFilePanelPointerEvents(pointerTarget, {
        move: handleResizeMove,
        finish: finishResize,
        cancel: cancelResize,
      })
    },
    [cancelResize, finishResize, handleResizeMove, narrow, panelWidth, pointerListeners, resize],
  )
  useEffect(() => {
    currentScope.current = scope
    return () => {
      if (currentScope.current === scope) currentScope.current = null
      resize.cancel()
      pointerListeners.detach?.()
    }
  }, [pointerListeners, resize, scope])

  const [currentPath, setCurrentPath] = useState(workDir || '~')
  const [attemptedPath, setAttemptedPath] = useState(workDir || '~')
  const [resolvedRootPath, setResolvedRootPath] = useState('')
  const [entries, setEntries] = useState<FsEntry[]>([])
  const [nextCursor, setNextCursor] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<DesktopChatFilePreviewState | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [savedFile, setSavedFile] = useState<{ name: string; handle: string } | null>(null)
  const [notice, setNotice] = useState<{ kind: 'error' | 'success'; message: string } | null>(null)
  const operations = useMemo(() => new DesktopFileWorkspaceOperations(), [sessionFileScope])
  const previewRef = useRef(preview)
  const currentPathRef = useRef(currentPath)
  const previousRefreshRevision = useRef(refreshRevision)
  previewRef.current = preview
  currentPathRef.current = currentPath

  const loadDirectory = useCallback(
    async (path: string, cursor = 0) => {
      if (cursor === 0) {
        operations.invalidateLane('preview')
        operations.invalidateLane('download')
        operations.invalidateLane('reveal')
        setDownloading(false)
        setSavedFile(null)
        setNotice(null)
      }
      const operation = operations.begin('directory')
      setLoading(true)
      setError('')
      setAttemptedPath(path || workDir || '~')
      if (cursor === 0) setPreview(null)
      try {
        const response = await listDesktopSessionFiles(
          sessionFileScope,
          path || workDir || '~',
          cursor,
        )
        if (!operations.isCurrent(operation)) return
        setCurrentPath(response.path)
        setAttemptedPath(response.path)
        setResolvedRootPath(
          (value) => value || (cursor === 0 && (path === workDir || !path) ? response.path : value),
        )
        setEntries((value) => (cursor === 0 ? response.entries : [...value, ...response.entries]))
        setNextCursor(response.nextCursor)
      } catch (reason) {
        if (!operations.isCurrent(operation)) return
        setError(reason instanceof Error && reason.message ? reason.message : t('load_dir_failed'))
      } finally {
        if (operations.isCurrent(operation)) setLoading(false)
      }
    },
    [operations, sessionFileScope, t, workDir],
  )

  const loadPreview = useCallback(
    async (file: FsEntry, line?: number, endLine?: number) => {
      operations.invalidateLane('download')
      operations.invalidateLane('reveal')
      const operation = operations.begin('preview')
      setDownloading(false)
      setSavedFile(null)
      setNotice(null)
      setPreview({ file, content: null, data: null, loading: true, error: '', line, endLine })
      try {
        let content: string | null = null
        let data: string | null = null
        const image = isImageFile(file.name)
        const maxBytes = image
          ? DESKTOP_SESSION_FILE_IMAGE_PREVIEW_MAX_BYTES
          : DESKTOP_SESSION_FILE_TEXT_PREVIEW_MAX_BYTES
        const bytes = await readDesktopSessionFilePreview(sessionFileScope, file.path, maxBytes)
        if (image) data = desktopBytesToBase64(bytes)
        else content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        if (!operations.isCurrent(operation)) return
        setPreview({ file, content, data, loading: false, error: '', line, endLine })
      } catch {
        if (!operations.isCurrent(operation)) return
        setPreview({
          file,
          content: null,
          data: null,
          loading: false,
          error: t('desktop_file_preview_failed'),
          line,
          endLine,
        })
      }
    },
    [operations, sessionFileScope, t],
  )

  useEffect(() => {
    setCurrentPath(workDir || '~')
    setAttemptedPath(workDir || '~')
    setResolvedRootPath('')
    setEntries([])
    setNextCursor(null)
    setSavedFile(null)
    setNotice(null)
    void loadDirectory(workDir || '~')
    return () => {
      operations.invalidateAll()
    }
  }, [loadDirectory, operations, workDir])
  useEffect(() => {
    if (previousRefreshRevision.current === refreshRevision) return
    previousRefreshRevision.current = refreshRevision
    const currentPreview = previewRef.current
    if (currentPreview) {
      void loadPreview(currentPreview.file, currentPreview.line, currentPreview.endLine)
      return
    }
    void loadDirectory(currentPathRef.current)
  }, [loadDirectory, loadPreview, refreshRevision])
  useEffect(() => {
    if (!previewRequest?.path) return
    if (previewRequest.kind === 'folder') {
      void loadDirectory(previewRequest.path)
      return
    }
    void loadPreview(
      { name: previewRequest.name, path: previewRequest.path, isDir: false },
      previewRequest.line,
      previewRequest.endLine,
    )
  }, [loadDirectory, loadPreview, previewRequest])

  const openEntry = (entry: FsEntry) => {
    if (entry.isDir) void loadDirectory(entry.path)
    else void loadPreview(entry)
  }
  const downloadPreview = async () => {
    if (!preview || downloading) return
    const operation = operations.begin('download')
    setDownloading(true)
    setSavedFile(null)
    setNotice(null)
    try {
      const saved = await downloadDesktopSessionFile(
        sessionFileScope,
        preview.file.path,
        preview.file.name,
      )
      if (!operations.isCurrent(operation)) return
      if (saved.canceled) return
      setSavedFile(saved)
      setNotice({
        kind: 'success',
        message: t('download_saved_to_selected_location', { name: saved.name }),
      })
    } catch (reason) {
      if (!operations.isCurrent(operation)) return
      setNotice({
        kind: 'error',
        message: t('download_failed_with_reason', {
          name: preview.file.name,
          reason: reason instanceof Error ? reason.message : t('error_unknown'),
        }),
      })
    } finally {
      if (operations.isCurrent(operation)) setDownloading(false)
    }
  }
  const revealSavedFile = async () => {
    if (!savedFile) return
    const operation = operations.begin('reveal')
    try {
      await revealDesktopSessionFile(savedFile.handle)
    } catch (reason) {
      if (!operations.isCurrent(operation)) return
      setNotice({
        kind: 'error',
        message: reason instanceof Error ? reason.message : t('error_unknown'),
      })
    }
  }

  const panel = preview ? (
    <DesktopChatFilePreview
      colors={colors}
      isDark={isDark}
      preview={preview}
      downloading={downloading}
      canReveal={Boolean(savedFile)}
      notice={notice}
      onBack={() => {
        operations.invalidateAll()
        setPreview(null)
        setDownloading(false)
        setSavedFile(null)
        setNotice(null)
      }}
      onClose={onClose}
      onDownload={() => void downloadPreview()}
      onReveal={() => void revealSavedFile()}
      onReference={onInsertRef ? () => onInsertRef(preview.file.path) : undefined}
      onRetry={() => void loadPreview(preview.file, preview.line, preview.endLine)}
      onSelectionAiAction={(actionId, selection) =>
        onSelectionAiAction?.({
          actionId,
          filePath: preview.file.path,
          filename: preview.file.name,
          selectedText: selection.text,
        })
      }
      onSelectionQuoteAction={(selection) =>
        onSelectionQuoteAction?.({
          filePath: preview.file.path,
          filename: preview.file.name,
          selectedText: selection.text,
          ...(selection.line ? { line: selection.line } : {}),
          ...(selection.endLine ? { endLine: selection.endLine } : {}),
        })
      }
    />
  ) : (
    <View testID="desktop-file-browser" style={[styles.browser, { backgroundColor: colors.bg }]}>
      <View
        {...{ dataSet: { desktopDrag: 'true' } }}
        style={[styles.browserHeader, { borderBottomColor: colors.border }]}
      >
        <View style={styles.browserTitle}>
          <Text style={[styles.title, { color: colors.text }]}>{t('project_files')}</Text>
          <Text
            accessibilityLabel={error ? attemptedPath : currentPath}
            style={[styles.path, { color: colors.textTertiary }]}
            numberOfLines={1}
            ellipsizeMode="middle"
          >
            {error ? attemptedPath : currentPath}
          </Text>
        </View>
        <ToolbarIcon
          icon="refresh"
          label={t('refresh')}
          colors={colors}
          disabled={loading}
          onPress={() => void loadDirectory(currentPath)}
        />
        <ToolbarIcon icon="close" label={t('close')} colors={colors} onPress={onClose} />
      </View>
      {canGoUp(currentPath) && currentPath !== resolvedRootPath ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('back')}
          onPress={() => void loadDirectory(getParentDirectoryPath(currentPath))}
          style={({ pressed }) => [
            styles.parentRow,
            {
              borderBottomColor: colors.border,
              backgroundColor: pressed ? colors.surfaceHover : colors.bg,
            },
          ]}
        >
          <Ionicons
            name="chevron-back"
            size={desktopControlMetrics.iconGlyphSize}
            color={colors.textSecondary}
          />
          <Text
            style={[styles.rowName, { color: colors.textSecondary }]}
            numberOfLines={1}
            ellipsizeMode="middle"
          >
            {getParentDirectoryPath(currentPath)}
          </Text>
        </Pressable>
      ) : null}
      {error ? (
        <View accessibilityRole="alert" style={styles.center}>
          <Text style={[styles.error, { color: colors.error }]}>{error}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('retry')}
            onPress={() => void loadDirectory(attemptedPath)}
            style={[styles.retry, { borderColor: colors.border }]}
          >
            <Text style={{ color: colors.text }}>{t('retry')}</Text>
          </Pressable>
        </View>
      ) : loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={!entries.length && styles.emptyList}>
          {entries.length ? (
            entries.map((entry) => (
              <DesktopFileRow
                key={entry.path}
                entry={entry}
                colors={colors}
                onPress={() => openEntry(entry)}
              />
            ))
          ) : (
            <Text style={[styles.empty, { color: colors.textTertiary }]}>{t('no_files')}</Text>
          )}
          {nextCursor !== null ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('more')}
              disabled={loading}
              onPress={() => void loadDirectory(currentPath, nextCursor)}
              style={[styles.retry, { borderColor: colors.border }]}
            >
              <Text style={{ color: colors.text }}>{t('more')}</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      )}
      <Text
        style={[styles.scopeHint, { color: colors.textTertiary, borderTopColor: colors.border }]}
      >
        {t('desktop_file_scope_hint')}
      </Text>
    </View>
  )

  return (
    <View style={styles.row} testID="desktop-chat-file-workspace">
      {!narrow ? (
        <View
          {...({ onPointerDown: startResize } as object)}
          testID="desktop-chat-file-resize-handle"
          style={styles.resizeHandle}
        >
          <View style={[styles.resizeGrip, { backgroundColor: colors.border }]} />
        </View>
      ) : null}
      <View
        style={[
          styles.panel,
          { borderLeftColor: colors.border },
          narrow
            ? styles.panelNarrow
            : { width: panelWidth, minWidth: panelWidth, maxWidth: panelWidth },
        ]}
      >
        {panel}
      </View>
    </View>
  )
}

function ToolbarIcon({
  icon,
  label,
  colors,
  disabled = false,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap
  label: string
  colors: Colors
  disabled?: boolean
  onPress(): void
}) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.toolbarButton,
        {
          borderColor: focused ? colors.brand : 'transparent',
          backgroundColor: hovered || pressed ? colors.surfaceHover : 'transparent',
          opacity: disabled ? 0.42 : pressed ? 0.72 : 1,
        },
        desktopNoDragStyle,
      ]}
    >
      <Ionicons name={icon} size={18} color={colors.textSecondary} />
    </Pressable>
  )
}

function DesktopFileRow({
  entry,
  colors,
  onPress,
}: {
  entry: FsEntry
  colors: Colors
  onPress(): void
}) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      testID={`desktop-file-entry-${sanitizeTestIdPart(entry.path)}`}
      accessibilityRole="button"
      accessibilityLabel={entry.path}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.fileRow,
        {
          borderColor: focused ? colors.brand : 'transparent',
          backgroundColor: hovered || pressed ? colors.surfaceHover : colors.bg,
        },
      ]}
    >
      <Ionicons
        name={entry.isDir ? 'folder-outline' : 'document-text-outline'}
        size={18}
        color={entry.isDir ? colors.brand : colors.textSecondary}
      />
      <Text
        style={[styles.rowName, { color: colors.text }]}
        numberOfLines={1}
        ellipsizeMode="middle"
      >
        {entry.name}
      </Text>
      {entry.modifiedAt ? (
        <Text style={[styles.metadata, { color: colors.textTertiary }]}>
          {new Date(entry.modifiedAt).toLocaleDateString()}
        </Text>
      ) : null}
      <Ionicons name="chevron-forward" size={15} color={colors.textTertiary} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: { flex: 1, minHeight: 0, flexDirection: 'row' },
  panel: { flexGrow: 0, flexShrink: 0, minHeight: 0, borderLeftWidth: StyleSheet.hairlineWidth },
  panelNarrow: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    width: '100%',
    minWidth: 0,
    borderLeftWidth: 0,
  },
  resizeHandle: {
    width: 14,
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'col-resize',
    touchAction: 'none',
    userSelect: 'none',
  } as any,
  resizeGrip: { width: 1, height: '100%', opacity: 0.8 },
  browser: { flex: 1, minHeight: 0 },
  browserHeader: {
    minHeight: desktopControlMetrics.headerHeight,
    paddingLeft: 16,
    paddingRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  browserTitle: { flex: 1, minWidth: 0, paddingRight: 8 },
  title: desktopTypography.windowTitle,
  path: desktopTypography.metadata,
  toolbarButton: {
    width: desktopControlMetrics.iconButtonSize,
    height: desktopControlMetrics.iconButtonSize,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  parentRow: {
    minHeight: 44,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  list: { flex: 1, minHeight: 0 },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  fileRow: {
    minHeight: 48,
    marginHorizontal: 8,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowName: { flex: 1, minWidth: 0, ...desktopTypography.sidebarItem },
  metadata: { flexShrink: 0, ...desktopTypography.metadata },
  center: { flex: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center', gap: 12 },
  error: { maxWidth: 300, ...desktopTypography.body, textAlign: 'center' },
  retry: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { padding: 24, ...desktopTypography.body, textAlign: 'center' },
  scopeHint: {
    minHeight: 42,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    ...desktopTypography.metadata,
  },
})
