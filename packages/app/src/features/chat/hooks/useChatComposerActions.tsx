import { useDirectoryUploadMenu } from '../../steward/useDirectoryUploadMenu'
import { ActionIconButton } from '../../../components/ActionIconButton'
// @arch docs/architecture/app/chat-composer-keyboard.md
// @test src/__tests__/chat-screen-utils.test.ts

import Feather from '@expo/vector-icons/Feather'
import { HeadEllipsisText } from '../../../components/HeadEllipsisText'
import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react'
import { Platform, Pressable, Text, View } from 'react-native'
import { useEscapeKey } from '../../../hooks/useEscapeKey'
import { useWebModalFocus } from '../../../hooks/useWebModalFocus'
import { restoreWebModalFocus } from '../../../utils/webModalFocus'
import { getComposerActionIds, type ComposerActionId } from '../../../utils/composerActions'
import { styles } from '../screens/ChatScreen.styles'
import { ComposerActionMenu } from '../components/ComposerActionMenu'
import {
  DesktopComposerIconButton,
  DesktopComposerTextButton,
} from '../../desktop-chat/DesktopComposerIconButton'

type ThemeColors = {
  brand: string
  border: string
  surface: string
  surfaceHover: string
  text: string
  textSecondary: string
  textTertiary: string
}

type ReasoningEffort = { id: string; name?: string }

type UseChatComposerActionsParams = {
  stewardMode?: boolean
  onInspiration?: () => void
  colors: ThemeColors
  t: (key: string, options?: any) => string
  canShowModelControl: boolean
  canOpenModelSelector: boolean
  currentModelLabel: string
  canOpenConversationSettings?: boolean
  openConversationSettings?: () => void
  canShowReasoningEffort: boolean
  effectiveReasoningEffort?: string
  currentReasoningLabel: string
  reasoningEfforts: ReasoningEffort[]
  setPreferredReasoningEffort: (value: string | null) => void
  showModelSelector: boolean
  setShowComposerMenu: (value: boolean | ((prev: boolean) => boolean)) => void
  showComposerMenu: boolean
  fileDrawerOpen: boolean
  isDesktop: boolean
  isUploading: boolean
  modelSelectorBusy: boolean
  machineOffline: boolean
  showToast: (message: string, type: 'success' | 'error' | 'info') => void
  openFileDrawer: () => void
  openModelSelector: () => void
  openAgentCapabilities: () => void
  canShowAgentCapabilities: boolean
  handleAttachWeb: () => void | Promise<void>
  handleAttachFolderWeb: () => void | Promise<void>
  handleAttachNativeFile?: () => void | Promise<void>
  handleAttachNativeMedia?: () => void | Promise<void>
  handleTakeNativePhoto?: () => void | Promise<void>
}

export function useChatComposerActions(params: UseChatComposerActionsParams) {
  const {
    canOpenModelSelector,
    canShowModelControl,
    canShowReasoningEffort,
    canOpenConversationSettings,
    openConversationSettings,
    colors,
    currentModelLabel,
    currentReasoningLabel,
    effectiveReasoningEffort,
    fileDrawerOpen,
    handleAttachFolderWeb,
    handleAttachNativeFile,
    handleAttachNativeMedia,
    handleTakeNativePhoto,
    handleAttachWeb,
    isDesktop,
    isUploading,
    machineOffline,
    modelSelectorBusy,
    openFileDrawer,
    openModelSelector,
    openAgentCapabilities,
    canShowAgentCapabilities,
    reasoningEfforts,
    setPreferredReasoningEffort,
    setShowComposerMenu,
    showComposerMenu,
    showModelSelector,
    showToast,
    t,
  } = params
  const directoryMenu = useDirectoryUploadMenu(t, () => setShowComposerMenu(false))
  const composerMenuButtonRef = useRef<View>(null)
  const composerMenuRef = useRef<View>(null)
  const firstComposerMenuActionRef = useRef<View>(null)
  const previousFileDrawerOpen = useRef(fileDrawerOpen)
  useEffect(() => {
    const wasOpen = previousFileDrawerOpen.current
    previousFileDrawerOpen.current = fileDrawerOpen
    if (Platform.OS !== 'web' || !isDesktop || !wasOpen || fileDrawerOpen) return
    // The narrow workspace reveals the composer in this render. Restore only
    // after that layout commit, without changing the saved reading position.
    const frame = requestAnimationFrame(() => restoreWebModalFocus(composerMenuButtonRef.current))
    return () => cancelAnimationFrame(frame)
  }, [fileDrawerOpen, isDesktop])
  const desktopComposerMenuVisible =
    Platform.OS === 'web' && isDesktop && showComposerMenu

  useEscapeKey(desktopComposerMenuVisible, () => setShowComposerMenu(false))
  useWebModalFocus({
    visible: desktopComposerMenuVisible,
    containerRef: composerMenuRef,
    initialFocusRef: firstComposerMenuActionRef,
    returnFocusRef: composerMenuButtonRef,
  })

  const openFileDrawerFromComposer = useCallback(() => {
    if (machineOffline) {
      showToast(t('machine_offline_error'), 'error')
      return
    }
    setShowComposerMenu(false)
    openFileDrawer()
  }, [machineOffline, openFileDrawer, setShowComposerMenu, showToast, t])

  const handlePickNativeFileFromComposer = useCallback(() => {
    if (!handleAttachNativeFile) throw new Error('Native file picker is unavailable')
    if (machineOffline) {
      showToast(t('machine_offline_error'), 'error')
      return
    }
    setShowComposerMenu(false)
    void handleAttachNativeFile()
  }, [handleAttachNativeFile, machineOffline, setShowComposerMenu, showToast, t])

  const handlePickNativeMediaFromComposer = useCallback(() => {
    if (!handleAttachNativeMedia) throw new Error('Native media picker is unavailable')
    if (machineOffline) {
      showToast(t('machine_offline_error'), 'error')
      return
    }
    setShowComposerMenu(false)
    void handleAttachNativeMedia()
  }, [handleAttachNativeMedia, machineOffline, setShowComposerMenu, showToast, t])

  const handleAttachWebFromComposer = useCallback(() => {
    if (machineOffline) {
      showToast(t('machine_offline_error'), 'error')
      return
    }
    setShowComposerMenu(false)
    void handleAttachWeb()
  }, [handleAttachWeb, machineOffline, setShowComposerMenu, showToast, t])

  const handleAttachFolderWebFromComposer = useCallback(() => {
    if (machineOffline) {
      showToast(t('machine_offline_error'), 'error')
      return
    }
    setShowComposerMenu(false)
    void handleAttachFolderWeb()
  }, [handleAttachFolderWeb, machineOffline, setShowComposerMenu, showToast, t])

  const renderComposerAction = useCallback(
    (actionId: ComposerActionId) => {
      switch (actionId) {
        case 'plus':
          if (isDesktop) {
            return (
              <DesktopComposerIconButton
                key={actionId}
                actionRef={composerMenuButtonRef}
                icon="plus"
                colors={colors}
                selected={showComposerMenu}
                onPress={() => setShowComposerMenu((prev) => !prev)}
                accessibilityLabel={t('composer_more_actions')}
                testID="composer-more-btn"
              />
            )
          }
          return (
            <ActionIconButton
              key={actionId}
              icon="add"
              label={t('composer_more_actions')}
              color={showComposerMenu ? colors.brand : colors.textSecondary}
              expanded={showComposerMenu}
              onPress={() => setShowComposerMenu((prev) => !prev)}
              testID="composer-more-btn"
            />
          )
        case 'attach':
          return (
            <Pressable
              key={actionId}
              style={styles.toolBtn}
              onPress={handleAttachWebFromComposer}
              accessibilityLabel={t('attach_file')}
            >
              <Feather
                name="paperclip"
                size={18}
                color={isUploading ? colors.brand : colors.textSecondary}
              />
            </Pressable>
          )
        case 'pick-file':
          return (
            <Pressable
              key={actionId}
              style={styles.toolBtn}
              onPress={handlePickNativeFileFromComposer}
              accessibilityLabel={t('pick_file')}
            >
              <Feather
                name="file"
                size={18}
                color={isUploading ? colors.brand : colors.textSecondary}
              />
            </Pressable>
          )
        case 'pick-image':
          return (
            <Pressable
              key={actionId}
              style={styles.toolBtn}
              onPress={handlePickNativeMediaFromComposer}
              accessibilityLabel={t('pick_image')}
            >
              <Feather
                name="image"
                size={18}
                color={isUploading ? colors.brand : colors.textSecondary}
              />
            </Pressable>
          )
        case 'file-drawer':
          return (
            <Pressable
              key={actionId}
              style={[
                styles.toolBtn,
                fileDrawerOpen ? { backgroundColor: `${colors.brand}10` } : null,
              ]}
              onPress={openFileDrawerFromComposer}
              accessibilityLabel={t('file_browser')}
              testID="file-drawer-btn"
            >
              <Feather
                name="folder"
                size={18}
                color={fileDrawerOpen ? colors.brand : colors.textSecondary}
              />
            </Pressable>
          )
        case 'model': {
          const modelContent = (
            <>
              <HeadEllipsisText
                style={[
                  styles.modelBtnText,
                  { color: showModelSelector ? colors.brand : colors.textSecondary },
                ]}
              >
                {currentModelLabel || t('model')}
              </HeadEllipsisText>
              {canOpenModelSelector ? (
                <Feather
                  name="chevron-down"
                  size={14}
                  color={showModelSelector ? colors.brand : colors.textTertiary}
                />
              ) : null}
            </>
          )
          const cycleReasoningEffort = () => {
            const index = reasoningEfforts.findIndex(
              (effort) => effort.id === effectiveReasoningEffort,
            )
            const next = reasoningEfforts[(index + 1) % reasoningEfforts.length]
            if (next) setPreferredReasoningEffort(next.id)
          }
          const reasoningContent = (
            <>
              <Text
                style={[styles.modelBtnText, { color: colors.textSecondary }]}
                numberOfLines={1}
              >
                {currentReasoningLabel || t('conversation_settings_short')}
              </Text>
              <Feather name="chevron-down" size={14} color={colors.textTertiary} />
            </>
          )

          return (
            <View key={actionId} style={styles.modelControlGroup}>
              {isDesktop ? (
                <DesktopComposerTextButton
                  colors={colors}
                  maxWidth={180}
                  selected={showModelSelector}
                  disabled={modelSelectorBusy || !canOpenModelSelector}
                  onPress={openModelSelector}
                  accessibilityLabel={t('model_selector_title')}
                >
                  {modelContent}
                </DesktopComposerTextButton>
              ) : (
                <Pressable
                  style={[
                    styles.modelBtn,
                    {
                      backgroundColor: showModelSelector ? `${colors.brand}10` : 'transparent',
                      maxWidth: isDesktop ? 180 : 132,
                    },
                    !canOpenModelSelector ? styles.modelBtnReadonly : null,
                  ]}
                  onPress={openModelSelector}
                  disabled={modelSelectorBusy || !canOpenModelSelector}
                  accessibilityLabel={t('model_selector_title')}
                >
                  {modelContent}
                </Pressable>
              )}
              {(canShowReasoningEffort && effectiveReasoningEffort) || canOpenConversationSettings ? (
                isDesktop ? (
                  <DesktopComposerTextButton
                    colors={colors}
                    maxWidth={120}
                    onPress={cycleReasoningEffort}
                    accessibilityLabel={t('reasoning_effort')}
                    testID="reasoning-effort-btn"
                  >
                    {reasoningContent}
                  </DesktopComposerTextButton>
                ) : (
                  <Pressable
                    style={[
                      styles.modelBtn,
                      {
                        backgroundColor: 'transparent',
                        maxWidth: isDesktop ? 120 : 96,
                      },
                    ]}
                    onPress={canOpenConversationSettings ? openConversationSettings : cycleReasoningEffort}
                    accessibilityLabel={t(canOpenConversationSettings ? 'conversation_settings_title' : 'reasoning_effort')}
                    testID="reasoning-effort-btn"
                  >
                    {reasoningContent}
                  </Pressable>
                )
              ) : null}
            </View>
          )
        }
      }
    },
    [
      params.stewardMode,
      canOpenModelSelector,
      canShowReasoningEffort,
      canOpenConversationSettings,
      openConversationSettings,
      colors,
      currentModelLabel,
      currentReasoningLabel,
      effectiveReasoningEffort,
      fileDrawerOpen,
      handleAttachWebFromComposer,
      handlePickNativeFileFromComposer,
      handlePickNativeMediaFromComposer,
      isDesktop,
      isUploading,
      modelSelectorBusy,
      openFileDrawerFromComposer,
      openModelSelector,
      reasoningEfforts,
      setPreferredReasoningEffort,
      setShowComposerMenu,
      showComposerMenu,
      showModelSelector,
      t,
    ],
  )

  const composerContextMenu =
    params.stewardMode && Platform.OS !== 'web' && showComposerMenu ? (
      <ComposerActionMenu colors={colors} vertical items={[
        ...directoryMenu.items,
        ...(params.onInspiration ? [{ id: 'inspiration', icon: 'zap' as const, label: t('inspiration_title'), testID: 'steward-inspiration-menu', onPress: () => { setShowComposerMenu(false); params.onInspiration?.() } }] : []),
        { id: 'file', icon: 'folder', label: directoryMenu.fileLabel, onPress: handlePickNativeFileFromComposer },
        { id: 'camera', icon: 'camera', label: directoryMenu.cameraLabel, onPress: () => { setShowComposerMenu(false); void handleTakeNativePhoto?.() } },
        { id: 'media', icon: 'image', label: directoryMenu.mediaLabel, onPress: handlePickNativeMediaFromComposer },
      ]} />
    ) :
    Platform.OS === 'web' && showComposerMenu ? (
      <View
        ref={isDesktop ? composerMenuRef : undefined}
        accessibilityRole={isDesktop ? 'menu' : undefined}
        accessibilityViewIsModal={isDesktop || undefined}
        style={[
          styles.composerPopover,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <ComposerPopoverAction
          actionRef={isDesktop ? firstComposerMenuActionRef : undefined}
          colors={colors}
          icon="paperclip"
          label={t('pick_file')}
          onPress={handleAttachWebFromComposer}
        />
        <View style={[styles.composerPopoverDivider, { backgroundColor: colors.border }]} />
        <ComposerPopoverAction
          colors={colors}
          icon="folder-plus"
          label={t('upload_folder')}
          onPress={handleAttachFolderWebFromComposer}
        />
        <View style={[styles.composerPopoverDivider, { backgroundColor: colors.border }]} />
        <ComposerPopoverAction
          colors={colors}
          icon="folder"
          label={t('file_browser')}
          onPress={openFileDrawerFromComposer}
          testID="file-drawer-menu-btn"
        />
        {canShowAgentCapabilities ? (
          <View style={[styles.composerPopoverDivider, { backgroundColor: colors.border }]} />
        ) : null}
        {canShowAgentCapabilities ? (
          <ComposerPopoverAction
            colors={colors}
            icon="zap"
            label={t('agent_capabilities_action')}
            onPress={openAgentCapabilities}
            testID="agent-capability-menu-btn"
          />
        ) : null}
      </View>
    ) : Platform.OS !== 'web' && showComposerMenu ? (
      <ComposerActionMenu
        colors={colors}
        items={[
          {
            id: 'media',
            icon: 'image',
            label: t('composer_menu_photos'),
            onPress: handlePickNativeMediaFromComposer,
          },
          {
            id: 'camera',
            icon: 'camera',
            label: t('profile_avatar_camera'),
            onPress: () => {
              setShowComposerMenu(false)
              void handleTakeNativePhoto?.()
            },
          },
          {
            id: 'file',
            icon: 'file',
            label: t('composer_menu_files'),
            onPress: handlePickNativeFileFromComposer,
          },
          {
            id: 'browser',
            icon: 'folder',
            label: t('composer_menu_machine_files'),
            onPress: openFileDrawerFromComposer,
            active: fileDrawerOpen,
            testID: 'file-drawer-menu-btn',
          },
          ...(canShowAgentCapabilities
            ? [
                {
                  id: 'capabilities',
                  icon: 'zap' as const,
                  label: t('composer_menu_skill'),
                  onPress: openAgentCapabilities,
                  testID: 'agent-capability-menu-btn',
                },
              ]
            : []),
        ]}
      />
    ) : null

  const composerActionIds = useMemo(
    () => getComposerActionIds(Platform.OS === 'web' ? 'web' : 'native', canShowModelControl || Boolean(canOpenConversationSettings)),
    [canShowModelControl, canOpenConversationSettings],
  )

  return {
    composerContextMenu,
    openFileDrawerFromComposer,
    toolbarActions: composerActionIds.map(renderComposerAction),
  }
}

function ComposerPopoverAction({
  actionRef,
  colors,
  icon,
  label,
  onPress,
  testID,
}: {
  actionRef?: RefObject<View | null>
  colors: ThemeColors
  icon: keyof typeof Feather.glyphMap
  label: string
  onPress: () => void
  testID?: string
}) {
  return (
    <Pressable
      ref={actionRef}
      accessibilityRole="menuitem"
      accessibilityLabel={label}
      style={(state) => [
        styles.composerPopoverAction,
        {
          borderColor: (state as { focused?: boolean }).focused
            ? colors.brand
            : 'transparent',
        },
        (state as { hovered?: boolean }).hovered ? { backgroundColor: colors.surfaceHover } : null,
      ]}
      onPress={onPress}
      testID={testID}
    >
      <Feather name={icon} size={17} color={colors.textSecondary} />
      <Text style={[styles.composerPopoverText, { color: colors.text }]}>{label}</Text>
    </Pressable>
  )
}
