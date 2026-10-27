import { MachineAvatar } from '../machines/components/MachineAvatar'
// @arch docs/architecture/machine-sharing.md
// @test src/__tests__/machine-avatar.test.ts
// @arch docs/features/desktop-machine-access-boundary.md
// @test ../../__tests__/machine-sharing-source.test.ts

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Clipboard,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { useMachinesStore } from '@shennian/shared'
import type { MachineGrant } from '@shennian/wire'
import { AppPageHeader } from '../../components/AppPageHeader'
import BottomSheet from '../../components/BottomSheet'
import { useGoBack } from '../../hooks/useGoBack'
import { useTheme } from '../../hooks/useTheme'
import { RoomIdentityAvatar } from '../rooms/components/RoomIdentityAvatar'
import { MachineInviteQr } from './MachineInviteQr'
import { getMachineSharingSurfaceState } from '../machines/utils/machineAccessPolicy'
import { machineAccountClient } from '../machines/machineAccountClient'

type Expiry = '1d' | '7d' | '30d' | 'forever'
const EXPIRY_DAYS: Record<Expiry, number | null> = { '1d': 1, '7d': 7, '30d': 30, forever: null }

export default function MachineSharingScreen() {
  const { machineId = '' } = useLocalSearchParams<{ machineId: string }>()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const goBack = useGoBack('/(main)/machines')
  const machine = useMachinesStore((state) => state.machines.find((item) => item.id === machineId))
  const machinesLoading = useMachinesStore((state) => state.loading)
  const machinesRemoteResolved = useMachinesStore((state) => state.remoteResolved)
  const setMachines = useMachinesStore((state) => state.setMachines)
  const [grants, setGrants] = useState<MachineGrant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [expiry, setExpiry] = useState<Expiry>('7d')
  const [creating, setCreating] = useState(false)
  const [invite, setInvite] = useState<{
    grantId: string
    inviteUrl: string
    expiresAt: string | null
  } | null>(null)
  const [revoking, setRevoking] = useState('')
  const surfaceState = getMachineSharingSurfaceState(machine, {
    loading: machinesLoading,
    remoteResolved: machinesRemoteResolved,
  })

  const refreshMachines = useCallback(async () => {
    setMachines(await machineAccountClient.listMachines())
  }, [setMachines])

  const load = useCallback(async () => {
    if (!machineId || surfaceState !== 'owner') {
      setLoading(surfaceState === 'loading')
      return
    }
    setLoading(true)
    setError('')
    try {
      setGrants(await machineAccountClient.listGrants(machineId))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('machine_share_load_failed'))
    } finally {
      setLoading(false)
    }
  }, [machineId, surfaceState, t])

  useEffect(() => {
    void load()
  }, [load])

  const active = useMemo(
    () =>
      grants.filter(
        (item) =>
          item.redeemed &&
          !item.revokedAt &&
          (!item.expiresAt || new Date(item.expiresAt) > new Date()),
      ),
    [grants],
  )
  const pending = useMemo(
    () =>
      grants.filter(
        (item) =>
          !item.redeemed &&
          !item.revokedAt &&
          (!item.expiresAt || new Date(item.expiresAt) > new Date()),
      ),
    [grants],
  )

  const createInvite = async () => {
    if (surfaceState !== 'owner') return
    setCreating(true)
    setError('')
    try {
      const days = EXPIRY_DAYS[expiry]
      const result = await machineAccountClient.createGrant(
        machineId,
        days ? new Date(Date.now() + days * 86_400_000).toISOString() : undefined,
      )
      setInvite(result)
      await Promise.all([load(), refreshMachines()])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('grant_create_failed'))
    } finally {
      setCreating(false)
    }
  }

  const revoke = async (grant: MachineGrant) => {
    if (surfaceState !== 'owner') return
    setRevoking(grant.id)
    try {
      await machineAccountClient.revokeGrant(machineId, grant.id)
      setGrants((current) => current.filter((item) => item.id !== grant.id))
      if (invite?.grantId === grant.id) setInvite(null)
      await refreshMachines()
    } catch (cause) {
      Alert.alert(t('machine_share_action_failed'), cause instanceof Error ? cause.message : '')
    } finally {
      setRevoking('')
    }
  }

  const confirmRevoke = (grant: MachineGrant) =>
    Alert.alert(
      grant.redeemed ? t('machine_share_revoke_title') : t('machine_share_cancel_invite_title'),
      grant.redeemed
        ? t('machine_share_revoke_body', { name: grant.granteeName, machine: machine?.name })
        : t('machine_share_cancel_invite_body', { machine: machine?.name }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: grant.redeemed ? t('revoke') : t('cancel_invite'),
          style: 'destructive',
          onPress: () => void revoke(grant),
        },
      ],
    )

  if (surfaceState !== 'owner') {
    const message =
      surfaceState === 'forbidden'
        ? t('machine_share_owner_only')
        : surfaceState === 'missing'
          ? t('machine_not_found')
          : null
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
        <AppPageHeader title={t('machine_share_page_title')} onBack={goBack} />
        <View style={styles.blockedState}>
          {message ? (
            <Text style={[styles.blockedText, { color: colors.textSecondary }]}>{message}</Text>
          ) : (
            <ActivityIndicator color={colors.brand} />
          )}
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
      <AppPageHeader title={t('machine_share_page_title')} onBack={goBack} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => void Promise.all([load(), refreshMachines()])}
            tintColor={colors.brand}
          />
        }
      >
        <View
          style={[
            styles.machineCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <MachineAvatar machine={machine ?? { os: '', online: false }} />
          <View style={styles.flex}>
            <Text style={[styles.machineName, { color: colors.text }]} numberOfLines={1}>
              {machine?.name ?? t('machine')}
            </Text>
            <Text style={[styles.risk, { color: colors.textSecondary }]}>
              {t('machine_share_risk')}
            </Text>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setInvite(null)
            setSheetOpen(true)
          }}
          style={[styles.primary, { backgroundColor: colors.brand }]}
        >
          <Ionicons name="person-add-outline" size={19} color="#fff" />
          <Text style={styles.primaryText}>{t('machine_share_invite_use')}</Text>
        </Pressable>
        {loading ? (
          <ActivityIndicator color={colors.brand} style={styles.state} />
        ) : error && grants.length === 0 ? (
          <Pressable onPress={() => void load()} style={styles.state}>
            <Text style={{ color: colors.error }}>{t('machine_share_load_failed')}</Text>
            <Text style={{ color: colors.brand }}>{t('retry')}</Text>
          </Pressable>
        ) : (
          <>
            <GrantSection
              title={t('machine_share_people_title')}
              empty={t('machine_share_people_empty')}
              colors={colors}
            >
              {active.map((grant) => (
                <GrantRow
                  key={grant.id}
                  grant={grant}
                  pending={false}
                  busy={revoking === grant.id}
                  colors={colors}
                  onPress={() => confirmRevoke(grant)}
                />
              ))}
            </GrantSection>
            <GrantSection
              title={t('machine_share_pending_title')}
              empty={t('machine_share_pending_empty')}
              colors={colors}
            >
              {pending.map((grant) => (
                <GrantRow
                  key={grant.id}
                  grant={grant}
                  pending
                  busy={revoking === grant.id}
                  colors={colors}
                  onPress={() => confirmRevoke(grant)}
                />
              ))}
            </GrantSection>
          </>
        )}
      </ScrollView>
      <BottomSheet
        isOpen={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={t('machine_share_invite_use')}
        preferDialogOnWeb
      >
        <View style={styles.sheetBody}>
          <Text style={[styles.sheetRisk, { color: colors.textSecondary }]}>
            {t('machine_share_risk')}
          </Text>
          {!invite ? (
            <>
              <Text style={[styles.label, { color: colors.text }]}>{t('expiry')}</Text>
              <View style={styles.chips}>
                {(['1d', '7d', '30d', 'forever'] as Expiry[]).map((value) => (
                  <Pressable
                    key={value}
                    onPress={() => setExpiry(value)}
                    style={[
                      styles.chip,
                      {
                        borderColor: expiry === value ? colors.brand : colors.border,
                        backgroundColor: expiry === value ? `${colors.brand}14` : colors.surface,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        color: expiry === value ? colors.brand : colors.textSecondary,
                        fontWeight: '600',
                      }}
                    >
                      {t(`expiry_${value}`)}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Pressable
                onPress={() => void createInvite()}
                disabled={creating}
                style={[
                  styles.primary,
                  { backgroundColor: colors.brand, opacity: creating ? 0.6 : 1 },
                ]}
              >
                {creating ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryText}>{t('machine_share_generate_link')}</Text>
                )}
              </Pressable>
            </>
          ) : (
            <>
              <MachineInviteQr value={invite.inviteUrl} />
              <Text style={[styles.link, { color: colors.textSecondary }]} numberOfLines={2}>
                {invite.inviteUrl}
              </Text>
              <View style={styles.actions}>
                <Pressable
                  onPress={() => Clipboard.setString(invite.inviteUrl)}
                  style={[styles.secondary, { borderColor: colors.border }]}
                >
                  <Text style={{ color: colors.text }}>{t('copy_link')}</Text>
                </Pressable>
                <Pressable
                  onPress={() =>
                    void Share.share({
                      message: t('machine_share_system_message', {
                        machine: machine?.name,
                        url: invite.inviteUrl,
                      }),
                    })
                  }
                  style={[styles.secondary, { borderColor: colors.border }]}
                >
                  <Text style={{ color: colors.text }}>{t('share')}</Text>
                </Pressable>
              </View>
            </>
          )}
          {error ? <Text style={{ color: colors.error }}>{error}</Text> : null}
        </View>
      </BottomSheet>
    </SafeAreaView>
  )
}

function GrantSection({
  title,
  empty,
  colors,
  children,
}: {
  title: string
  empty: string
  colors: any
  children: any
}) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : children
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
      {rows?.length ? (
        <View
          style={[styles.list, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          {rows}
        </View>
      ) : (
        <Text style={[styles.empty, { color: colors.textTertiary }]}>{empty}</Text>
      )}
    </View>
  )
}

function GrantRow({
  grant,
  pending,
  busy,
  colors,
  onPress,
}: {
  grant: MachineGrant
  pending: boolean
  busy: boolean
  colors: any
  onPress: () => void
}) {
  const { t } = useTranslation()
  const name = pending
    ? t('machine_share_waiting_accept')
    : (grant.granteeName ?? t('organization_member_unnamed'))
  const avatar = grant.granteeAvatar
    ? {
        smallUrl: grant.granteeAvatar.thumbUrl,
        mediumUrl: grant.granteeAvatar.originalUrl,
        version: grant.granteeAvatar.version,
      }
    : null
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      {pending ? (
        <View style={[styles.pendingIcon, { backgroundColor: colors.surfaceHover }]}>
          <Ionicons name="time-outline" size={18} color={colors.textTertiary} />
        </View>
      ) : (
        <RoomIdentityAvatar name={name} avatar={avatar} size={38} />
      )}
      <View style={styles.flex}>
        <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[styles.rowMeta, { color: colors.textTertiary }]}>
          {grant.expiresAt
            ? t('machine_share_expires_at', {
                date: new Date(grant.expiresAt).toLocaleDateString(),
              })
            : t('machine_share_never_expires')}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={pending ? t('cancel_invite') : t('revoke')}
        hitSlop={8}
        onPress={onPress}
        disabled={busy}
        style={styles.rowAction}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.error} />
        ) : (
          <Text style={{ color: colors.error }}>{pending ? t('cancel_invite') : t('revoke')}</Text>
        )}
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flexGrow: 1, padding: 16, paddingBottom: 40, gap: 20 },
  flex: { flex: 1, minWidth: 0 },
  blockedState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  blockedText: { maxWidth: 480, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  machineCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 16,
  },
  machineName: { fontSize: 17, fontWeight: '700' },
  risk: { fontSize: 13, lineHeight: 19, marginTop: 5 },
  primary: {
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
  },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  state: { minHeight: 100, alignItems: 'center', justifyContent: 'center', gap: 8 },
  section: { gap: 9 },
  sectionTitle: { fontSize: 15, fontWeight: '700' },
  empty: { fontSize: 13, paddingVertical: 12 },
  list: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, overflow: 'hidden' },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowMeta: { fontSize: 12, marginTop: 3 },
  rowAction: { minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
  pendingIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetBody: { paddingHorizontal: 16, paddingBottom: 12, gap: 16 },
  sheetRisk: { fontSize: 13, lineHeight: 19 },
  label: { fontSize: 14, fontWeight: '600' },
  chips: { flexDirection: 'row', gap: 8 },
  chip: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  link: { fontSize: 12, lineHeight: 17, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 10 },
  secondary: {
    flex: 1,
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
