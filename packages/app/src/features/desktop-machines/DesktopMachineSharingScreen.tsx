// @arch docs/design/desktop/unified-desktop-control.md#页面清单与交互矩阵
// @test ../../__tests__/desktop-machine-sharing.test.ts

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useMachinesStore } from '@shennian/shared'
import type { Machine, MachineGrant } from '@shennian/wire'
import { useAuthStore } from '../../config/auth'
import { useTheme } from '../../hooks/useTheme'
import { DesktopDialog } from '../desktop-shell/DesktopDialog'
import { DESKTOP_WORKSPACE_HEADER_HEIGHT } from '../desktop-shell/desktopWorkspaceMetrics'
import { desktopControlMetrics, desktopTypography } from '../desktop-shell/desktopDesignTokens'
import { DesktopComposerIconButton } from '../desktop-chat/DesktopComposerIconButton'
import { DesktopMachineAction } from './DesktopMachineAction'
import { desktopMachineSharingClient } from './desktopMachineSharingClient'
import {
  DesktopMachineSharingModel,
  type DesktopMachineSharingState,
} from './desktopMachineSharingModel'
import { useDesktopMachineListModel } from './useDesktopMachineListModel'

type Expiry = '1d' | '7d' | '30d' | 'forever'
const EXPIRY_DAYS: Record<Expiry, number | null> = { '1d': 1, '7d': 7, '30d': 30, forever: null }
const EXPIRY_VALUES: Expiry[] = ['1d', '7d', '30d', 'forever']

function ExpiryChoices({ value, disabled, onChange }: { value: Expiry; disabled: boolean; onChange(value: Expiry): void }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const root = useRef<View>(null)
  const [focused, setFocused] = useState<Expiry | null>(null)
  return <View ref={root} accessibilityRole="radiogroup" accessibilityLabel={t('expiry')} style={styles.expiryRow}
    {...{ onKeyDown: (event: KeyboardEvent) => {
      const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
      if (!direction && event.key !== 'Home' && event.key !== 'End') return
      event.preventDefault()
      event.stopPropagation()
      if (disabled) return
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? EXPIRY_VALUES.length - 1 : (EXPIRY_VALUES.indexOf(value) + direction + EXPIRY_VALUES.length) % EXPIRY_VALUES.length
      onChange(EXPIRY_VALUES[next])
      ;(root.current as unknown as HTMLElement | null)?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus()
    } }}>
    {EXPIRY_VALUES.map(option => <Pressable key={option} accessibilityRole="radio" accessibilityLabel={t(`expiry_${option}`)}
      accessibilityState={{ checked: option === value, disabled }} aria-checked={option === value} aria-disabled={disabled}
      tabIndex={option === value ? 0 : -1} disabled={disabled} onPress={() => onChange(option)}
      onFocus={() => setFocused(option)} onBlur={() => setFocused(null)}
      style={({ pressed }) => [styles.expiryChoice, { borderColor: focused === option || option === value ? colors.brand : colors.border,
        backgroundColor: option === value ? colors.brandLight : pressed ? colors.surfaceHover : colors.bg, opacity: disabled ? 0.5 : 1 }]}>
      <Text style={[desktopTypography.control, { color: colors.text }]}>{t(`expiry_${option}`)}</Text>
      {option === value ? <Ionicons name="checkmark" size={16} color={colors.brand} /> : null}
    </Pressable>)}
  </View>
}
export default function DesktopMachineSharingScreen({ machineIdOverride, onBack }: { machineIdOverride?: string; onBack?: () => void } = {}) {
  const { machineId: routeMachineId = '' } = useLocalSearchParams<{ machineId: string }>()
  const machineId = machineIdOverride ?? routeMachineId
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  const inventory = useDesktopMachineListModel()
  const machine = inventory.machines.find((item) => item.id === machineId)
  const owner = machine?.role === 'owner'
  const surface =
    !accountId || inventory.surface === 'forbidden'
      ? 'forbidden'
      : !machine &&
          (inventory.surface === 'initial-loading' ||
            inventory.surface === 'offline' ||
            inventory.surface === 'error')
        ? 'loading'
        : !machine
          ? 'missing'
          : owner
            ? 'owner'
            : 'forbidden'

  if (surface !== 'owner' || !accountId || !machine) {
    return <DesktopSharingBoundary surface={surface} onRetry={inventory.retry} onBack={onBack} />
  }
  return (
    <DesktopMachineSharingWorkspace
      key={`${accountId}:${machine.id}`}
      accountId={accountId}
      machine={machine}
      onBack={onBack}
    />
  )
}

function DesktopMachineSharingWorkspace({
  accountId,
  machine,
  onBack,
}: {
  onBack?: () => void
  accountId: string
  machine: Machine
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const model = useMemo(
    () =>
      new DesktopMachineSharingModel({
        accountId,
        machineId: machine.id,
        currentAccount: () => useAuthStore.getState().user?.id ?? null,
        isOwner: () =>
          useMachinesStore
            .getState()
            .machines.some((item) => item.id === machine.id && item.role === 'owner'),
        client: desktopMachineSharingClient,
      }),
    [accountId, machine.id],
  )
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [expiry, setExpiry] = useState<Expiry>('7d')
  const [revokeGrant, setRevokeGrant] = useState<MachineGrant | null>(null)

  useEffect(() => model.start(), [model])
  const now = Date.now()
  const current = state.grants.filter(
    (item) => !item.revokedAt && (!item.expiresAt || Date.parse(item.expiresAt) > now),
  )
  const active = current.filter((item) => item.redeemed)
  const pending = current.filter((item) => !item.redeemed)
  const openInvite = () => {
    model.clearFailure()
    model.clearInvite()
    setExpiry('7d')
    setInviteOpen(true)
  }
  const closeInvite = () => {
    if (!state.busy) {
      setInviteOpen(false)
      model.clearInvite()
      model.clearFailure()
    }
  }
  const create = () => {
    const days = EXPIRY_DAYS[expiry]
    const expiresAt =
      days === null ? undefined : new Date(Date.now() + days * 86_400_000).toISOString()
    void model.create(expiresAt)
  }

  return (
    <View testID="desktop-machine-sharing" style={[styles.root, { backgroundColor: colors.bg }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]} {...{ dataSet: { desktopDrag: 'true' } }}>
        <View style={styles.headerInner}>
          <DesktopComposerIconButton icon="arrow-left" colors={colors}
            accessibilityLabel={`${t('back')} · ${machine.name}`}
            onPress={onBack ?? (() => router.replace({ pathname: '/(main)/machine/[machineId]', params: { machineId: machine.id, returnFocus: 'sharing' } }))} />
          <View style={styles.headerCopy}>
            <Text
              accessibilityRole="header"
              numberOfLines={1}
              style={[styles.title, { color: colors.text }]}
            >
              {t('machine_share_page_title')} · {machine.name}
            </Text>
          </View>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View
          style={[styles.riskCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Ionicons name="shield-checkmark-outline" size={22} color={colors.warning} />
          <Text style={[styles.riskText, { color: colors.textSecondary }]}>
            {t('machine_share_risk')}
          </Text>
        </View>
        <DesktopMachineAction
          compact
          primary
          label={t('machine_share_invite_use')}
          onPress={openInvite}
          disabled={Boolean(state.busy)}
        />
        {state.loading ? (
          <View accessibilityRole="progressbar" style={styles.loading}>
            <ActivityIndicator color={colors.brand} />
            <Text style={{ color: colors.textSecondary }}>{t('machines_loading')}</Text>
          </View>
        ) : null}
        {!state.loading && state.failure && state.grants.length === 0 ? (
          <View
            accessibilityRole="alert"
            style={[styles.stateCard, { borderColor: colors.border }]}
          >
            <Text style={{ color: colors.error }}>{state.failure}</Text>
            <DesktopMachineAction compact label={t('retry')} onPress={() => void model.reload()} />
          </View>
        ) : null}
        {!state.loading && (state.grants.length > 0 || !state.failure) ? (
          <>
            <GrantSection
              title={t('machine_share_people_title')}
              empty={t('machine_share_people_empty')}
              grants={active}
              busy={state.busy}
              onRevoke={setRevokeGrant}
            />
            <GrantSection
              title={t('machine_share_pending_title')}
              empty={t('machine_share_pending_empty')}
              grants={pending}
              busy={state.busy}
              onRevoke={setRevokeGrant}
            />
          </>
        ) : null}
        {state.failure && state.grants.length > 0 ? (
          <Text accessibilityRole="alert" style={{ color: colors.error }}>
            {state.failure}
          </Text>
        ) : null}
      </ScrollView>
      <InviteDialog
        visible={inviteOpen}
        machine={machine}
        state={state}
        expiry={expiry}
        onExpiry={setExpiry}
        onCreate={create}
        onClose={closeInvite}
      />
      <RevokeDialog
        machine={machine}
        grant={revokeGrant}
        busy={Boolean(state.busy)}
        failure={state.failure}
        onClose={() => {
          if (!state.busy) {
            setRevokeGrant(null)
            model.clearFailure()
          }
        }}
        onConfirm={() =>
          revokeGrant &&
          void model.revoke(revokeGrant.id).then((ok) => {
            if (ok) setRevokeGrant(null)
          })
        }
      />
    </View>
  )
}

function DesktopSharingBoundary({
  surface,
  onRetry,
  onBack,
}: {
  surface: string
  onBack?: () => void
  onRetry(): Promise<void>
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const loading = surface === 'loading'
  return (
    <View
      testID={`desktop-machine-sharing-${surface}`}
      style={[styles.root, styles.center, { backgroundColor: colors.bg }]}
    >
      {loading ? (
        <ActivityIndicator color={colors.brand} />
      ) : (
        <Ionicons
          name={surface === 'missing' ? 'desktop-outline' : 'lock-closed-outline'}
          size={28}
          color={colors.textTertiary}
        />
      )}
      <Text style={[styles.boundaryText, { color: colors.textSecondary }]}>
        {loading
          ? t('machines_loading')
          : t(surface === 'missing' ? 'machine_not_found' : 'machine_share_owner_only')}
      </Text>
      {loading ? (
        <DesktopMachineAction compact label={t('retry')} onPress={() => void onRetry()} />
      ) : null}
      {!loading ? (
        <DesktopMachineAction
          compact
          label={t('go_manage_machines')}
          onPress={onBack ?? (() => router.replace('/(main)/machines'))}
        />
      ) : null}
    </View>
  )
}

function GrantSection({
  title,
  empty,
  grants,
  busy,
  onRevoke,
}: {
  title: string
  empty: string
  grants: MachineGrant[]
  busy: string | null
  onRevoke(grant: MachineGrant): void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
      <View style={[styles.list, { borderColor: colors.border }]}>
        {!grants.length ? (
          <Text style={[styles.empty, { color: colors.textSecondary }]}>{empty}</Text>
        ) : (
          grants.map((grant) => (
            <View key={grant.id} style={[styles.row, { borderBottomColor: colors.border }]}>
              <View style={[styles.avatar, { backgroundColor: colors.surfaceHover }]}>
                <Ionicons
                  name={grant.redeemed ? 'person-outline' : 'time-outline'}
                  size={18}
                  color={colors.textSecondary}
                />
              </View>
              <View style={styles.rowCopy}>
                <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text }]}>
                  {grant.redeemed
                    ? grant.granteeName || t('organization_member_unnamed')
                    : t('machine_share_waiting_accept')}
                </Text>
                <Text style={[styles.rowMeta, { color: colors.textSecondary }]}>
                  {grant.expiresAt
                    ? t('machine_share_expires_at', {
                        date: new Date(grant.expiresAt).toLocaleDateString(),
                      })
                    : t('machine_share_never_expires')}
                </Text>
              </View>
              <DesktopMachineAction
                compact
                destructive
                disabled={Boolean(busy)}
                label={t(grant.redeemed ? 'revoke' : 'cancel_invite')}
                onPress={() => onRevoke(grant)}
              />
            </View>
          ))
        )}
      </View>
    </View>
  )
}

function InviteDialog({
  visible,
  machine,
  state,
  expiry,
  onExpiry,
  onCreate,
  onClose,
}: {
  visible: boolean
  machine: Machine
  state: DesktopMachineSharingState
  expiry: Expiry
  onExpiry(value: Expiry): void
  onCreate(): void
  onClose(): void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const closeRef = useRef<View>(null)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  useEffect(() => {
    if (!visible || !state.invite) {
      setCopied(false)
      setCopyFailed(false)
    }
  }, [state.invite, visible])
  if (!visible) return null
  return (
    <DesktopDialog title={`${t('machine_share_invite_use')} · ${machine.name}`} initialFocusRef={closeRef}
      busy={Boolean(state.busy)} onClose={() => { if (!state.busy) onClose() }}>
        <View style={styles.dialogBodyStack}>
          <Text style={[styles.dialogBody, { color: colors.textSecondary }]}>
            {t('machine_share_risk')}
          </Text>
          {state.invite ? (
            <>
              <TextInput
                accessibilityLabel={t('copy_link')}
                editable={false}
                selectTextOnFocus
                value={state.invite.inviteUrl}
                style={[
                  styles.linkField,
                  {
                    color: colors.text,
                    borderColor: colors.border,
                    backgroundColor: colors.surface,
                  },
                ]}
              />
              <DesktopMachineAction
                compact
                label={t(copied ? 'copied' : 'copy_link')}
                onPress={() => {
                  setCopied(false)
                  setCopyFailed(false)
                  void navigator.clipboard
                    .writeText(state.invite!.inviteUrl)
                    .then(() => setCopied(true))
                    .catch(() => setCopyFailed(true))
                }}
              />
            </>
          ) : (
            <>
              <Text style={[styles.label, { color: colors.text }]}>{t('expiry')}</Text>
              <ExpiryChoices value={expiry} disabled={Boolean(state.busy)} onChange={onExpiry} />
            </>
          )}
          {state.failure || copyFailed ? (
            <Text accessibilityRole="alert" style={{ color: colors.error }}>
              {state.failure || t('machine_share_action_failed')}
            </Text>
          ) : null}
          <View style={styles.dialogActions}>
            <DesktopMachineAction
              actionRef={closeRef}
              compact
              label={t('close')}
              onPress={onClose}
              disabled={Boolean(state.busy)}
            />
            {!state.invite ? (
              <DesktopMachineAction
                compact
                primary
                label={t('machine_share_generate_link')}
                onPress={onCreate}
                disabled={Boolean(state.busy)}
              />
            ) : null}
          </View>
        </View>
    </DesktopDialog>
  )
}

function RevokeDialog({
  machine,
  grant,
  busy,
  failure,
  onClose,
  onConfirm,
}: {
  machine: Machine
  grant: MachineGrant | null
  busy: boolean
  failure: string | null
  onClose(): void
  onConfirm(): void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const cancelRef = useRef<View>(null)
  if (!grant) return null
  return (
    <DesktopDialog title={`${t(grant.redeemed ? 'machine_share_revoke_title' : 'machine_share_cancel_invite_title')} · ${machine.name}`}
      initialFocusRef={cancelRef} busy={busy} onClose={() => { if (!busy) onClose() }}>
        <View style={styles.dialogBodyStack}>
          {grant ? (
            <Text style={[styles.dialogBody, { color: colors.textSecondary }]}>
              {t(
                grant.redeemed ? 'machine_share_revoke_body' : 'machine_share_cancel_invite_body',
                { name: grant.granteeName, machine: machine.name },
              )}
            </Text>
          ) : null}
          {failure ? (
            <Text accessibilityRole="alert" style={{ color: colors.error }}>
              {failure}
            </Text>
          ) : null}
          <View style={styles.dialogActions}>
            <DesktopMachineAction
              actionRef={cancelRef}
              compact
              label={t('cancel')}
              disabled={busy}
              onPress={onClose}
            />
            <DesktopMachineAction
              compact
              destructive
              label={t(grant?.redeemed ? 'revoke' : 'cancel_invite')}
              disabled={busy}
              onPress={onConfirm}
            />
          </View>
        </View>
    </DesktopDialog>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  header: {
    minHeight: DESKTOP_WORKSPACE_HEADER_HEIGHT,
    borderBottomWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
  headerInner: {
    width: '100%',
    maxWidth: 1040,
    alignSelf: 'center',
    minHeight: DESKTOP_WORKSPACE_HEADER_HEIGHT,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  title: desktopTypography.windowTitle,
  content: {
    width: '100%',
    maxWidth: 1040,
    alignSelf: 'center',
    padding: 24,
    paddingBottom: 48,
    gap: 16,
  },
  riskCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  riskText: { flex: 1, ...desktopTypography.body },
  loading: { minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: 10 },
  stateCard: { borderWidth: 1, borderRadius: 12, padding: 18, gap: 10 },
  boundaryText: { maxWidth: 480, textAlign: 'center', fontSize: 14, lineHeight: 21 },
  section: { gap: 8 },
  sectionTitle: { ...desktopTypography.sectionTitle },
  list: { borderBottomWidth: StyleSheet.hairlineWidth },
  empty: { paddingVertical: 12, ...desktopTypography.body },
  row: {
    minHeight: 68,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { ...desktopTypography.body },
  rowMeta: { ...desktopTypography.metadata },
  dialogBodyStack: { gap: 12 },
  dialogBody: desktopTypography.body,
  label: desktopTypography.sectionTitle,
  expiryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  expiryChoice: { minHeight: desktopControlMetrics.standardControlHeight, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, borderWidth: 1, borderRadius: desktopControlMetrics.radiusControl },
  linkField: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  dialogActions: {
    flexDirection: 'row',
    flexWrap: 'wrap-reverse',
    justifyContent: 'flex-end',
    gap: 8,
  },
})
