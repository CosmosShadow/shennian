// @arch docs/features/agent-workspaces.md
// @arch docs/features/agent-local-first-persistence.md#十一隐私和账号隔离
// @test ../../../__tests__/agent-workspaces-navigation.test.ts
// @test ../../../__tests__/agent-workspace-draft.test.ts
// @test ../../../__tests__/agent-detail-account-state.test.ts

import { accountRuntime } from '../../account-runtime/accountRuntime'
import { agentValidationMessageKey } from '../agentWorkspaceValidation'
import {
  AgentWorkspaceValidationModal,
  type AgentWorkspaceValidationState,
} from '../AgentWorkspaceValidationModal'
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
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { AppPageHeader } from '../../../components/AppPageHeader'
import { Toast } from '../../../components/Toast'
import { createAgentEditorModel } from '../agentEditorModel'
import type { AgentEditorModel } from '../agentEditorModel.types'
import { useTheme } from '../../../hooks/useTheme'
import {
  AgentWorkspaceForm,
  type AgentWorkspaceDraft,
  type AgentWorkspaceFormHandle,
} from '../AgentWorkspaceForm'
import { AgentAvatarEditor } from '../AgentAvatarEditor'
import { useAuthStore } from '../../../config/auth'
import {
  agentWorkspaceDraftSignature,
  agentWorkspaceRequiresConversationRestart,
  agentWorkspaceRequiresValidation,
  toAgentWorkspaceDraft,
} from '../agent-workspace-draft'
import { useAgentWorkspaceKeyboardScroll } from '../useAgentWorkspaceKeyboardScroll'
import { useToast } from '../../../hooks/useToast'
import {
  applyAgentDetailResult,
  switchAgentDetailAccount,
  type AgentDetailAccountState,
} from '../agentDetailAccountState'
import { deleteAgentWorkspace } from '../deleteAgentWorkspace.native'

export default function AgentSettingsRoute() {
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  const { agentId = '' } = useLocalSearchParams<{ agentId: string }>()
  return <AgentSettingsForm key={`${accountId ?? 'signed-out'}:${agentId}`} />
}

function AgentSettingsForm() {
  const { agentId = '', returnAfterSave } = useLocalSearchParams<{ agentId: string; returnAfterSave?: string }>()
  const router = useRouter()
  const navigation = useNavigation()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  const [agentDetail, setAgentDetail] = useState<AgentDetailAccountState>(() => ({
    accountId,
    agentId,
    agent: null,
  }))
  const agent = switchAgentDetailAccount(agentDetail, accountId, agentId).agent
  const [draft, setDraft] = useState<AgentWorkspaceDraft | null>(null)
  const [draftCanSubmit, setDraftCanSubmit] = useState(false)
  const [savedSignature, setSavedSignature] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [validationState, setValidationState] = useState<AgentWorkspaceValidationState>({
    phase: 'hidden',
  })
  const validationDraftRef = useRef<AgentWorkspaceDraft | null>(null)
  const saveInFlight = useRef(false)
  const deleteInFlight = useRef(false)
  const { toast, showToast, hideToast } = useToast()
  const formRef = useRef<AgentWorkspaceFormHandle>(null)
  const editorRef = useRef<AgentEditorModel | null>(null)
  const routeContext = useRef({ accountId, agentId })
  routeContext.current = { accountId, agentId }
  const { scrollRef, revealFocusedField, keyboardHeight } = useAgentWorkspaceKeyboardScroll(
    insets.top,
  )

  useEffect(() => {
    setAgentDetail((current) => switchAgentDetailAccount(current, accountId, agentId))
    setValidationState({ phase: 'hidden' })
    validationDraftRef.current = null
    setDraft(null)
    setDraftCanSubmit(false)
    setSavedSignature('')
    setLoadFailed(false)
    if (!accountId) {
      router.back()
      return
    }
    let active = true
    const editor = createAgentEditorModel({
      accountId, agentId,
      isCurrent: () => active && routeContext.current.accountId === accountId &&
        routeContext.current.agentId === agentId && useAuthStore.getState().user?.id === accountId,
      onAgent: (refreshedAgent) => {
        setLoadFailed(!refreshedAgent)
        setAgentDetail((current) =>
          refreshedAgent
            ? applyAgentDetailResult(current, accountId, agentId, refreshedAgent)
            : { accountId, agentId, agent: null },
        )
        if (refreshedAgent) setSavedSignature(agentWorkspaceDraftSignature(toAgentWorkspaceDraft(refreshedAgent)))
      },
      onError: () => { if (active) setLoadFailed(true) },
    })
    editorRef.current = editor
    const stop = editor.start()
    return () => {
      active = false
      stop()
      if (editorRef.current === editor) editorRef.current = null
    }
  }, [accountId, agentId, router, t])

  const currentSignature = draft ? agentWorkspaceDraftSignature(draft) : ''
  const isDirty = Boolean(draft && savedSignature && currentSignature !== savedSignature)

  const handleDraftChange = useCallback((nextDraft: AgentWorkspaceDraft, canSubmit: boolean) => {
    setDraft(nextDraft)
    setDraftCanSubmit(canSubmit)
  }, [])

  const save = useCallback(
    async (nextDraft: AgentWorkspaceDraft): Promise<boolean> => {
      const editor = editorRef.current
      if (!agent || !editor || saveInFlight.current) return false
      const isCurrent = () => editorRef.current === editor && routeContext.current.accountId === accountId &&
        routeContext.current.agentId === agentId && useAuthStore.getState().user?.id === accountId
      saveInFlight.current = true
      setSaving(true)
      const needsValidation = agentWorkspaceRequiresValidation(
        toAgentWorkspaceDraft(agent),
        nextDraft,
      )
      let validated = false
      validationDraftRef.current = nextDraft
      try {
        if (needsValidation) {
          setValidationState({ phase: 'validating' })
          const validation = await accountRuntime.requestMachine(
            nextDraft.machineId!,
            'agent.workspace.validate',
            nextDraft,
            { connectTimeoutMs: 10_000, responseTimeoutMs: 70_000 },
          )
          if (!isCurrent()) return false
          if (!validation.ok) throw new Error(validation.error || 'agent_validation_failed')
          validated = true
          setValidationState({ phase: 'saving' })
        }
        const requiresRestart = agentWorkspaceRequiresConversationRestart(
          toAgentWorkspaceDraft(agent),
          nextDraft,
        )
        await editor.save(nextDraft)
        if (!isCurrent()) return false
        setSavedSignature(agentWorkspaceDraftSignature(nextDraft))
        setValidationState({ phase: 'hidden' })
        showToast(
          t(requiresRestart ? 'agents_saved_restarting_conversations' : 'agents_saved'),
          'success',
        )
        if (returnAfterSave === '1' && navigation.isFocused()) router.back()
        return true
      } catch (error) {
        if (!isCurrent()) return false
        if (__DEV__) console.warn('[agent-settings] save failed', error)
        if (needsValidation) {
          setValidationState({
            phase: 'failed',
            messageKey: validated
              ? 'agents_save_failed'
              : agentValidationMessageKey(error, 'agents_save_failed'),
          })
        } else {
          Alert.alert(t('agents_save'), t('agents_save_failed'))
        }
        return false
      } finally {
        saveInFlight.current = false
        if (isCurrent()) setSaving(false)
      }
    },
    [accountId, agent, agentId, navigation, returnAfterSave, router, showToast, t],
  )

  const confirmDelete = useCallback(() => {
    if (!accountId || !agent || saving || deleting || deleteInFlight.current) return
    Alert.alert(
      t('agents_delete_title', { name: agent.displayName }),
      t('agents_delete_confirm'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('agents_delete'),
          style: 'destructive',
          onPress: () => {
            if (deleteInFlight.current) return
            deleteInFlight.current = true
            setDeleting(true)
            void deleteAgentWorkspace(accountId, agent)
              .then(() => {
                if (
                  routeContext.current.accountId !== accountId ||
                  routeContext.current.agentId !== agentId ||
                  useAuthStore.getState().user?.id !== accountId
                ) return
                router.dismissTo('/(main)/contacts')
              })
              .catch((error) => {
                if (__DEV__) console.warn('[agent-settings] delete failed', error)
                if (
                  routeContext.current.accountId === accountId &&
                  routeContext.current.agentId === agentId &&
                  useAuthStore.getState().user?.id === accountId
                ) Alert.alert(t('agents_delete_failed'))
              })
              .finally(() => {
                deleteInFlight.current = false
                if (
                  routeContext.current.accountId === accountId &&
                  routeContext.current.agentId === agentId
                ) setDeleting(false)
              })
          },
        },
      ],
    )
  }, [accountId, agent, agentId, deleting, router, saving, t])

  if (!agent) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]}>
        <AppPageHeader title={t('agents_edit')} onBack={() => router.back()} />
        {loadFailed ? (
          <View style={styles.content}>
            <Text style={{ color: colors.textSecondary }}>{t('spaces_agents_load_failed')}</Text>
            <Pressable accessibilityRole="button" testID="agent-editor-retry" style={styles.headerSave}
              onPress={() => {
                setLoadFailed(false)
                void editorRef.current?.retry()
              }}>
              <Text style={{ color: colors.brand }}>{t('retry')}</Text>
            </Pressable>
          </View>
        ) : <ActivityIndicator style={{ flex: 1 }} color={colors.brand} />}
      </SafeAreaView>
    )
  }

  const saveAction = isDirty ? (
    <Pressable
      testID="agent-save-header"
      accessibilityRole="button"
      accessibilityLabel={t('agents_save')}
      disabled={saving || !draftCanSubmit || !draft}
      style={[
        styles.headerSave,
        (saving || !draftCanSubmit || !draft) && styles.disabled,
      ]}
      onPress={() => {
        void formRef.current?.prepareSubmit().then((prepared) => {
          if (prepared) void save(prepared)
        })
      }}
    >
      {saving ? (
        <ActivityIndicator size="small" color={colors.brand} />
      ) : (
        <Text
          style={[styles.headerSaveText, { color: colors.brand }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
        >
          {t('agents_save')}
        </Text>
      )}
    </Pressable>
  ) : null

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
        <AppPageHeader
          title={t('agents_edit')}
          onBack={() => router.back()}
          trailing={saveAction}
        />
      <ScrollView
        ref={scrollRef}
        testID="agent-edit-scroll"
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
        ]}
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        keyboardDismissMode="none"
        keyboardShouldPersistTaps="always"
      >
        <AgentWorkspaceForm
          ref={formRef}
          initial={agent}
          busy={saving}
          submitLabel={t('agents_save')}
          showSubmitButton={false}
          onDraftChange={handleDraftChange}
          onFieldFocus={revealFocusedField}
          profileAccessory={
            <AgentAvatarEditor
              agent={agent}
              onAvatarChanged={(avatar) => {
                if (routeContext.current.accountId !== accountId || routeContext.current.agentId !== agentId) return
                void editorRef.current?.avatarChanged(agent, avatar).catch(() => {
                  Alert.alert(t('error'), t('agents_avatar_save_failed'))
                })
              }}
            />
          }
          onSubmit={(draft) => void save(draft)}
        />
        <View style={[styles.dangerSection, { borderTopColor: colors.border }]}>
          <Pressable
            testID="agent-delete-action"
            accessibilityRole="button"
            accessibilityLabel={t('agents_delete')}
            accessibilityState={{ busy: deleting, disabled: deleting || saving }}
            disabled={deleting || saving}
            onPress={confirmDelete}
            style={({ pressed }) => [
              styles.deleteButton,
              pressed && !deleting && !saving && { backgroundColor: colors.surfaceHover },
              (deleting || saving) && styles.disabled,
            ]}
          >
            {deleting ? (
              <ActivityIndicator size="small" color={colors.error} />
            ) : (
              <Text style={[styles.deleteButtonText, { color: colors.errorText }]}>
                {t('agents_delete')}
              </Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
      <View testID="agent-edit-keyboard-spacer" style={{ height: keyboardHeight }} />
      <AgentWorkspaceValidationModal
        action="save"
        state={validationState}
        onBack={() => setValidationState({ phase: 'hidden' })}
        onRetry={() => {
          const retryDraft = validationDraftRef.current
          if (retryDraft) void save(retryDraft)
        }}
      />
      <Toast
        message={toast?.message ?? ''}
        visible={Boolean(toast)}
        type={toast?.type}
        onHide={hideToast}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 36 },
  headerSave: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  headerSaveText: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  dangerSection: {
    marginTop: 32,
    paddingTop: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  deleteButton: {
    minWidth: 160,
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButtonText: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  disabled: { opacity: 0.4 },
})
