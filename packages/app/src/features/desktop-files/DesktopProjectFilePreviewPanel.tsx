// @arch docs/features/desktop-project-files-opaque-protocol.md
// @test src/__tests__/project-files-sidebar.test.ts

import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { FilePreview } from '../../components/chat/FilePreview'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useTheme } from '../../hooks/useTheme'
import type { DesktopSavedFile } from '../desktop-control/desktopFileOperations'
import { useDesktopProjectFilesController } from './DesktopProjectFilesController'
import { desktopControlMetrics, desktopTypography } from '../desktop-shell/desktopDesignTokens'

const desktopNoDragStyle: ViewStyle & { WebkitAppRegion?: 'no-drag' } = {
  WebkitAppRegion: 'no-drag',
}

export function DesktopProjectFilePreviewPanel() {
  const { t } = useTranslation()
  const { colors, isDark } = useTheme()
  const workspace = useDesktopProjectFilesController()
  const preview = workspace.state.preview
  const closeRef = useRef<View>(null)
  const [downloading, setDownloading] = useState(false)
  const [savedFile, setSavedFile] = useState<DesktopSavedFile | null>(null)
  const [operationError, setOperationError] = useState('')
  const downloadRequestRef = useRef(0)
  useEscapeKey(Boolean(preview), workspace.closePreview)

  useEffect(() => {
    if (!preview || typeof document === 'undefined') return
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-testid="project-file-preview-close"]')?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [preview?.requestId])

  useEffect(() => {
    downloadRequestRef.current += 1
    setDownloading(false)
    setSavedFile(null)
    setOperationError('')
  }, [preview?.requestId])

  const download = async () => {
    if (downloading || !preview) return
    const requestId = ++downloadRequestRef.current
    const filename = preview.filename
    setDownloading(true)
    setSavedFile(null)
    setOperationError('')
    try {
      const saved = await workspace.downloadPreview()
      if (downloadRequestRef.current === requestId) setSavedFile(saved)
    } catch (error) {
      if (downloadRequestRef.current === requestId) {
        setOperationError(t('download_failed_with_reason', {
          name: filename,
          reason: error instanceof Error ? error.message : t('error_unknown'),
        }))
      }
    } finally {
      if (downloadRequestRef.current === requestId) setDownloading(false)
    }
  }

  if (!preview) return null
  return (
    <View
      testID="project-file-preview-panel"
      style={[styles.container, { backgroundColor: colors.bg, borderLeftColor: colors.border }]}
      accessibilityLabel={t('project_file_preview')}
    >
      <View
        {...{ dataSet: { desktopDrag: 'true' } }}
        style={[styles.header, { borderBottomColor: colors.border }]}
      >
        <View style={styles.titleWrap}>
          <Text
            style={[styles.title, { color: colors.text }]}
            numberOfLines={1}
            ellipsizeMode="middle"
            accessibilityLabel={preview.filename}
          >
            {preview.filename}
          </Text>
          <Text style={[styles.subtitle, { color: colors.textTertiary }]} numberOfLines={1}>
            {t('project_files')}
          </Text>
        </View>
        <Pressable
          ref={closeRef}
          testID="project-file-preview-close"
          style={({ pressed }) => [
            styles.closeButton,
            { backgroundColor: pressed ? colors.surfaceHover : 'transparent' },
            desktopNoDragStyle,
          ]}
          onPress={workspace.closePreview}
          accessibilityRole="button"
          accessibilityLabel={t('close')}
        >
          <Ionicons name="close" size={22} color={colors.text} />
        </Pressable>
      </View>
      <View style={styles.body}>
        {preview.loading ? (
          <View style={styles.status} accessibilityLiveRegion="polite">
            <ActivityIndicator color={colors.brand} />
            <Text style={[styles.statusText, { color: colors.textTertiary }]}>
              {t('project_file_preview_loading')}
            </Text>
          </View>
        ) : preview.error ? (
          <View style={styles.status} accessibilityLiveRegion="assertive">
            <Text style={[styles.statusText, { color: colors.error }]}>
              {t(
                preview.error.code === 'permission_denied'
                  ? 'project_files_permission'
                  : preview.error.code === 'machine_offline'
                    ? 'project_files_offline'
                    : 'project_file_preview_error',
              )}
            </Text>
            {preview.error.retryable ? (
              <Pressable
                style={({ pressed }) => [
                  styles.retryButton,
                  { backgroundColor: pressed ? colors.surfaceHover : colors.brandLight },
                ]}
                onPress={workspace.retryPreview}
                accessibilityRole="button"
                accessibilityLabel={t('retry')}
              >
                <Text style={[styles.retryText, { color: colors.brand }]}>{t('retry')}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <FilePreview
            filename={preview.filename}
            content={preview.content}
            data={preview.data}
            loading={false}
            error=""
            colors={colors}
            isDark={isDark}
          />
        )}
      </View>
      {!preview.loading && !preview.error ? (
        <View style={[styles.actions, { borderTopColor: colors.border }]}>
          {operationError ? (
            <Text accessibilityRole="alert" style={[styles.operationError, { color: colors.error }]} numberOfLines={2}>
              {operationError}
            </Text>
          ) : <View style={styles.actionSpacer} />}
          {savedFile ? (
            <PreviewAction label={t('desktop_show_in_folder')} icon="folder-open-outline" onPress={() => {
              void savedFile.showInFolder().catch(() => {
                setOperationError(t('error_unknown'))
              })
            }} />
          ) : null}
          <PreviewAction label={t('download')} icon="download-outline" disabled={downloading}
            onPress={() => void download()} />
        </View>
      ) : null}
    </View>
  )
}

function PreviewAction({ label, icon, disabled = false, onPress }: {
  label: string
  icon: keyof typeof Ionicons.glyphMap
  disabled?: boolean
  onPress(): void
}) {
  const { colors } = useTheme()
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.actionButton, {
      borderColor: colors.border,
      backgroundColor: pressed ? colors.surfaceHover : colors.bg,
      opacity: disabled ? 0.55 : 1,
    }, desktopNoDragStyle]}>
    <Ionicons name={icon} size={17} color={colors.textSecondary} />
    <Text style={[styles.actionText, { color: colors.text }]}>{label}</Text>
  </Pressable>
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  header: {
    height: desktopControlMetrics.headerHeight,
    paddingLeft: 16,
    paddingRight: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
  },
  titleWrap: { flex: 1, minWidth: 0 },
  title: desktopTypography.windowTitle,
  subtitle: desktopTypography.metadata,
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, minHeight: 0 },
  status: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  statusText: { maxWidth: 360, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  retryButton: { minHeight: 44, paddingHorizontal: 16, borderRadius: 12, justifyContent: 'center' },
  retryText: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  actions: { minHeight: 60, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  actionSpacer: { flex: 1 },
  operationError: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 17 },
  actionButton: { minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderRadius: 9,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  actionText: desktopTypography.control,
})
