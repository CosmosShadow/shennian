// @arch docs/features/builtin-personal-agent.md
// @test src/__tests__/steward-settings-behavior.test.ts
import { useRef, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../hooks/useTheme'
import { mobileTypography } from '../../../theme/mobileTypography'

export function StewardConversationActions({ available, canReset, resetContext, clearDisplay }: {
  available: boolean
  canReset: boolean
  resetContext: () => Promise<boolean>
  clearDisplay: () => Promise<void>
}) {
  const { t } = useTranslation(), { colors } = useTheme()
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const running = useRef(false)
  const confirm = (kind: 'reset' | 'display') => {
    if (!available || running.current) return
    if (kind === 'reset' && !canReset) {
      Alert.alert(t('steward_action_reset'), t('steward_action_reset_upgrade'))
      return
    }
    Alert.alert(t(`steward_action_${kind}`), t(`steward_action_${kind}_confirm`), [
      { text: t('cancel'), style: 'cancel' },
      { text: t(`steward_action_${kind}`), style: 'destructive', onPress: () => {
        if (running.current) return
        running.current = true
        setBusy(true)
        setResult('')
        void (async () => {
          try {
            if (kind === 'reset') {
              if (!await resetContext()) throw new Error('reset_failed')
            } else await clearDisplay()
            setResult(`steward_action_${kind}_done`)
          } catch { setResult('steward_action_failed') }
          finally { running.current = false; setBusy(false) }
        })()
      } },
    ])
  }
  return <View>
    <Pressable testID="steward-conversation-settings" accessibilityRole="button" accessibilityState={{ expanded }}
      onPress={() => setExpanded(value => !value)} style={[styles.disclosure, { borderBottomColor: colors.border }]}>
      <Text style={[styles.heading, { color: colors.text }]}>{t('steward_conversation_settings')}</Text>
      <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textSecondary} />
    </Pressable>
    {expanded ? <View style={styles.section}>
      {(['reset', 'display'] as const).map(kind => <View key={kind} style={styles.action}>
        <Pressable testID={`steward-action-${kind}`} accessibilityRole="button" disabled={!available || busy}
          accessibilityState={{ disabled: !available || busy }} onPress={() => confirm(kind)}
          style={({ pressed }) => [styles.button, { borderColor: colors.border, backgroundColor: pressed ? colors.surfaceHover : colors.surface, opacity: !available || busy ? 0.45 : 1 }]}>
          <Text style={[styles.label, { color: colors.text }]}>{t(`steward_action_${kind}`)}</Text>
        </Pressable>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>{t(`steward_action_${kind}_hint`)}</Text>
      </View>)}
      {result ? <Text accessibilityLiveRegion="polite" testID="steward-action-result" style={[styles.hint, { color: colors.textSecondary }]}>{t(result)}</Text> : null}
    </View> : null}
  </View>
}
const styles = StyleSheet.create({
  disclosure: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  heading: { flex: 1, ...mobileTypography.body },
  section: { paddingVertical: 20, gap: 24, alignItems: 'center' },
  action: { width: '100%', alignItems: 'center', gap: 8 },
  button: { width: '100%', maxWidth: 360, minHeight: 48, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  label: { ...mobileTypography.sectionTitle, textAlign: 'center' },
  hint: { ...mobileTypography.metadata, textAlign: 'center' },
})
