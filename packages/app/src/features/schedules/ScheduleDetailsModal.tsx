// @arch docs/features/conversation-schedules.md
import { useRef } from 'react'
import { Modal, Pressable, ScrollView, View, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useWebModalFocus } from '../../hooks/useWebModalFocus'
import { ConversationSchedules } from './ConversationSchedules'
export function ScheduleDetailsModal({ roomId, sessionId, agentNames, onClose }: { roomId?: string; sessionId?: string; agentNames?: Record<string, string>; onClose: () => void }) {
  const containerRef = useRef<View>(null)
  useEscapeKey(true, onClose)
  useWebModalFocus({ visible: true, containerRef })
  const { colors } = useTheme()
  const { t } = useTranslation()
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <View style={{ flex: 1, padding: 24, justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.3)' }}>
      <View ref={containerRef} accessibilityViewIsModal style={{ backgroundColor: colors.bg, maxHeight: '85%', width: '100%', maxWidth: 600, alignSelf: 'center' }}>
        <Pressable accessibilityRole="button" onPress={onClose} style={{ minHeight: 48, padding: 16, alignSelf: 'flex-end' }}><Text style={{ color: colors.brand }}>{t('close')}</Text></Pressable>
        <ScrollView><ConversationSchedules sessionId={sessionId} roomId={roomId} agentNames={agentNames} /></ScrollView>
      </View>
    </View>
  </Modal>
}
