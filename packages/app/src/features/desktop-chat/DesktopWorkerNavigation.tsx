// @arch docs/features/manager-agent.md#九manager-与-worker-的可见-markdown
// @test src/__tests__/desktop-chat-controller.test.ts
import { useContext, useEffect, useState, type ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { RoomAgentModeContext } from '../rooms/components/RoomAgentModePicker'
import { desktopControlMetrics, desktopTypography } from '../desktop-shell/desktopDesignTokens'
import { RoomWorkspaceActivityContext } from '../rooms/RoomWorkspaceActivityContext'
import Ionicons from '@expo/vector-icons/Ionicons'

/** Keep the source mounted so its draft, expanded tools and reading position survive Back. */
export function DesktopWorkerNavigation({ sourceKey, renderSource, renderWorker }: {
  sourceKey?: string
  renderSource: (open: (id: string, title: string) => void) => ReactNode
  renderWorker: (id: string) => ReactNode
}) {
  const parentActive = useContext(RoomWorkspaceActivityContext)
  const [worker, setWorker] = useState<{ id: string; title: string } | null>(null)
  const { colors } = useTheme()
  const { t } = useTranslation()
  useEffect(() => setWorker(null), [sourceKey])
  return <View style={{ flex: 1, minHeight: 0 }}>
    <View style={{ flex: 1, minHeight: 0, display: worker ? 'none' : 'flex' }}>
      <RoomWorkspaceActivityContext.Provider value={parentActive && !worker}>
        {renderSource((id, title) => setWorker({ id, title }))}
      </RoomWorkspaceActivityContext.Provider>
    </View>
    {worker && <View style={{ flex: 1, minHeight: 0 }} testID="desktop-worker-panel">
      <View style={{ height: desktopControlMetrics.headerHeight, flexDirection: 'row', alignItems: 'center', gap: 8,
        paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.bg }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('worker_back_to_manager', '返回 Manager')}
          testID="worker-back-to-manager" onPress={() => setWorker(null)}
          style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </Pressable>
        <Text accessibilityRole="header" numberOfLines={1}
          style={{ ...desktopTypography.windowTitle, color: colors.text, flex: 1 }}>{worker.title}</Text>
      </View>
      <RoomAgentModeContext.Provider value={null}>
        {renderWorker(worker.id)}
      </RoomAgentModeContext.Provider>
    </View>}
  </View>
}
