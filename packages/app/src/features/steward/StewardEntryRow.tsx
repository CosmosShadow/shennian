// @arch docs/tasks/20260929-1455_神念管家本机入口.md
// @test src/__tests__/steward-model.test.ts

import { useCallback, useMemo, useState } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../config/auth'
import { useMachinesStore } from '@shennian/shared'
import { formatSessionClockTime } from '../session-list/display'
import { useTheme } from '../../hooks/useTheme'
import { mobileTypography } from '../../theme/mobileTypography'
import { stewardHistory, stewardUnreadMachineIds } from './stewardModel'
import { useStewardSessionsStore } from './stewardSessionsStore'
import { usePrimaryMachine } from '../personal-workspace/usePrimaryMachine'

/**
 * The conversation list's single steward entry; its history lives inside the steward page.
 * Preview text only ever comes from the machine the user currently has selected here on this
 * device — another machine's activity shows only as a dot, never as content, so there is no
 * mismatch between what this row implies and which conversation actually opens.
 */
export function StewardEntryRow({ query }: { query: string }) {
  const router = useRouter()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const accountId = useAuthStore((state) => state.user?.id ?? '')
  const sessions = useStewardSessionsStore((state) => state.sessions)
  const machines = useMachinesStore((state) => state.machines)
  const primary = usePrimaryMachine()
  const currentMachineId = primary.record?.machine?.id
  // The steward's history is not part of the ordinary session sync, so refresh it here.
  useFocusEffect(useCallback(() => {
    const store = useStewardSessionsStore.getState()
    void store.hydrate(accountId).then(() => store.refresh(accountId))
  }, [accountId]))
  const [pressed, setPressed] = useState(false)
  const history = useMemo(() => stewardHistory(sessions), [sessions])
  // The newest conversation on the currently selected machine that actually has a message.
  const latest = useMemo(
    () => history.find((item) => item.lastMessagePreview && item.machineId === currentMachineId),
    [history, currentMachineId],
  )
  // Use the switcher's own reachable-machine scope; an unpaired historical machine
  // must never leave an entry dot with no conversation the user can open.
  const unread = useMemo(() => stewardUnreadMachineIds(history, machines.filter(item => item.id === currentMachineId)).length > 0, [history, machines, currentMachineId])
  const title = t('steward_title')
  if (query && !title.toLowerCase().includes(query.toLowerCase())) return null
  const preview = latest?.lastMessagePreview || t('steward_entry_subtitle')
  const time = latest ? formatSessionClockTime(latest.lastMessagePreviewAt ?? latest.lastActivityAt) : ''
  return (
    <Pressable
      testID="steward-conversation-row"
      accessibilityRole="button"
      onPress={() => router.navigate('/(main)/steward')}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[styles.row, {
        borderBottomColor: colors.border,
        backgroundColor: pressed ? colors.surfaceHover : colors.bg,
      }]}
    >
      <Image source={require('../../../assets/shennian-avatar.png')} style={styles.logo} />
      <View style={styles.copy}>
        <View style={styles.titleRow}>
          <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>{title}</Text>
          {unread ? <View testID="steward-entry-unread" style={[styles.unreadDot, { backgroundColor: colors.error }]} /> : null}
          {time ? <Text numberOfLines={1} style={[styles.time, { color: colors.textMuted }]}>{time}</Text> : null}
        </View>
        <Text numberOfLines={1} style={{ color: colors.textMuted }}>{preview}</Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 18, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  logo: { width: 46, height: 46, resizeMode: 'contain' },
  copy: { flex: 1, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flex: 1, minWidth: 0, fontSize: 16, fontWeight: '600' },
  time: { ...mobileTypography.metadata, flexShrink: 0 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
})
