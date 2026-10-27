// @arch docs/design/desktop/unified-desktop-control.md#组件复用清单
// @test ../../__tests__/desktop-attachment-preview-route.test.ts

import { useMemo } from 'react'
import { ActivityIndicator, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useSessionsStore } from '@shennian/shared'
import { useTheme } from '../../hooks/useTheme'
import { DesktopMachineAction } from '../desktop-machines/DesktopMachineAction'
import { useDesktopAccountSync } from '../desktop-control/useDesktopAccountSync'
import { DesktopChatFileWorkspace } from './DesktopChatFileWorkspace'
import {
  resolveDesktopAttachmentPreview,
  type DesktopAttachmentPreviewParams,
} from './desktopAttachmentPreviewController'

export default function DesktopAttachmentPreviewScreen() {
  const params = useLocalSearchParams<DesktopAttachmentPreviewParams>()
  const router = useRouter()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { width } = useWindowDimensions()
  const runtime = useDesktopAccountSync()
  const sessions = useSessionsStore((state) => state.sessions)
  const { sessionId, path, name, kind, line, endLine } = params
  const resolved = useMemo(
    () => resolveDesktopAttachmentPreview({ sessionId, path, name, kind, line, endLine }, sessions),
    [endLine, kind, line, name, path, sessionId, sessions],
  )
  const close = () => {
    if (resolved) {
      router.replace(`/(main)/chat/${resolved.session.id}`)
      return
    }
    router.replace('/(main)')
  }

  if (!runtime.bootstrapped) {
    return (
      <View
        testID="desktop-attachment-preview-loading"
        style={[styles.center, { backgroundColor: colors.bg }]}
        accessibilityRole="progressbar"
        accessibilityLabel={t('loading')}
      >
        <ActivityIndicator color={colors.brand} />
      </View>
    )
  }

  if (!resolved) {
    return (
      <View
        testID="desktop-attachment-preview-unavailable"
        style={[styles.center, { backgroundColor: colors.bg }]}
      >
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.textSecondary }]}>
          {t('error')}
        </Text>
        <DesktopMachineAction label={t('back')} onPress={close} />
      </View>
    )
  }

  return (
    <View testID="desktop-attachment-preview-screen" style={styles.screen}>
      <DesktopChatFileWorkspace
        narrow
        width={width}
        colors={colors}
        machineId={resolved.session.machineId}
        sessionId={resolved.session.id}
        workDir={resolved.session.workDir}
        previewRequest={resolved.request}
        onClose={close}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, minWidth: 0, minHeight: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  error: { maxWidth: 360, fontSize: 14, lineHeight: 20, textAlign: 'center' },
})
