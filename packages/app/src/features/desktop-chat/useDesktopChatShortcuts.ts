// @arch docs/architecture/app/modular-features.md#聊天-feature
// @test src/__tests__/desktop-action-discoverability-manifest.test.ts

import { useEffect, useMemo, type RefObject } from 'react'
import type { TFunction } from 'i18next'
import type { TextInput } from 'react-native'
import { useKeyboardShortcut } from '../../hooks/useKeyboardShortcut'
import { createChatDiscoverableCommands } from '../chat/utils/discoverableCommands'

export function useDesktopChatShortcuts({
  copyCurrentMessage,
  focusRef,
  onFocused,
  refreshSession,
  sessionId,
  showToast,
  t,
}: {
  copyCurrentMessage: () => void
  focusRef: RefObject<TextInput | null>
  onFocused: (focused: boolean) => void
  refreshSession: () => Promise<'full' | 'cloud'>
  sessionId: string
  showToast: (message: string, type: 'success' | 'error') => void
  t: TFunction
}) {
  const commands = useMemo(
    () =>
      createChatDiscoverableCommands({
        refreshSession: () => {
          void refreshSession()
            .then((mode) => {
              showToast(
                mode === 'full' ? t('refresh_session_success') : t('refresh_session_cloud_success'),
                'success',
              )
            })
            .catch((error) => {
              showToast(
                error instanceof Error ? error.message : t('refresh_session_failed'),
                'error',
              )
            })
        },
        copyCurrentMessage,
      }),
    [copyCurrentMessage, refreshSession, showToast, t],
  )

  useKeyboardShortcut(
    { key: 'r', metaOrCtrl: true, allowEditable: true },
    true,
    commands.refreshSession,
  )
  useKeyboardShortcut(
    { key: 'c', metaOrCtrl: true, shift: true },
    true,
    commands.copyCurrentMessage,
  )

  useEffect(() => {
    const timer = setTimeout(() => {
      focusRef.current?.focus()
      onFocused(true)
    }, 0)
    return () => clearTimeout(timer)
  }, [focusRef, onFocused, sessionId])
}
