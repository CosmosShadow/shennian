// @arch docs/features/desktop-room-entry.md
// @test ../../__tests__/desktop-room-entry.test.ts

import { useEffect, useRef, useState, type RefObject } from 'react'
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { extractRoomInvitation } from '../../utils/scan'
import { useAuthStore } from '../../config/auth'
import { useTheme } from '../../hooks/useTheme'
import { useWebModalFocus } from '../../hooks/useWebModalFocus'
import { desktopRoomEntryClient, type DesktopRoomInvitation } from './desktopRoomEntryClient'
import {
  canSubmitDesktopRoomJoin,
  classifyDesktopRoomEntryFailure,
  type DesktopRoomEntryFailure,
  type DesktopRoomEntryStage,
} from './desktopRoomEntryWorkflow'

type Props = {
  visible: boolean
  initialStage: 'create' | 'join-link'
  returnFocusRef: RefObject<unknown>
  onClose(): void
  onOpenRoom(roomId: string): void
  onRefresh(): void
}

export function DesktopRoomEntryModal({ visible, initialStage, returnFocusRef, onClose, onOpenRoom, onRefresh }: Props) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const accountId = useAuthStore(state => state.user?.id ?? null)
  const userName = useAuthStore(state => state.user?.name?.trim() ?? '')
  const lifetime = useRef(0)
  const operation = useRef<object | null>(null)
  const dialogRef = useRef<View>(null)
  const closeRef = useRef<View>(null)
  const [stage, setStage] = useState<DesktopRoomEntryStage>(initialStage)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [link, setLink] = useState('')
  const [message, setMessage] = useState('')
  const [invite, setInvite] = useState<DesktopRoomInvitation | null>(null)
  const [joinHandle, setJoinHandle] = useState('')
  const [roomId, setRoomId] = useState('')
  const [joinRequestId, setJoinRequestId] = useState('')
  const [failure, setFailure] = useState<DesktopRoomEntryFailure | null>(null)
  const [failureReturnStage, setFailureReturnStage] = useState<DesktopRoomEntryStage>(initialStage)
  useWebModalFocus({ visible, containerRef: dialogRef, initialFocusRef: closeRef, returnFocusRef })

  const reset = () => {
    lifetime.current += 1
    operation.current = null
    setStage(initialStage); setBusy(false); setName(''); setLink(''); setMessage('')
    setInvite(null); setJoinHandle(''); setRoomId(''); setJoinRequestId(''); setFailure(null)
    setFailureReturnStage(initialStage)
  }
  useEffect(() => { reset() }, [visible, accountId, initialStage])

  const current = (epoch: number, expectedAccountId: string) =>
    lifetime.current === epoch && useAuthStore.getState().user?.id === expectedAccountId
  const fail = (error: unknown, returnStage: DesktopRoomEntryStage) => {
    setFailure(classifyDesktopRoomEntryFailure(error))
    setFailureReturnStage(returnStage)
    setStage('failure')
  }
  const close = () => { if (!busy) onClose() }
  const openJoinedRoom = (joinedRoomId: string) => {
    onRefresh()
    onClose()
    onOpenRoom(joinedRoomId)
  }

  const createRoom = async () => {
    const roomName = name.trim()
    if (!accountId || !roomName || !userName || busy || operation.current) return
    const epoch = lifetime.current
    const activeOperation = {}
    operation.current = activeOperation
    setBusy(true); setFailure(null)
    try {
      const room = await desktopRoomEntryClient.create(roomName)
      if (!current(epoch, accountId)) return
      openJoinedRoom(room.id)
    } catch (error) { if (current(epoch, accountId)) fail(error, 'create') }
    finally {
      if (operation.current === activeOperation) operation.current = null
      if (current(epoch, accountId)) setBusy(false)
    }
  }

  const exchange = async () => {
    if (!accountId || busy || operation.current) return
    const parsed = extractRoomInvitation(link)
    if (!parsed) { setFailure('invite_unavailable'); setStage('failure'); return }
    const epoch = lifetime.current
    const activeOperation = {}
    operation.current = activeOperation
    setBusy(true); setFailure(null)
    try {
      const result = await desktopRoomEntryClient.exchange({ roomId: parsed.roomId, token: parsed.inviteToken })
      if (!current(epoch, accountId)) return
      if (result.entryState === 'joined') {
        openJoinedRoom(result.roomId ?? parsed.roomId); return
      }
      if (result.entryState === 'pending_approval') {
        setRoomId(result.roomId ?? parsed.roomId); setStage('pending'); onRefresh(); return
      }
      if (!result.invite || !result.joinHandle) throw Object.assign(new Error('Invalid invite'), { code: 'INVALID_OUTPUT' })
      setInvite(result.invite); setJoinHandle(result.joinHandle); setRoomId(result.invite.room.id)
      setStage('join-preview')
    } catch (error) { if (current(epoch, accountId)) fail(error, 'join-link') }
    finally {
      if (operation.current === activeOperation) operation.current = null
      if (current(epoch, accountId)) setBusy(false)
    }
  }

  const join = async () => {
    if (!accountId || !invite || !joinHandle || busy || operation.current || !canSubmitDesktopRoomJoin({ busy, joinPolicy: invite.room.joinPolicy, message })) return
    const epoch = lifetime.current
    const activeOperation = {}
    operation.current = activeOperation
    setBusy(true); setFailure(null)
    try {
      const result = await desktopRoomEntryClient.join({
        joinHandle,
        ...(invite.room.joinPolicy === 'approval' ? { message: message.trim() } : {}),
      })
      if (!current(epoch, accountId)) return
      if (result.outcome === 'pending_approval') {
        setRoomId(result.roomId); onRefresh()
        setJoinRequestId(result.joinRequestId ?? ''); setStage('pending')
      } else openJoinedRoom(result.roomId)
    } catch (error) { if (current(epoch, accountId)) fail(error, 'join-preview') }
    finally {
      if (operation.current === activeOperation) operation.current = null
      if (current(epoch, accountId)) setBusy(false)
    }
  }

  const cancelRequest = async () => {
    if (!accountId || !roomId || !joinRequestId || busy || operation.current) return
    const epoch = lifetime.current
    const activeOperation = {}
    operation.current = activeOperation
    setBusy(true); setFailure(null)
    try {
      await desktopRoomEntryClient.cancelRequest(roomId, joinRequestId)
      if (!current(epoch, accountId)) return
      setStage('cancelled'); onRefresh()
    } catch (error) { if (current(epoch, accountId)) fail(error, 'pending') }
    finally {
      if (operation.current === activeOperation) operation.current = null
      if (current(epoch, accountId)) setBusy(false)
    }
  }

  const title = stage === 'create' ? t('spaces_create_title') : t('spaces_join_room')
  const failureKey = failure === 'forbidden' ? 'spaces_no_permission'
    : failure === 'invite_unavailable' ? 'room_invite_unavailable_body'
      : failure === 'offline' ? 'desktop_room_entry_offline'
        : 'room_invite_join_failed'

  return <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
    <View accessibilityViewIsModal style={styles.overlay}>
      <Pressable accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        style={styles.backdrop} onPress={close} />
      <View ref={dialogRef} testID="desktop-room-entry" style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{title}</Text>
          <Pressable ref={closeRef} testID="desktop-room-entry-close" accessibilityRole="button" accessibilityLabel={t('cancel')}
            accessibilityState={{ disabled: busy }} disabled={busy} onPress={close} style={styles.iconButton}>
            <Ionicons name="close" size={20} color={colors.textSecondary} />
          </Pressable>
        </View>
        <View style={styles.body}>
          {stage === 'create' ? <>
            <Label text={t('spaces_create_name_label')} />
            <TextInput testID="desktop-room-create-name" autoFocus value={name} onChangeText={setName} maxLength={80} onSubmitEditing={() => void createRoom()} placeholder={t('spaces_create_name_placeholder')} placeholderTextColor={colors.textTertiary} style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]} />
            <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('desktop_room_entry_identity_as', { name: userName || t('profile_nickname') })}</Text>
          </> : null}
          {stage === 'join-link' ? <>
            <Label text={t('spaces_invite_input_placeholder')} />
            <View style={styles.inline}>
              <TextInput testID="desktop-room-invite-link" autoFocus value={link} onChangeText={setLink} autoCapitalize="none" autoCorrect={false} onSubmitEditing={() => void exchange()} placeholder={t('spaces_invite_input_placeholder')} placeholderTextColor={colors.textTertiary} style={[styles.input, styles.flex, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]} />
              <SecondaryButton label={t('paste')} disabled={busy} onPress={() => void Clipboard.getStringAsync().then(setLink)} />
            </View>
          </> : null}
          {stage === 'join-preview' && invite ? <>
            <Text style={[styles.roomName, { color: colors.text }]}>{invite.room.name}</Text>
            {invite.room.description ? <Text style={[styles.hint, { color: colors.textSecondary }]}>{invite.room.description}</Text> : null}
            <Text style={[styles.identity, { color: colors.text }]}>{t('desktop_room_entry_identity_as', { name: userName })}</Text>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>{t(invite.room.joinPolicy === 'approval' ? 'spaces_join_requires_approval' : invite.room.joinPolicy === 'closed' ? 'room_invite_closed' : 'spaces_join_directly')}</Text>
            {invite.room.joinPolicy === 'approval' ? <><Label text={t('room_invite_message_label')} /><TextInput testID="desktop-room-join-message" multiline value={message} onChangeText={setMessage} maxLength={500} placeholder={t('room_invite_message_placeholder')} placeholderTextColor={colors.textTertiary} style={[styles.messageInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]} /></> : null}
          </> : null}
          {stage === 'pending' ? <><Status icon="time-outline" title={t('room_invite_pending_title')} body={t('room_invite_pending_body')} />{!joinRequestId ? <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('desktop_room_entry_cancel_from_list')}</Text> : null}</> : null}
          {stage === 'cancelled' ? <Status icon="close-circle-outline" title={t('desktop_room_entry_cancelled_title')} body={t('desktop_room_entry_cancelled_body')} /> : null}
          {stage === 'failure' ? <Status icon={failure === 'forbidden' ? 'lock-closed-outline' : 'alert-circle-outline'} title={t(failure === 'forbidden' ? 'spaces_no_permission' : failure === 'invite_unavailable' ? 'room_invite_unavailable_title' : 'spaces_load_failed')} body={t(failureKey)} error /> : null}
        </View>
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          {stage === 'create' ? <><SecondaryButton label={t('cancel')} disabled={busy} onPress={close} /><PrimaryButton label={t('spaces_create_action')} disabled={!name.trim() || !userName || busy} busy={busy} onPress={() => void createRoom()} /></> : null}
          {stage === 'join-link' ? <><SecondaryButton label={t('cancel')} disabled={busy} onPress={close} /><PrimaryButton label={t('spaces_join_room')} disabled={!link.trim() || busy} busy={busy} onPress={() => void exchange()} /></> : null}
          {stage === 'join-preview' && invite ? <><SecondaryButton label={t('cancel')} disabled={busy} onPress={close} /><PrimaryButton label={t(invite.room.joinPolicy === 'approval' ? 'room_invite_apply' : 'room_invite_join')} disabled={!canSubmitDesktopRoomJoin({ busy, joinPolicy: invite.room.joinPolicy, message })} busy={busy} onPress={() => void join()} /></> : null}
          {stage === 'pending' ? <><SecondaryButton label={t('done')} disabled={busy} onPress={close} />{joinRequestId ? <PrimaryButton label={t('desktop_room_entry_cancel_request')} disabled={busy} busy={busy} onPress={() => void cancelRequest()} /> : null}</> : null}
          {stage === 'cancelled' ? <PrimaryButton label={t('done')} disabled={false} onPress={close} /> : null}
          {stage === 'failure' ? <><SecondaryButton label={t('cancel')} disabled={busy} onPress={close} />{failure === 'offline' || failure === 'failed' ? <PrimaryButton label={t('retry')} disabled={busy} onPress={() => { setFailure(null); setStage(failureReturnStage) }} /> : null}</> : null}
        </View>
      </View>
    </View>
  </Modal>
}

function Label({ text }: { text: string }) { const { colors } = useTheme(); return <Text style={[styles.label, { color: colors.textSecondary }]}>{text}</Text> }
function Status({ icon, title, body, error = false }: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string; error?: boolean }) { const { colors } = useTheme(); return <View style={styles.status}><Ionicons name={icon} size={32} color={error ? colors.error : colors.brand} /><Text accessibilityRole="header" style={[styles.roomName, { color: colors.text }]}>{title}</Text><Text style={[styles.hint, { color: colors.textSecondary }]}>{body}</Text></View> }
function SecondaryButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress(): void }) { const { colors } = useTheme(); return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, { borderColor: colors.border, opacity: disabled ? .45 : 1 }]}><Text style={{ color: colors.text, fontWeight: '600' }}>{label}</Text></Pressable> }
function PrimaryButton({ label, disabled, busy = false, onPress }: { label: string; disabled: boolean; busy?: boolean; onPress(): void }) { const { colors } = useTheme(); return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, busy }} disabled={disabled} onPress={onPress} style={[styles.button, { borderColor: colors.brand, backgroundColor: colors.brand, opacity: disabled ? .45 : 1 }]}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{label}</Text>}</Pressable> }

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,.3)' },
  card: { width: '100%', maxWidth: 560, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, overflow: 'hidden', boxShadow: '0 18px 50px rgba(0,0,0,.18)' },
  header: { minHeight: 52, paddingLeft: 20, paddingRight: 8, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  title: { flex: 1, fontSize: 17, lineHeight: 22, fontWeight: '700' }, iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  body: { minHeight: 180, padding: 24, gap: 14 }, footer: { minHeight: 68, paddingHorizontal: 20, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 10, borderTopWidth: StyleSheet.hairlineWidth },
  label: { fontSize: 13, fontWeight: '600' }, input: { minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 15 }, messageInput: { minHeight: 92, borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 15, textAlignVertical: 'top' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 10 }, flex: { flex: 1 }, hint: { fontSize: 13, lineHeight: 19 }, roomName: { fontSize: 18, lineHeight: 24, fontWeight: '700' }, identity: { fontSize: 14, lineHeight: 20, fontWeight: '600' }, status: { alignItems: 'center', gap: 10, paddingVertical: 10 },
  button: { minHeight: 44, minWidth: 88, paddingHorizontal: 16, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, primaryText: { color: '#fff', fontWeight: '700' },
})
