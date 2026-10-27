import { useEffect, useRef, useState } from 'react'
import { Platform, Pressable, Text, View } from 'react-native'
import Feather from '@expo/vector-icons/Feather'
import type { FsEntry } from '@shennian/wire'
import { useTranslation } from 'react-i18next'
import type { Colors } from '../../hooks/useTheme'
import { formatSize, sanitizeTestIdPart } from './fileOperations'
import { styles } from './FileDrawer.styles'
import { shouldShowFileRowActions } from './fileRowActionVisibility'

export type PreviewCacheEntry = {
  content: string | null
  data: string | null
  error: string
}

export type TreeNode = {
  entry: FsEntry
  depth: number
}
export type FileListRow = FsEntry | TreeNode

export function isTreeNode(row: FileListRow): row is TreeNode {
  return 'entry' in row
}

export function FileRow({
  item,
  downloadTestId,
  colors,
  onPress,
  onDownload,
  onRef,
  onRename,
  refFeedbackActive,
  isDownloading,
  downloadPct,
}: {
  item: FsEntry
  downloadTestId?: string
  colors: Colors
  onPress: () => void
  onDownload?: () => void
  onRef?: () => void
  onRename?: () => void
  refFeedbackActive: boolean
  isDownloading: boolean
  downloadPct: number
}) {
  const { t } = useTranslation()
  const rowRef = useRef<View>(null)
  const [hovered, setHovered] = useState(false)
  const [focusWithin, setFocusWithin] = useState(false)
  const showActions = shouldShowFileRowActions({
    hovered,
    focusWithin,
    web: Platform.OS === 'web',
  })

  useEffect(() => {
    if (Platform.OS !== 'web' || !rowRef.current) return
    const el = rowRef.current as unknown as HTMLElement
    const onEnter = () => setHovered(true)
    const onLeave = () => setHovered(false)
    const onFocusIn = () => setFocusWithin(true)
    const onFocusOut = (event: FocusEvent) => {
      if (!event.relatedTarget || !el.contains(event.relatedTarget as Node)) setFocusWithin(false)
    }
    el.addEventListener('mouseenter', onEnter)
    el.addEventListener('mouseleave', onLeave)
    el.addEventListener('focusin', onFocusIn)
    el.addEventListener('focusout', onFocusOut)
    return () => {
      el.removeEventListener('mouseenter', onEnter)
      el.removeEventListener('mouseleave', onLeave)
      el.removeEventListener('focusin', onFocusIn)
      el.removeEventListener('focusout', onFocusOut)
    }
  }, [])

  return (
    <Pressable
      ref={rowRef}
      style={[styles.entry, { borderBottomColor: colors.border }]}
      onPress={onPress}
      testID={`file-entry-${sanitizeTestIdPart(item.name)}`}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          backgroundColor: item.isDir ? colors.brandLight : colors.surfaceHover,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Feather
          name={item.isDir ? 'folder' : 'file-text'}
          size={18}
          color={item.isDir ? colors.navigationSelected : colors.textSecondary}
          style={styles.entryIconFeather}
        />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text
          style={[
            styles.entryName,
            { color: colors.text },
            item.isDir && styles.entryNameDir,
          ]}
          numberOfLines={1}
        >
          {item.name}
        </Text>
        {!item.isDir && item.size != null ? (
          <Text style={{ fontSize: 12, color: colors.textTertiary }}>{formatSize(item.size)}</Text>
        ) : null}
      </View>
      {item.isDir ? <Feather name="chevron-right" size={16} color={colors.textTertiary} /> : null}
      <View
        style={[styles.rowActions, { opacity: showActions || isDownloading ? 1 : 0 }]}
        pointerEvents={showActions || isDownloading ? 'auto' : 'none'}
      >
        {onDownload &&
          (isDownloading ? (
            <Text style={[styles.pctText, { color: colors.textTertiary }]}>{downloadPct}%</Text>
          ) : (
            <Pressable
              style={styles.actionIcon}
              onPress={(e) => {
                e.stopPropagation?.()
                onDownload()
              }}
              hitSlop={4}
              testID={downloadTestId}
              accessibilityRole="button"
              accessibilityLabel={t('file_action_download', { name: item.name })}
            >
              <Feather name="download" size={13} color={colors.textTertiary} />
            </Pressable>
          ))}
        {onRef ? (
          <Pressable
            style={[
              styles.actionIcon,
              refFeedbackActive && { backgroundColor: `${colors.brand}14` },
            ]}
            onPress={(e) => {
              e.stopPropagation?.()
              onRef()
            }}
            disabled={refFeedbackActive}
            hitSlop={4}
            accessibilityLabel={t('file_action_reference', { name: item.name })}
            accessibilityRole="button"
            accessibilityState={{ disabled: refFeedbackActive, selected: refFeedbackActive }}
          >
            {refFeedbackActive ? (
              <Feather name="check" size={14} color={colors.brand} />
            ) : (
              <Text style={[styles.atText, { color: colors.brand }]}>@</Text>
            )}
          </Pressable>
        ) : null}
        {onRename ? (
          <Pressable
            style={styles.actionIcon}
            onPress={(e) => {
              e.stopPropagation?.()
              onRename()
            }}
            hitSlop={4}
            accessibilityLabel={t('file_action_rename', { name: item.name })}
            accessibilityRole="button"
          >
            <Feather name="edit-2" size={13} color={colors.textTertiary} />
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  )
}
