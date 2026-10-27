// @arch docs/architecture/app/chat-attachments-preview.md
// @test src/__tests__/attachment-preview.test.ts

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import Feather from '@expo/vector-icons/Feather'
import { HeaderBackButton } from '../../../components/AppPageHeader'
import { useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useChatStore, useSessionsStore, type ChatAttachment } from '@shennian/shared'
import type { ChatAttachmentKind, FsEntry } from '@shennian/wire'
import { DownloadFeedback } from '../../../components/DownloadFeedback'
import { FilePreview } from '../../../components/chat/FilePreview'
import { formatSize } from '../../../components/chat/fileOperations'
import { useGoBack } from '../../../hooks/useGoBack'
import { useEscapeKey } from '../../../hooks/useEscapeKey'
import { useTheme } from '../../../hooks/useTheme'
import { useToast } from '../../../hooks/useToast'
import {
  attachmentDownloadKey,
  getAttachmentDownloadProgress,
  startAttachmentDownload,
  subscribeAttachmentDownloads,
} from '../utils/attachmentDownloadTasks'
import {
  showLastDesktopSavedFileInFolder,
} from '../../desktop-control/desktopFileOperations'
import {
  buildAttachmentMeta,
  getPathBasename,
  resolvePreviewAttachmentCandidate,
} from '../utils/attachments'
import {
  type DirectoryPreviewResult,
  type FilePreviewResult,
  getCachedFilePreview,
  ensureImageAttachmentPreview,
  loadAttachmentPreview,
} from '../utils/attachmentPreview'
import { resolveMarkdownImagePath } from '../utils/markdownImagePath'
import { useTranslation } from 'react-i18next'

import { parseImageGallery } from '../utils/imageGallery'
import { ChatImageGalleryScreen } from './ChatImageGalleryScreen'

type PreviewState = FilePreviewResult

function parsePositiveLine(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function parseAttachmentKind(value: string | undefined): ChatAttachmentKind | undefined {
  return value === 'image' || value === 'file' || value === 'folder' ? value : undefined
}

export default function ChatAttachmentPreviewScreen() {
  const { sessionId, path, imagePaths } = useLocalSearchParams<{ sessionId?: string; path?: string; imagePaths?: string }>()
  const images = useMemo(() => parseImageGallery(imagePaths, path), [imagePaths, path])
  if (images.length > 1 && path) {
    return <ChatImageGalleryScreen key={`${sessionId}:${path}:${imagePaths}`} sessionId={sessionId} images={images} selectedPath={path} />
  }
  return <SingleAttachmentPreviewScreen />
}

function SingleAttachmentPreviewScreen() {
  const { sessionId, path, name, mimeType, kind, line, endLine } = useLocalSearchParams<{
    sessionId?: string
    path?: string
    name?: string
    mimeType?: string
    kind?: string
    line?: string
    endLine?: string
  }>()
  const goBack = useGoBack()
  const { t } = useTranslation()
  const { colors, isDark } = useTheme()
  const { toast, showToast, hideToast } = useToast()
  const sessions = useSessionsStore((store) => store.sessions)
  const session = sessions.find((item) => item.id === sessionId)
  const machineId = session?.machineId ?? null
  const activeChatSessionId = useChatStore((store) => store.sessionId)
  const messages = useChatStore((store) => store.messages)

  const attachment = useMemo(() => {
    return resolvePreviewAttachmentCandidate({
      sessionMatches: activeChatSessionId === sessionId,
      messages,
      path,
      name,
      mimeType,
      kind: parseAttachmentKind(kind),
    })
  }, [activeChatSessionId, kind, messages, mimeType, name, path, sessionId])

  const [previewTarget, setPreviewTarget] = useState<ChatAttachment | null>(null)
  const currentAttachment = previewTarget ?? attachment

  const cachedPreview = useMemo(
    () => (currentAttachment ? getCachedFilePreview(machineId, currentAttachment) : undefined),
    [currentAttachment, machineId],
  )
  const [preview, setPreview] = useState<PreviewState>(
    cachedPreview ?? {
      content: null,
      data: currentAttachment?.previewData ?? null,
      error: '',
    },
  )
  const [loading, setLoading] = useState(currentAttachment ? !cachedPreview : false)
  const displayAttachment = currentAttachment && preview.directory
    ? ({
        path: preview.directory.path,
        name: getPathBasename(preview.directory.path),
        mimeType: 'inode/directory',
        kind: 'folder',
      } satisfies ChatAttachment)
    : currentAttachment

  const downloadKey = displayAttachment
    ? attachmentDownloadKey({ machineId, attachment: displayAttachment })
    : ''
  const downloadPct = useSyncExternalStore(
    subscribeAttachmentDownloads,
    () => getAttachmentDownloadProgress(downloadKey),
    () => null,
  )
  const activeDownloadKey = useRef<string | null>(downloadKey)
  useEffect(() => {
    activeDownloadKey.current = downloadKey
    return () => { activeDownloadKey.current = null }
  }, [downloadKey])
  const [canShowDownloadedFile, setCanShowDownloadedFile] = useState(false)
  const targetLine = parsePositiveLine(line)
  const targetEndLine = parsePositiveLine(endLine)
  useEscapeKey(true, goBack)

  useEffect(() => {
    setCanShowDownloadedFile(false)
  }, [currentAttachment?.path])

  useEffect(() => {
    setPreviewTarget(attachment)
  }, [attachment])

  useEffect(() => {
    if (!path) {
      goBack()
    }
  }, [goBack, path])

  useEffect(() => {
    if (!currentAttachment) return

    const cached = getCachedFilePreview(machineId, currentAttachment)
    if (cached) {
      setPreview(cached)
      setLoading(false)
    } else {
      setPreview({
        content: null,
        data: currentAttachment.previewData ?? null,
        error: '',
      })
      setLoading(true)
    }

    let cancelled = false

    void loadAttachmentPreview(machineId, currentAttachment, {
      refresh: true,
      rootPath: currentAttachment.path,
    })
      .then((result) => {
        if (!cancelled) {
          setPreview(result)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPreview({ content: null, data: null, error: 'Unable to load file preview' })
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [currentAttachment, machineId])

  if (!currentAttachment || !displayAttachment) return null

  const downloading = downloadPct != null
  const handleDownload = () => {
    if (downloading) return
    void startAttachmentDownload({
      machineId,
      attachment: displayAttachment,
      rootPath: displayAttachment.path,
      previewContent: displayAttachment.kind === 'folder' ? null : preview.content,
      previewData: displayAttachment.kind === 'folder' ? null : preview.data,
    }, t).then((mode) => {
      if (activeDownloadKey.current === downloadKey) setCanShowDownloadedFile(mode === 'desktop')
    })
  }

  const handleOpenDirectoryEntry = useCallback((entry: FsEntry) => {
    setPreviewTarget(
      buildAttachmentMeta({
        path: entry.path,
        name: entry.name,
        mimeType: entry.isDir ? 'inode/directory' : undefined,
        kind: entry.isDir ? 'folder' : undefined,
      }),
    )
  }, [])

  const loadMarkdownImage = useCallback(async (href: string): Promise<string | null> => {
    if (!machineId || !currentAttachment) return null
    const resolved = resolveMarkdownImagePath(href, currentAttachment.path)
    if (!resolved) return null
    const image = buildAttachmentMeta({ path: resolved })
    if (image.kind !== 'image') return null
    return ensureImageAttachmentPreview(machineId, { path: image.path, previewData: undefined, mimeType: image.mimeType })
  }, [currentAttachment, machineId])

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]} edges={['top']}>
      <View
        style={[styles.header, { borderBottomColor: colors.border, backgroundColor: colors.bg }]}
      >
        <HeaderBackButton onPress={goBack} />
        <View style={styles.headerTitleWrap}>
          <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
            {displayAttachment.name}
          </Text>
          <Text style={[styles.headerPath, { color: colors.textTertiary }]} numberOfLines={1}>
            {targetLine
              ? `${displayAttachment.path} · ${targetEndLine && targetEndLine > targetLine ? `lines ${targetLine}-${targetEndLine}` : `line ${targetLine}`}`
              : displayAttachment.path}
          </Text>
        </View>
        {downloading ? (
          <Text style={[styles.progressText, { color: colors.brand }]}>{downloadPct}%</Text>
        ) : canShowDownloadedFile ? (
          <Pressable
            style={[styles.downloadBtn, { backgroundColor: colors.surface }]}
            onPress={() => {
              void showLastDesktopSavedFileInFolder().catch(() => {
                showToast(t('file_save_failed'), 'error')
              })
            }}
            hitSlop={8}
            accessibilityLabel={t('desktop_show_in_folder')}
            testID="attachment-preview-show-in-folder"
          >
            <Feather name="folder" size={18} color={colors.text} />
          </Pressable>
        ) : (
          <Pressable
            style={[styles.downloadBtn, { backgroundColor: colors.surface }]}
            onPress={handleDownload}
            hitSlop={8}
            accessibilityLabel={t('download')}
            testID="attachment-preview-download"
          >
            <Feather name="download" size={18} color={colors.text} />
          </Pressable>
        )}
      </View>

      <View style={styles.previewArea}>
        {preview.directory ? (
          <DirectoryPreview
            directory={preview.directory}
            loading={loading}
            colors={colors}
            emptyLabel={t('empty_dir')}
            onOpenEntry={handleOpenDirectoryEntry}
          />
        ) : (
          <FilePreview
            onImageBackdropPress={goBack}
            filename={displayAttachment.name}
            content={preview.content}
            data={preview.data}
            loading={loading}
            error={preview.error}
            colors={colors}
            isDark={isDark}
            loadLocalImage={loadMarkdownImage}
            targetLine={targetLine}
            targetEndLine={targetEndLine}
          />
        )}
      </View>
      <DownloadFeedback notice={toast} onHide={hideToast} />
    </SafeAreaView>
  )
}

function DirectoryPreview({
  directory,
  loading,
  colors,
  emptyLabel,
  onOpenEntry,
}: {
  directory: DirectoryPreviewResult
  loading: boolean
  colors: ReturnType<typeof useTheme>['colors']
  emptyLabel: string
  onOpenEntry: (entry: FsEntry) => void
}) {
  return (
    <View style={[styles.directoryContainer, { backgroundColor: colors.bg }]}>
      {loading ? (
        <View style={[styles.directoryLoading, { backgroundColor: `${colors.bg}cc` }]}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : null}
      <FlatList
        data={directory.entries}
        keyExtractor={(item) => item.path}
        style={styles.directoryList}
        contentContainerStyle={[
          styles.directoryListContent,
          directory.entries.length === 0 && styles.directoryListEmpty,
        ]}
        renderItem={({ item }) => (
          <Pressable
            style={[styles.directoryRow, { borderBottomColor: colors.border }]}
            onPress={() => onOpenEntry(item)}
            accessibilityRole="button"
            accessibilityLabel={item.name}
          >
            <View
              style={[
                styles.directoryIcon,
                { backgroundColor: item.isDir ? `${colors.brand}14` : colors.surface },
              ]}
            >
              <Feather
                name={item.isDir ? 'folder' : 'file-text'}
                size={16}
                color={item.isDir ? colors.brand : colors.textTertiary}
              />
            </View>
            <View style={styles.directoryMeta}>
              <Text style={[styles.directoryName, { color: colors.text }]} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={[styles.directorySubtle, { color: colors.textTertiary }]}>
                {item.isDir ? item.path : item.size != null ? formatSize(item.size) : item.path}
              </Text>
            </View>
            <Feather
              name={item.isDir ? 'chevron-right' : 'eye'}
              size={14}
              color={colors.textTertiary}
            />
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.directoryEmpty}>
            <Text style={[styles.directorySubtle, { color: colors.textTertiary }]}>
              {emptyLabel}
            </Text>
          </View>
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 0,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  headerPath: {
    marginTop: 2,
    fontSize: 12,
  },
  downloadBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressText: {
    minWidth: 36,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
  },
  previewArea: {
    flex: 1,
    minHeight: 0,
  },
  directoryContainer: {
    flex: 1,
    minHeight: 0,
  },
  directoryLoading: {
    position: 'absolute',
    top: 0,
    right: 0,
    left: 0,
    zIndex: 1,
    paddingVertical: 8,
    alignItems: 'center',
  },
  directoryList: {
    flex: 1,
    minHeight: 0,
  },
  directoryListContent: {
    paddingVertical: 6,
  },
  directoryListEmpty: {
    flexGrow: 1,
  },
  directoryRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  directoryIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  directoryMeta: {
    flex: 1,
    minWidth: 0,
  },
  directoryName: {
    fontSize: 14,
    fontWeight: '600',
  },
  directorySubtle: {
    marginTop: 3,
    fontSize: 11,
  },
  directoryEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
})
