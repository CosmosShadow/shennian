// @arch docs/features/desktop-settings-information-architecture.md
// @arch docs/design/desktop/unified-desktop-control.md#设置页面
// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test ../../__tests__/desktop-profile-actions.test.ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { getDesktopCredentialBridge, useAuthStore } from '../../config/auth'
import { persistWebLanguagePreference } from '../../config/i18n'
import { useTheme } from '../../hooks/useTheme'
import { getDesktopSettingsReturnLocation } from '../../utils/desktopSettingsNavigation'
import { hasUnsavedDesktopTextSetting } from '../../utils/desktopSettingsLeaveGuard'
import type { ProfileDevice } from '../account/profileAccountClient.types'
import { useRelativeTime } from '../profile/profileUtils'
import { resolveProfileAvatarUrl } from '../profile/profileAvatar'
import { getApiBaseUrl } from '../../config/api'
import { DesktopSettingsLeaveDialog } from '../profile/components/DesktopSettingsLeaveDialog'
import { DesktopProfileSettings } from './DesktopProfileSettings'
import { DesktopProfileIdentity } from './DesktopProfileIdentity'
import { DesktopProfileAccount } from './DesktopProfileAccount'
import { DesktopProfileDevices } from './DesktopProfileDevicesSection'
import { DesktopMachineSettings } from './DesktopMachineSettings'
import {
  createDesktopProfileActions,
  type DesktopProfileActionState,
} from './desktopProfileActions'
import { pickDesktopProfileAvatar } from './desktopProfileAvatar'
import { useDesktopSettingsSystem } from './useDesktopSettingsSystem'
import { useDesktopProfileDevices } from './useDesktopProfileDevices'
import { saveDesktopSettingsBeforeLeave } from './desktopSettingsSaveBeforeLeave'
import { DesktopProfileAvatarButton } from './DesktopProfileAvatarButton'
import { DesktopDeviceRevokeDialog } from './DesktopDeviceRevokeDialog'
import {
  focusDesktopNicknameEditTrigger,
  focusDesktopSettingsTarget,
  resolveDesktopAccountFocusTarget,
  type DesktopAccountConfirmation,
} from './desktopSettingsFocus'
import { desktopSettingsAccountPort } from './desktopSettingsAccountPort'

export default function DesktopProfileScreen() {
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return accountId ? <DesktopAccountSettings key={accountId} accountId={accountId} /> : null
}

function DesktopAccountSettings({ accountId }: { accountId: string }) {
  const user = useAuthStore((state) => state.user)
  const { t, i18n } = useTranslation()
  const router = useRouter()
  const { colors, mode, setTheme } = useTheme()
  const relativeTime = useRelativeTime()
  const devices = useDesktopProfileDevices()
  const system = useDesktopSettingsSystem()
  const active = useRef(false)
  const [actionState, setActionState] = useState<DesktopProfileActionState>({
    busy: null,
    error: null,
  })
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const nicknameWasEditing = useRef(false)
  const nicknameTriggerRef = useRef<View>(null)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const avatarRequest = useRef<AbortController | null>(null)
  const [confirmingLogout, setConfirmingLogout] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [confirmingDevice, setConfirmingDevice] = useState<ProfileDevice | null>(null)
  const previousAccountConfirmation = useRef<DesktopAccountConfirmation>(null)
  const accountConfirmationRef = useRef<View>(null)
  const accountDeleteProgressRef = useRef<View>(null)
  const accountDeleteTriggerRef = useRef<View>(null)
  const accountLogoutTriggerRef = useRef<View>(null)
  const [confirmingLeave, setConfirmingLeave] = useState(false)
  const pendingLeave = useRef<(() => void) | null>(null)
  const isCurrent = useCallback(
    () => active.current && useAuthStore.getState().user?.id === accountId,
    [accountId],
  )
  const actions = useMemo(
    () =>
      createDesktopProfileActions({
        accountId,
        isCurrent,
        client: desktopSettingsAccountPort,
        onState: setActionState,
        operationId: () => crypto.randomUUID(),
        logout: async (id) => {
          const bridge = getDesktopCredentialBridge()
          if (!bridge) throw new Error('Desktop credential bridge is unavailable')
          const result = await bridge.logout({ accountId: id })
          if (!result.ok) throw new Error(result.error.message)
        },
      }),
    [accountId, isCurrent],
  )
  useEffect(() => {
    active.current = true
    actions.start()
    const unsubscribe = useAuthStore.subscribe((state) => {
      if (state.user?.id !== accountId) {
        active.current = false
        actions.stop()
        avatarRequest.current?.abort()
      }
    })
    // Main auth restoration/profile-updated events already own the user projection.
    return () => {
      active.current = false
      actions.stop()
      avatarRequest.current?.abort()
      unsubscribe()
    }
  }, [accountId, actions])
  useEffect(() => {
    const shouldRestoreFocus = nicknameWasEditing.current && !editing
    nicknameWasEditing.current = editing
    if (!shouldRestoreFocus || typeof document === 'undefined') return
    const frame = requestAnimationFrame(() => {
      focusDesktopNicknameEditTrigger(nicknameTriggerRef.current)
    })
    return () => cancelAnimationFrame(frame)
  }, [editing])
  const accountDeleting = actionState.busy === 'delete'
  useEffect(() => {
    const confirmation: DesktopAccountConfirmation = confirmingDelete
      ? 'delete'
      : confirmingLogout
        ? 'logout'
        : null
    const previous = previousAccountConfirmation.current
    previousAccountConfirmation.current = confirmation
    if (typeof document === 'undefined') return
    const target = resolveDesktopAccountFocusTarget(previous, confirmation, accountDeleting)
    const targetRef = target === 'confirmation'
      ? accountConfirmationRef
      : target === 'delete-progress'
        ? accountDeleteProgressRef
        : target === 'delete-trigger'
          ? accountDeleteTriggerRef
          : target === 'logout-trigger'
            ? accountLogoutTriggerRef
            : null
    if (!targetRef) return
    const frame = requestAnimationFrame(() => focusDesktopSettingsTarget(targetRef.current))
    return () => cancelAnimationFrame(frame)
  }, [accountDeleting, confirmingDelete, confirmingLogout])
  const busy = actionState.busy !== null || avatarBusy
  const dirty = hasUnsavedDesktopTextSetting(editing, draft, user?.name ?? '')
  const requestLeave = (next: () => void) => {
    if (busy || !isCurrent()) return
    if (dirty) {
      pendingLeave.current = next
      setConfirmingLeave(true)
    } else next()
  }
  const back = () => requestLeave(() => router.replace(getDesktopSettingsReturnLocation() as never))
  const cancelEdit = () => {
    if (!busy) {
      setDraft(user?.name ?? '')
      setEditing(false)
    }
  }
  const saveNickname = async () => {
    if (await actions.saveNickname(draft)) {
      setEditing(false)
      return true
    }
    return false
  }
  const finishLeave = () => {
    if (!isCurrent()) return
    const next = pendingLeave.current
    pendingLeave.current = null
    setConfirmingLeave(false)
    next?.()
  }
  const escape = () => {
    if (busy) return
    if (confirmingLeave) {
      pendingLeave.current = null
      setConfirmingLeave(false)
    } else if (confirmingDevice) setConfirmingDevice(null)
    else if (confirmingDelete) setConfirmingDelete(false)
    else if (confirmingLogout) setConfirmingLogout(false)
    else back()
  }
  const chooseAvatar = async () => {
    if (busy || avatarRequest.current || !isCurrent()) return
    const request = new AbortController()
    avatarRequest.current = request
    setAvatarBusy(true)
    setError(null)
    try {
      const image = await pickDesktopProfileAvatar(request.signal)
      if (image && isCurrent() && !request.signal.aborted) await actions.saveAvatar(image)
    } catch (cause) {
      if (isCurrent() && !request.signal.aborted)
        setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (avatarRequest.current === request) avatarRequest.current = null
      if (isCurrent()) setAvatarBusy(false)
    }
  }
  const ds = {
    card: { backgroundColor: colors.surface, borderColor: colors.border },
    settingsGroup: { backgroundColor: colors.bg },
    rowLabel: { color: colors.text },
    rowValue: { color: colors.textTertiary },
    deviceRow: { borderTopColor: colors.border },
    deviceName: { color: colors.text },
    deviceTime: { color: colors.textTertiary },
    revokeText: { color: colors.error },
    logoutText: { color: colors.error },
    deleteAccountText: { color: colors.error },
    currentBadge: { backgroundColor: colors.surfaceHover },
    currentText: { color: colors.textSecondary },
  }
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {error || actionState.error || system.error ? (
        <Text accessibilityRole="alert" style={{ color: colors.error, padding: 12 }}>
          {error ?? actionState.error ?? system.error}
        </Text>
      ) : null}
      <DesktopProfileSettings logoutTriggerRef={accountLogoutTriggerRef}
        onLogout={() => requestLeave(() => { setConfirmingDelete(false); setConfirmingLogout(true) })}
        onBack={back}
        onEscape={escape}
        onRequestCategoryChange={requestLeave}
        colors={colors}
        currentTheme={mode}
        currentLanguage={i18n.language === 'zh' ? 'zh' : 'en'}
        onSelectTheme={setTheme}
        onSelectLanguage={(next) => {
          void i18n.changeLanguage(next)
          persistWebLanguagePreference(next)
        }}
        identity={
          <DesktopProfileIdentity
            nickname={user?.name ?? ''}
            nicknameDraft={draft}
            nicknameEditing={editing}
            nicknameSaving={busy}
            nicknameDirty={dirty}
            nicknameTriggerRef={nicknameTriggerRef}
            colors={colors}
            t={t}
            onStartNicknameEdit={() => {
              if (!busy) {
                setDraft(user?.name ?? '')
                setEditing(true)
              }
            }}
            onCancelNicknameEdit={cancelEdit}
            onChangeNicknameDraft={setDraft}
            onSaveNickname={() => {
              void saveNickname()
            }}
            avatar={
              <DesktopProfileAvatarButton
                label={t('profile_avatar_choose')}
                busy={busy}
                onPress={() => void chooseAvatar()}
                uri={
                  user?.avatar
                    ? resolveProfileAvatarUrl(
                        user.avatar.mediumUrl,
                        getApiBaseUrl(),
                        user.avatar.version,
                      )
                    : undefined
                }
                initial={(user?.name.trim().slice(0, 1) || '?').toUpperCase()}
              />
            }
          />
        }
        account={
          <DesktopProfileAccount
            colors={colors}
            ds={ds}
            iconColor={colors.textSecondary}
            t={t}
            phone={user?.phone}
            busy={busy}
            accountDeleting={accountDeleting}
            confirmationRef={accountConfirmationRef}
            deleteProgressRef={accountDeleteProgressRef}
            deleteTriggerRef={accountDeleteTriggerRef}
            logoutTriggerRef={accountLogoutTriggerRef}
            confirmingDeleteAccount={confirmingDelete}
            confirmingLogout={confirmingLogout}
            setConfirmingDeleteAccount={setConfirmingDelete}
            setConfirmingLogout={setConfirmingLogout}
            onRequestLogout={() =>
              requestLeave(() => {
                setConfirmingDelete(false)
                setConfirmingLogout(true)
              })
            }
            onRequestDeleteAccount={() =>
              requestLeave(() => {
                setConfirmingLogout(false)
                setConfirmingDelete(true)
              })
            }
            onConfirmLogout={() => {
              void actions.logout()
            }}
            onConfirmDeleteAccount={() => {
              void actions.deleteAccount()
            }}
          />
        }
        devices={
          <DesktopProfileDevices
            colors={colors}
            ds={ds}
            iconColor={colors.textSecondary}
            t={t}
            devices={devices.devices}
            devicesLoaded={devices.loaded}
            devicesLoading={devices.refreshing}
            devicesFailed={Boolean(devices.error)}
            retryDevices={devices.refresh}
            relativeTime={relativeTime}
            revoking={actionState.busy?.startsWith('revoke:') ? actionState.busy.slice(7) : null}
            confirmRevoke={(device) => {
              if (!busy && !device.current) setConfirmingDevice(device)
            }}
          />
        }
        machines={<DesktopMachineSettings />}
        notifications={system.notifications}
        systemSettings={system.systemSettings}
        logs={system.logs}
        version={{
          ...system.version,
          onRequestRestart: () => requestLeave(system.version.onRequestRestart),
          onConfirmRestart: () => requestLeave(system.version.onConfirmRestart),
        }}
      />
      <DesktopSettingsLeaveDialog
        visible={confirmingLeave}
        saving={busy}
        onContinue={() => {
          pendingLeave.current = null
          setConfirmingLeave(false)
        }}
        onDiscard={() => {
          cancelEdit()
          finishLeave()
        }}
        onSave={() => {
          void saveDesktopSettingsBeforeLeave(saveNickname, isCurrent, finishLeave)
        }}
      />
      <DesktopDeviceRevokeDialog
        device={confirmingDevice}
        busy={busy}
        onCancel={() => {
          if (!busy) setConfirmingDevice(null)
        }}
        onConfirm={() => {
          const selected = confirmingDevice
          const current = selected
            ? devices.devices.find((device) => device.id === selected.id)
            : null
          if (!selected || !current || current.current || busy) {
            setConfirmingDevice(null)
            return
          }
          setConfirmingDevice(null)
          void actions.revokeDevice(selected.id)
        }}
      />
    </View>
  )
}
