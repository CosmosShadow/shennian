// @arch docs/features/agent-workspaces.md#创建前真实可用性验证
// @test src/__tests__/agent-workspace-form.test.ts

import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'

export type AgentWorkspaceValidationState =
  | { phase: 'hidden' }
  | { phase: 'validating' }
  | { phase: 'saving' }
  | { phase: 'failed'; messageKey: string }

export function AgentWorkspaceValidationModal({
  action,
  state,
  onBack,
  onRetry,
}: {
  action: 'create' | 'save'
  state: AgentWorkspaceValidationState
  onBack: () => void
  onRetry: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  if (state.phase === 'hidden') return null
  const failed = state.phase === 'failed'
  const validationComplete = state.phase === 'saving'

  return (
    <Modal transparent animationType="fade" visible onRequestClose={failed ? onBack : undefined}>
      <View style={styles.root}>
        <View style={[styles.backdrop, { backgroundColor: '#00000066' }]} />
        <View style={[styles.panel, { backgroundColor: colors.surface }]}> 
          <Text style={[styles.title, { color: colors.text }]}>
            {t(action === 'create'
              ? 'agents_validation_create_title'
              : 'agents_validation_save_title')}
          </Text>
          {failed ? (
            <View style={styles.resultRow}>
              <Ionicons name="alert-circle-outline" size={24} color={colors.error} />
              <Text style={[styles.resultText, { color: colors.text }]}>
                {t(state.messageKey)}
              </Text>
            </View>
          ) : (
            <>
              <StatusRow
                done={validationComplete}
                label={validationComplete
                  ? t('agents_validation_reply_ready')
                  : t('agents_validation_running')}
              />
              <StatusRow
                done={false}
                active={validationComplete}
                label={t(action === 'create'
                  ? 'agents_validation_creating'
                  : 'agents_validation_saving')}
                muted={!validationComplete}
              />
            </>
          )}
          {failed ? (
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                style={[styles.secondaryButton, { borderColor: colors.border }]}
                onPress={onBack}
              >
                <Text style={[styles.buttonText, { color: colors.text }]}>
                  {t('agents_validation_back')}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={[styles.primaryButton, { backgroundColor: colors.brand }]}
                onPress={onRetry}
              >
                <Text style={[styles.buttonText, { color: '#fff' }]}>
                  {t('agents_validation_retry')}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  )
}

function StatusRow({
  done,
  active = !done,
  muted = false,
  label,
}: {
  done: boolean
  active?: boolean
  muted?: boolean
  label: string
}) {
  const { colors } = useTheme()
  return (
    <View style={styles.statusRow}>
      {done ? (
        <Ionicons name="checkmark-circle" size={22} color={colors.success} />
      ) : active ? (
        <ActivityIndicator size="small" color={colors.brand} />
      ) : (
        <View style={[styles.pendingDot, { borderColor: colors.border }]} />
      )}
      <Text style={[styles.statusText, { color: muted ? colors.textTertiary : colors.text }]}> 
        {label}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  backdrop: { ...StyleSheet.absoluteFillObject },
  panel: { width: '100%', maxWidth: 360, borderRadius: 18, padding: 22, gap: 18 },
  title: { fontSize: 18, lineHeight: 24, fontWeight: '700' },
  statusRow: { minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 12 },
  statusText: { flex: 1, fontSize: 15, lineHeight: 21 },
  pendingDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 1 },
  resultRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  resultText: { flex: 1, fontSize: 15, lineHeight: 21 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 2 },
  secondaryButton: {
    flex: 1,
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
})
