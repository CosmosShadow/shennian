// @arch docs/design/desktop/unified-desktop-control.md
// @test ../../__tests__/desktop-chat-file-workspace.test.ts

import Ionicons from '@expo/vector-icons/Ionicons'
import { useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import type { FsEntry } from '@shennian/wire'
import { FilePreview } from '../../components/chat/FilePreview'
import type {
  FilePreviewSelection,
  FileSelectionAiActionId,
} from '../../components/chat/fileSelectionAi'
import type { Colors } from '../../hooks/useTheme'
import { desktopControlMetrics, desktopTypography } from '../desktop-shell/desktopDesignTokens'

export type DesktopChatFilePreviewState = {
  file: FsEntry
  content: string | null
  data: string | null
  loading: boolean
  error: string
  line?: number
  endLine?: number
}

type Props = {
  colors: Colors
  isDark: boolean
  preview: DesktopChatFilePreviewState
  downloading: boolean
  canReveal: boolean
  notice: { kind: 'error' | 'success'; message: string } | null
  onBack(): void
  onClose(): void
  onDownload(): void
  onReveal(): void
  onReference?: () => void
  onRetry(): void
  onSelectionAiAction?: (actionId: FileSelectionAiActionId, selection: FilePreviewSelection) => void
  onSelectionQuoteAction?: (selection: FilePreviewSelection) => void
}

const desktopNoDragStyle: ViewStyle & { WebkitAppRegion?: 'no-drag' } = {
  WebkitAppRegion: 'no-drag',
}

export function DesktopChatFilePreview({
  colors,
  isDark,
  preview,
  downloading,
  canReveal,
  notice,
  onBack,
  onClose,
  onDownload,
  onReveal,
  onReference,
  onRetry,
  onSelectionAiAction,
  onSelectionQuoteAction,
}: Props) {
  const { t } = useTranslation()
  return (
    <View testID="desktop-file-preview" style={[styles.container, { backgroundColor: colors.bg }]}>
      <View {...{ dataSet: { desktopDrag: 'true' } }} style={[styles.header, { borderBottomColor: colors.border }]}>
        <DesktopFileToolbarButton
          icon="chevron-back"
          label={t('back')}
          colors={colors}
          onPress={onBack}
        />
        <View style={styles.headerTitle}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {preview.file.name}
          </Text>
          <Text
            accessibilityLabel={preview.file.path}
            style={[styles.path, { color: colors.textTertiary }]}
            numberOfLines={1}
            ellipsizeMode="middle"
          >
            {preview.file.path}
          </Text>
        </View>
        <DesktopFileToolbarButton
          icon="close"
          label={t('close')}
          colors={colors}
          onPress={onClose}
        />
      </View>

      <View style={[styles.actions, { borderBottomColor: colors.border }]}>
        <DesktopFileToolbarButton
          icon="download-outline"
          label={t('desktop_file_download')}
          colors={colors}
          disabled={downloading}
          loading={downloading}
          onPress={onDownload}
          testID="desktop-file-preview-download"
        />
        <DesktopFileToolbarButton
          icon="folder-open-outline"
          label={t('desktop_show_in_folder')}
          colors={colors}
          disabled={!canReveal || downloading}
          onPress={onReveal}
          testID="desktop-file-preview-reveal"
        />
        {onReference ? (
          <DesktopFileToolbarButton
            icon="at"
            label={t('insert_ref')}
            colors={colors}
            disabled={downloading}
            onPress={onReference}
            testID="desktop-file-preview-reference"
          />
        ) : null}
      </View>

      {notice ? (
        <View
          accessibilityRole="alert"
          style={[
            styles.notice,
            {
              backgroundColor: `${notice.kind === 'error' ? colors.error : colors.success}12`,
              borderBottomColor: `${notice.kind === 'error' ? colors.error : colors.success}30`,
            },
          ]}
        >
          <Text style={[desktopTypography.body, { color: notice.kind === 'error' ? colors.errorText : colors.success }]}>
            {notice.message}
          </Text>
        </View>
      ) : null}

      <View style={styles.previewArea}>
        <FilePreview
          filename={preview.file.name}
          content={preview.content}
          data={preview.data}
          loading={preview.loading}
          error={preview.error}
          colors={colors}
          isDark={isDark}
          onSelectionAiAction={onSelectionAiAction}
          onSelectionQuoteAction={onSelectionQuoteAction}
          targetLine={preview.line}
          targetEndLine={preview.endLine}
        />
        {preview.error ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('retry')}
            onPress={onRetry}
            style={[styles.retry, { borderColor: colors.border }]}
          >
            <Text style={[desktopTypography.control, { color: colors.text }]}>{t('retry')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

function DesktopFileToolbarButton({
  icon,
  label,
  colors,
  disabled = false,
  loading = false,
  onPress,
  testID,
}: {
  icon: keyof typeof Ionicons.glyphMap
  label: string
  colors: Colors
  disabled?: boolean
  loading?: boolean
  onPress(): void
  testID?: string
}) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      testID={testID}
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
        styles.action,
        {
          borderColor: focused ? colors.brand : 'transparent',
          backgroundColor: hovered || pressed ? colors.surfaceHover : 'transparent',
          opacity: disabled ? 0.42 : pressed ? 0.72 : 1,
        },
        desktopNoDragStyle,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={colors.brand} />
      ) : (
        <Ionicons name={icon} size={17} color={colors.textSecondary} />
      )}
      <Text style={[styles.actionLabel, { color: colors.textSecondary }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 0 },
  header: {
    minHeight: desktopControlMetrics.headerHeight,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { flex: 1, minWidth: 0, paddingHorizontal: 6 },
  title: desktopTypography.windowTitle,
  path: desktopTypography.metadata,
  actions: {
    minHeight: desktopControlMetrics.headerHeight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  action: {
    minHeight: desktopControlMetrics.standardControlHeight,
    minWidth: desktopControlMetrics.standardControlHeight,
    paddingHorizontal: 9,
    borderWidth: 1,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  actionLabel: desktopTypography.control,
  notice: {
    minHeight: 38,
    paddingHorizontal: 14,
    paddingVertical: 8,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  previewArea: { flex: 1, minHeight: 0, position: 'relative' },
  retry: {
    position: 'absolute',
    top: '55%',
    alignSelf: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
