// @arch docs/features/agent-workspaces.md
// @test packages/app/src/__tests__/agent-workspace-form.test.ts

import { agentValidationMessageKey } from '../agentWorkspaceValidation'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { AppPageHeader } from '../../../components/AppPageHeader'
import { createAgentWithAvatar } from '../agentEditorModel'
import { useAuthStore } from '../../../config/auth'
import {
  AgentWorkspaceForm,
  type AgentWorkspaceDraft,
  type AgentWorkspaceFormHandle,
} from '../AgentWorkspaceForm'
import { useTheme } from '../../../hooks/useTheme'
import { accountRuntime } from '../../account-runtime/accountRuntime'
import {
  AgentWorkspaceValidationModal,
  type AgentWorkspaceValidationState,
} from '../AgentWorkspaceValidationModal'
import { AgentAvatarDraftEditor } from '../AgentAvatarDraftEditor'
import {
  uploadAgentAvatarDraft,
  type AgentAvatarDraft,
} from '../AgentAvatarEditor'
import { useAgentWorkspaceKeyboardScroll } from '../useAgentWorkspaceKeyboardScroll'

export default function NewAgentRoute() {
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return <NewAgentForm key={accountId ?? 'signed-out'} />
}

function NewAgentForm() {
  const router = useRouter()
  const { returnTo = '', roomId = '' } = useLocalSearchParams<{
    returnTo?: string
    roomId?: string
  }>()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  const contextRef = useRef({ accountId, active: true })
  contextRef.current.accountId = accountId
  const creating = useRef(false)
  useEffect(() => {
    contextRef.current.active = true
    return () => { contextRef.current.active = false }
  }, [])
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<AgentWorkspaceDraft | null>(null)
  const [draftCanSubmit, setDraftCanSubmit] = useState(false)
  const [avatarDraft, setAvatarDraft] = useState<AgentAvatarDraft | null>(null)
  const [validationState, setValidationState] = useState<AgentWorkspaceValidationState>({
    phase: 'hidden',
  })
  const validationDraftRef = useRef<AgentWorkspaceDraft | null>(null)
  const formRef = useRef<AgentWorkspaceFormHandle>(null)
  const { scrollRef, revealFocusedField, keyboardHeight } =
    useAgentWorkspaceKeyboardScroll(insets.top)
  const handleDraftChange = useCallback((nextDraft: AgentWorkspaceDraft, canSubmit: boolean) => {
    setDraft(nextDraft)
    setDraftCanSubmit(canSubmit)
  }, [])
  const submit = async (draft: AgentWorkspaceDraft) => {
    if (!accountId || creating.current) return
    const isCurrent = () => contextRef.current.active && contextRef.current.accountId === accountId &&
      useAuthStore.getState().user?.id === accountId
    creating.current = true
    setBusy(true)
    validationDraftRef.current = draft
    setValidationState({ phase: 'validating' })
    try {
      if (!draft.machineId) throw new Error('agent_validation_invalid_configuration')
      const validation = await accountRuntime.requestMachine(
        draft.machineId,
        'agent.workspace.validate',
        draft,
        { connectTimeoutMs: 10_000, responseTimeoutMs: 70_000 },
      )
      if (!isCurrent()) return
      if (!validation.ok) throw new Error(validation.error || 'agent_validation_failed')
      setValidationState({ phase: 'saving' })
      const createdAgentId = await createAgentWithAvatar({
        accountId, draft, isCurrent,
        uploadAvatar: avatarDraft ? (id) => uploadAgentAvatarDraft(id, avatarDraft) : undefined,
        onAvatarError: () => Alert.alert(t('agents_avatar_save_failed')),
      })
      if (!isCurrent()) return
      if (returnTo === 'room-agent-add' && roomId) {
        router.dismissTo({
          pathname: '/(main)/spaces/agent-add',
          params: { roomId, createdAgentId },
        })
        return
      }
      router.replace(`/(main)/agents/${createdAgentId}`)
    } catch (error) {
      if (!isCurrent()) return
      if (__DEV__) console.warn('[agent-create] request failed', error)
      setValidationState({
        phase: 'failed',
        messageKey: agentValidationMessageKey(error),
      })
    } finally {
      creating.current = false
      if (isCurrent()) setBusy(false)
    }
  }
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
      <AppPageHeader
        title={t('mobile_create_ai')}
        onBack={() => router.back()}
        trailing={
          <Pressable
            testID="agent-create-header"
            accessibilityRole="button"
            accessibilityLabel={t('agents_create_action')}
            disabled={busy || !draftCanSubmit || !draft}
            style={[styles.headerAction, (busy || !draftCanSubmit || !draft) && styles.disabled]}
            onPress={() => {
              void formRef.current?.prepareSubmit().then((prepared) => {
                if (prepared) void submit(prepared)
              })
            }}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.brand} />
            ) : (
              <Text
                style={[styles.headerActionText, { color: colors.brand }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
              >
                {t('agents_create_action')}
              </Text>
            )}
          </Pressable>
        }
      />
      <ScrollView
        ref={scrollRef}
        testID="agent-create-scroll"
        style={styles.scroll}
        contentContainerStyle={styles.content}
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        keyboardDismissMode="none"
        keyboardShouldPersistTaps="always"
      >
        <AgentWorkspaceForm
          ref={formRef}
          busy={busy}
          submitLabel={t('agents_create')}
          showSubmitButton={false}
          createLayout
          onDraftChange={handleDraftChange}
          onFieldFocus={revealFocusedField}
          profileAccessory={
            <AgentAvatarDraftEditor
              name={draft?.displayName ?? ''}
              value={avatarDraft}
              disabled={busy}
              onChange={setAvatarDraft}
            />
          }
          onSubmit={(draft) => void submit(draft)}
        />
      </ScrollView>
      <View testID="agent-create-keyboard-spacer" style={{ height: keyboardHeight }} />
      <AgentWorkspaceValidationModal
        action="create"
        state={validationState}
        onBack={() => setValidationState({ phase: 'hidden' })}
        onRetry={() => {
          const retryDraft = validationDraftRef.current
          if (retryDraft) void submit(retryDraft)
        }}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 36 },
  headerAction: { minWidth: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  headerActionText: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  disabled: { opacity: 0.4 },
})
