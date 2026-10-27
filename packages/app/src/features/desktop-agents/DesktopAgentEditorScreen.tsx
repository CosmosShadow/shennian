// @arch docs/features/agent-workspaces.md
// @arch docs/features/desktop-local-first-client-todo.md
// @test ../../__tests__/desktop-agent-save.test.ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, ScrollView, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useIsFocused, useNavigation, usePreventRemove } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import type { AgentWorkspace } from '@shennian/wire'
import { useAuthStore } from '../../config/auth'
import { useTheme } from '../../hooks/useTheme'
import { useKeyboardShortcut } from '../../hooks/useKeyboardShortcut'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { DesktopMachineAction } from '../desktop-machines/DesktopMachineAction'
import { desktopAccountActions } from '../desktop-control/useDesktopAccountSync'
import { useDesktopAgentDetailModel } from './useDesktopAgentDetailModel'
import {
  DesktopAgentWorkspaceForm,
  type DesktopAgentWorkspaceFormHandle,
} from './DesktopAgentWorkspaceForm'
import {
  desktopAgentDraftSignature,
  desktopAgentWorkspaceToDraft,
  type DesktopAgentWorkspaceDraft,
} from './desktopAgentWorkspaceDraft'
import { DesktopAgentAvatarEditor } from './DesktopAgentAvatarEditor'
import { createDesktopAgentSaveController, saveDesktopAgent } from './desktopAgentSave'
import { agentValidationMessageKey } from '../agents/agentWorkspaceValidation'
import { removeDesktopAgentAvatar, uploadDesktopAgentAvatar } from './desktopAgentAvatarUpload'
import { runDesktopAgentSubmit } from './desktopAgentSubmit'
import type { DesktopAgentSaveResult } from './desktopAgentSave'
import { desktopAgentPort } from './desktopAgentPort'
import { desktopControlMetrics, desktopTypography } from '../desktop-shell/desktopDesignTokens'
import { desktopAgentEditorFallback } from './desktopAgentDetailNavigation'
import { DesktopDialog } from '../desktop-shell/DesktopDialog'
import { desktopNavigationGuard } from '../desktop-shell/desktopNavigationGuard'

export function DesktopNewAgentScreen() {
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return accountId ? <DesktopAgentEditor key={accountId} accountId={accountId} /> : null
}
export function DesktopEditAgentScreen() {
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  const { agentId = '' } = useLocalSearchParams<{ agentId?: string }>()
  return accountId && agentId ? (
    <ExistingAgentEditor key={`${accountId}:${agentId}`} accountId={accountId} agentId={agentId} />
  ) : null
}
function ExistingAgentEditor({ accountId, agentId }: { accountId: string; agentId: string }) {
  const router = useRouter()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const onUnavailable = useCallback(() => router.back(), [router])
  const model = useDesktopAgentDetailModel({ accountId, agentId, onUnavailable })
  const projectedDraft = model.agent ? desktopAgentWorkspaceToDraft(model.agent) : null
  if (model.agent && projectedDraft) {
    return (
      <DesktopAgentEditor accountId={accountId} initial={model.agent} onRefresh={model.refresh} />
    )
  }
  return (
    <View style={{ flex: 1, padding: 24, backgroundColor: colors.bg }}>
      <DesktopMachineAction label={t('back')} onPress={() => router.back()} />
      {model.failed || model.agent ? (
        <View>
          <Text accessibilityRole="alert" style={{ color: colors.text }}>
            {t('spaces_agents_load_failed')}
          </Text>
          <DesktopMachineAction label={t('retry')} onPress={() => void model.refresh()} />
        </View>
      ) : (
        <ActivityIndicator accessibilityLabel={t('loading')} color={colors.brand} />
      )}
    </View>
  )
}
function DesktopAgentEditor({
  accountId,
  initial,
  onRefresh,
}: {
  accountId: string
  initial?: AgentWorkspace
  onRefresh?(): Promise<void>
}) {
  const router = useRouter()
  const navigation = useNavigation()
  const focused = useIsFocused()
  const { returnTo, roomId, returnAfterSave } = useLocalSearchParams<{
    returnTo?: string
    roomId?: string
    returnAfterSave?: string
  }>()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const active = useRef(false)
  const [draft, setDraft] = useState<DesktopAgentWorkspaceDraft | null>(null)
  const [formInitial, setFormInitial] = useState(initial)
  const [formEpoch, setFormEpoch] = useState(0)
  const [canSubmit, setCanSubmit] = useState(false)
  const [savedSignature, setSavedSignature] = useState(() => {
    const initialDraft = initial ? desktopAgentWorkspaceToDraft(initial) : null
    return initialDraft ? desktopAgentDraftSignature(initialDraft) : ''
  })
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [userEdited, setUserEdited] = useState(false)
  const [confirmingLeave, setConfirmingLeave] = useState(false)
  const pendingLeave = useRef<(() => void) | null>(null)
  const savedNavigation = useRef(false)
  const continueEditingRef = useRef<View>(null)
  const deleteTriggerRef = useRef<View>(null)
  const cancelDeleteRef = useRef<View>(null)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarDraft, setAvatarDraft] = useState<Blob | null>(null)
  const [restoreOwnerAvatar, setRestoreOwnerAvatar] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [projectionPending, setProjectionPending] = useState(false)
  const inFlight = useRef(false)
  const form = useRef<DesktopAgentWorkspaceFormHandle>(null)
  const submittedDraft = useRef<DesktopAgentWorkspaceDraft | null>(null)
  const committedResult = useRef<DesktopAgentSaveResult | null>(null)
  const isCurrent = useCallback(
    () => active.current && useAuthStore.getState().user?.id === accountId,
    [accountId],
  )
  const controller = useMemo(
    () =>
      createDesktopAgentSaveController({
        isCurrent,
        operationId: () => crypto.randomUUID(),
        save: saveDesktopAgent,
      }),
    [isCurrent],
  )
  useEffect(() => {
    active.current = true
    controller.start()
    const unsubscribe = useAuthStore.subscribe((state) => {
      if (state.user?.id !== accountId) {
        active.current = false
        controller.stop()
      }
    })
    return () => {
      active.current = false
      controller.stop()
      unsubscribe()
    }
  }, [controller, accountId])
  const onDraftChange = useCallback((value: DesktopAgentWorkspaceDraft, complete: boolean) => {
    setDraft(value)
    setCanSubmit(complete)
  }, [])
  const leave = () => {
    if (busy || avatarBusy || deleting) return
    if (router.canGoBack()) router.back()
    else router.replace(desktopAgentEditorFallback({ agentId: initial?.id, returnTo, roomId }))
  }
  const hasUnsavedChanges = Boolean(avatarDraft || restoreOwnerAvatar || (draft && (
    initial ? desktopAgentDraftSignature(draft) !== savedSignature : userEdited
  )))
  useEffect(() => {
    if (!focused || !hasUnsavedChanges) return
    const preventUnload = (event: BeforeUnloadEvent) => {
      if (!isCurrent() || savedNavigation.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', preventUnload)
    return () => window.removeEventListener('beforeunload', preventUnload)
  }, [focused, hasUnsavedChanges, isCurrent])
  useEffect(() => {
    if (!focused) return
    return desktopNavigationGuard.register((next) => {
      if (!isCurrent()) { next(); return }
      if (busy || avatarBusy || deleting) return
      if (!hasUnsavedChanges) { next(); return }
      pendingLeave.current = next
      setConfirmingLeave(true)
    })
  }, [focused, hasUnsavedChanges, busy, avatarBusy, deleting, isCurrent])
  usePreventRemove(hasUnsavedChanges || busy || avatarBusy || deleting, ({ data }) => {
    if (!isCurrent() || savedNavigation.current) {
      navigation.dispatch(data.action)
      return
    }
    if (busy || avatarBusy || deleting) return
    // React Navigation marks this exact action as already confirmed for this
    // route when it is dispatched again. Keep its destination, not a guessed Back.
    pendingLeave.current = () => navigation.dispatch(data.action)
    setConfirmingLeave(true)
  })
  const cancelLeave = () => {
    pendingLeave.current = null
    setConfirmingLeave(false)
  }
  const discardAndLeave = () => {
    if (busy || avatarBusy || deleting || !isCurrent()) return
    const next = pendingLeave.current
    pendingLeave.current = null
    setConfirmingLeave(false)
    savedNavigation.current = true
    next?.()
  }
  const back = leave
  useEscapeKey(focused && !confirmingLeave && !confirmingDelete, back)
  useKeyboardShortcut({ key: 'escape', allowEditable: true, ignoreWidgets: true }, focused && !confirmingLeave && !confirmingDelete, back)
  const deleteAgent = async () => {
    if (!initial || deleting || busy || avatarBusy || !isCurrent()) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await desktopAgentPort.deleteAgent(initial.id)
      if (!isCurrent()) return
      savedNavigation.current = true
      setConfirmingDelete(false)
      router.replace('/(main)/agents')
    } catch (error) {
      if (!isCurrent()) return
      if (__DEV__) console.warn('[desktop-agent-editor] delete failed', error)
      setDeleteError(t('agents_delete_failed'))
    } finally {
      if (isCurrent()) setDeleting(false)
    }
  }
  const submit = async () => {
    if (inFlight.current || avatarBusy || uncertain || !isCurrent()) return
    inFlight.current = true
    try {
      const prepared = projectionPending
        ? submittedDraft.current
        : await form.current?.prepareSubmit()
      if (!prepared || !isCurrent()) return
      submittedDraft.current = prepared
      setBusy(true)
      setMessage(null)
      setFailed(false)
      const outcome = await runDesktopAgentSubmit({
        agentId: initial?.id,
        draft: prepared,
        savedSignature,
        avatar: { draft: avatarDraft, restoreOwner: restoreOwnerAvatar },
        committed: committedResult.current,
        projectionPending,
        isCurrent,
        commitConfig: () => controller.submit(prepared, initial?.id),
        onConfigCommitted: async (committedConfig) => {
          committedResult.current = committedConfig
          if (initial) {
            let committed: AgentWorkspace | null | undefined
            try {
              committed = await desktopAgentPort.getAgent(committedConfig.agentId)
            } catch {
              throw new Error('agent_projection_pending')
            }
            if (!isCurrent()) return false
            if (!committed || committed.id !== committedConfig.agentId)
              throw new Error('agent_projection_pending')
            const baseline = desktopAgentWorkspaceToDraft(committed)
            if (!baseline) throw new Error('agent_projection_pending')
            setFormInitial(committed)
            setDraft(baseline)
            setSavedSignature(desktopAgentDraftSignature(baseline))
            setFormEpoch((epoch) => epoch + 1)
          } else setSavedSignature(desktopAgentDraftSignature(prepared))
          setProjectionPending(false)
          return true
        },
        uploadAvatar: (agentId, image) => uploadDesktopAgentAvatar(agentId, image, isCurrent),
        removeAvatar: removeDesktopAgentAvatar,
        reconcile: () => desktopAccountActions.reconcile(),
      })
      if (outcome.status === 'stale') return
      if (outcome.status === 'avatar_failed') {
        // Any configuration is already committed. Keep its result and retry only the staged avatar action.
        setFailed(true)
        setMessage(t('agents_avatar_save_failed'))
        return
      }
      const result = outcome.result
      committedResult.current = null
      setAvatarDraft(null)
      setRestoreOwnerAvatar(false)
      setMessage(
        t(result.requiresRestart ? 'agents_saved_restarting_conversations' : 'agents_saved'),
      )
      if (initial) {
        if (returnAfterSave === '1') {
          savedNavigation.current = true
          if (router.canGoBack()) router.back()
          else router.replace(desktopAgentEditorFallback({ agentId: initial.id, returnTo, roomId }))
        }
        else void onRefresh?.()
        return
      }
      savedNavigation.current = true
      if (returnTo === 'room-agent-add' && roomId)
        router.dismissTo({
          pathname: '/(main)/spaces/agent-add',
          params: { roomId, createdAgentId: result.agentId },
        })
      else router.replace(`/(main)/agents/${result.agentId}`)
    } catch (error) {
      if (!isCurrent()) return
      const reason = error instanceof Error ? error.message : ''
      const pending = reason === 'agent_projection_pending'
      const unknown = reason === 'agent_save_uncertain' || !reason.startsWith('agent_')
      setProjectionPending(pending)
      setUncertain(unknown)
      setFailed(true)
      setMessage(
        t(
          unknown
            ? 'agents_save_result_unknown'
            : pending
              ? 'agents_save_projection_pending'
              : reason.startsWith('agent_validation_failed:')
                ? agentValidationMessageKey(reason.slice('agent_validation_failed:'.length))
                : 'agents_save_failed',
        ),
      )
    } finally {
      inFlight.current = false
      if (isCurrent()) setBusy(false)
    }
  }
  const dirty =
    !initial ||
    Boolean(
      avatarDraft ||
      restoreOwnerAvatar ||
      (draft && desktopAgentDraftSignature(draft) !== savedSignature),
    )
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View
        {...{ dataSet: { desktopDrag: 'true' } }}
        style={{
          paddingHorizontal: 12,
          minHeight: desktopControlMetrics.headerHeight,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <View>
          <DesktopMachineAction compact label={t('back')} onPress={back} disabled={busy || avatarBusy || deleting} />
        </View>
        <Text
          accessibilityRole="header"
          style={{ flex: 1, color: colors.text, ...desktopTypography.windowTitle }}
        >
          {t(initial ? 'agents_edit' : 'agents_create')}
        </Text>
        {dirty || projectionPending ? (
          <View>
            <DesktopMachineAction
              compact
              label={t(
                projectionPending ? 'retry' : initial ? 'agents_save' : 'agents_create_action',
              )}
              disabled={busy || avatarBusy || deleting || !canSubmit || uncertain}
              onPress={() => void submit()}
            />
          </View>
        ) : null}
      </View>
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 44 }}>
        {busy ? (
          <Text accessibilityRole="progressbar" style={{ color: colors.textSecondary }}>
            {t('agents_checking_and_saving')}
          </Text>
        ) : null}
        {message ? (
          <Text
            accessibilityRole={failed ? 'alert' : undefined}
            style={{ color: failed ? colors.error : colors.textSecondary, marginBottom: 16 }}
          >
            {message}
          </Text>
        ) : null}
        <DesktopAgentWorkspaceForm
          key={formEpoch}
          ref={form}
          initial={formInitial}
          busy={busy || avatarBusy || deleting || projectionPending || uncertain}
          onDraftChange={onDraftChange}
          onUserEdit={() => setUserEdited(true)}
          profileAccessory={
            <DesktopAgentAvatarEditor
              accountId={accountId}
              agent={initial}
              name={draft?.displayName ?? ''}
              draft={avatarDraft}
              restoreOwnerDraft={restoreOwnerAvatar}
              disabled={busy || projectionPending || uncertain}
              onDraft={(image) => {
                setAvatarDraft(image)
                setRestoreOwnerAvatar(false)
              }}
              onRestoreOwnerDraft={() => {
                setAvatarDraft(null)
                setRestoreOwnerAvatar(true)
              }}
              onBusy={setAvatarBusy}
            />
          }
        />
        {initial ? (
          <View
            style={{
              marginTop: 32,
              paddingTop: 20,
              borderTopWidth: 1,
              borderTopColor: colors.border,
              alignItems: 'center',
            }}
          >
            <DesktopMachineAction
              actionRef={deleteTriggerRef}
              label={t('agents_delete')}
              destructive
              disabled={busy || avatarBusy || deleting}
              onPress={() => {
                setDeleteError(null)
                setConfirmingDelete(true)
              }}
            />
          </View>
        ) : null}
      </ScrollView>
      {confirmingLeave ? (
        <DesktopDialog title={t('agents_unsaved_message')} onClose={cancelLeave} initialFocusRef={continueEditingRef}>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <DesktopMachineAction compact actionRef={continueEditingRef} label={t('agents_continue_editing')} onPress={cancelLeave} />
            <DesktopMachineAction compact destructive label={t('agents_discard_changes')} onPress={discardAndLeave} />
          </View>
        </DesktopDialog>
      ) : null}
      {confirmingDelete && initial ? (
        <DesktopDialog
          title={t('agents_delete_title', { name: initial.displayName })}
          onClose={() => {
            if (!deleting) setConfirmingDelete(false)
          }}
          initialFocusRef={cancelDeleteRef}
          returnFocusRef={deleteTriggerRef}
          busy={deleting}
        >
          <Text style={{ color: colors.textSecondary }}>{t('agents_delete_confirm')}</Text>
          {deleteError ? (
            <Text accessibilityRole="alert" style={{ color: colors.error, marginTop: 12 }}>
              {deleteError}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <DesktopMachineAction
              compact
              actionRef={cancelDeleteRef}
              label={t('cancel')}
              disabled={deleting}
              onPress={() => setConfirmingDelete(false)}
            />
            <DesktopMachineAction
              compact
              destructive
              label={t('agents_delete')}
              disabled={deleting}
              onPress={() => void deleteAgent()}
            />
          </View>
        </DesktopDialog>
      ) : null}
    </View>
  )
}
