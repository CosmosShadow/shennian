// @arch docs/architecture/desktop/unified-desktop.md#renderer-边界

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'expo-router'
import { Alert } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../config/auth'
import { desktopAccountActions } from '../desktop-control/useDesktopAccountSync'
import { useDesktopAgentSidebarModel } from '../desktop-control/useDesktopAgentSidebarModel'
import { DesktopContactDirectory, type DesktopContactView } from './DesktopContactDirectory'
import { DesktopSocialIdentity } from './DesktopSocialIdentity'
import { desktopSocialAccountPort, type RoomInvitation, type SavedContact, type SentRoomInvitation } from './desktopSocialAccountPort'

export default function DesktopContactsScreen() {
  const accountId = useAuthStore(state => state.user?.id ?? '')
  return accountId ? <DesktopAccountContacts key={accountId} accountId={accountId} /> : null
}

function DesktopAccountContacts({ accountId }: { accountId: string }) {
  const user = useAuthStore(state => state.user)
  const router = useRouter()
  const ownAgentInventory = useDesktopAgentSidebarModel()
  const { i18n } = useTranslation()
  const zh = i18n.language.startsWith('zh')
  const [query, setQuery] = useState('')
  const [contacts, setContacts] = useState<SavedContact[]>([])
  const [selected, setSelected] = useState<DesktopContactView | null>(null)
  const selectedIdRef = useRef<string | null>(null)
  selectedIdRef.current = selected?.id ?? null
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [revision, setRevision] = useState(0)
  const [invitations, setInvitations] = useState<RoomInvitation[]>([])
  const [invitationBusy, setInvitationBusy] = useState<string | null>(null)
  const [sentInvitation, setSentInvitation] = useState<SentRoomInvitation | null>(null)
  const [sentState, setSentState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [inviting, setInviting] = useState(false)
  useEffect(() => {
    let current = true
    setState('loading')
    const timer = setTimeout(() => {
      void desktopSocialAccountPort.contacts(query.trim()).then(result => {
        if (!current || useAuthStore.getState().user?.id !== accountId) return
        setContacts(result.contacts)
        setState('ready')
      }).catch(() => { if (current) setState('failed') })
    }, query ? 200 : 0)
    return () => { current = false; clearTimeout(timer) }
  }, [accountId, query, revision])
  useEffect(() => {
    let current = true
    void desktopSocialAccountPort.invitations().then(result => {
      if (current && useAuthStore.getState().user?.id === accountId) setInvitations(result)
    }).catch(() => undefined)
    return () => { current = false }
  }, [accountId, revision])
  const respond = async (invitationId: string, decision: 'accept' | 'decline') => {
    if (invitationBusy) return
    setInvitationBusy(invitationId)
    try {
      const result = await desktopSocialAccountPort.respondToInvitation(invitationId, decision)
      if (useAuthStore.getState().user?.id !== accountId) return
      setInvitations(rows => rows.filter(row => row.invitationId !== invitationId))
      if (result.status === 'accepted') void desktopAccountActions.reconcile()
    } catch {
      if (useAuthStore.getState().user?.id === accountId) Alert.alert(zh ? '处理邀请失败' : 'Could not respond to invitation')
    } finally { if (useAuthStore.getState().user?.id === accountId) setInvitationBusy(null) }
  }
  const rows = useMemo<DesktopContactView[]>(() => [
    ...(user ? [{ id: `self:${user.id}`, displayName: user.name || '', kind: 'human' as const, group: 'mine' as const, avatar: user.avatar ?? null }] : []),
    ...ownAgentInventory.agents.map(agent => ({ id: `own:${agent.id}`, displayName: agent.displayName,
      kind: 'agent' as const, group: 'mine' as const, avatar: agent.avatar ?? null, agentWorkspaceId: agent.id })),
    ...contacts.filter(contact => !contact.owned || !ownAgentInventory.agents.some(agent =>
      agent.id === (contact.agentWorkspaceId ?? contact.agentIdentityId))).map(contact => ({
      id: contact.id, displayName: contact.displayName, kind: contact.kind,
      group: contact.owned ? 'mine' as const : 'friends' as const, avatar: contact.avatar,
      agentWorkspaceId: contact.owned ? contact.agentWorkspaceId : undefined })),
  ], [contacts, ownAgentInventory.agents, user])
  const selectedContact = selected ? contacts.find(contact => contact.id === selected.id) : undefined
  const selectedHumanId = selectedContact?.kind === 'human' ? selectedContact.userId : undefined
  useEffect(() => {
    let current = true
    setSentInvitation(null)
    setSentState('loading')
    if (selectedHumanId) void desktopSocialAccountPort.sentInvitations(selectedHumanId).then(result => {
      if (!current || useAuthStore.getState().user?.id !== accountId) return
      if (result.length) globalThis.localStorage.removeItem(`desktop-room-invite:${accountId}:${selectedHumanId}`)
      setSentInvitation(result[0] ?? null)
      setSentState('ready')
    }).catch(() => { if (current) setSentState('failed') })
    return () => { current = false }
  }, [accountId, selectedHumanId])
  const inviteSelectedHuman = async () => {
    if (!selectedHumanId || !selected || inviting || sentState !== 'ready') return
    const selectedId = selected.id
    setInviting(true)
    const key = `desktop-room-invite:${accountId}:${selectedHumanId}`
    try {
      let clientOperationId = globalThis.localStorage.getItem(key)
      if (!clientOperationId) {
        clientOperationId = globalThis.crypto.randomUUID()
        globalThis.localStorage.setItem(key, clientOperationId)
      }
      const name = `${user?.name?.trim() || (zh ? '我' : 'Me')} · ${selected.displayName}`.slice(0, 191)
      const result = await desktopSocialAccountPort.inviteHuman(selectedHumanId, name, clientOperationId)
      if (useAuthStore.getState().user?.id !== accountId || selectedIdRef.current !== selectedId) return
      globalThis.localStorage.removeItem(key)
      setSentInvitation({ invitationId: result.invitationId, roomId: result.roomId, roomName: name,
        targetUserId: selectedHumanId, status: 'pending', createdAt: new Date().toISOString(), expiresAt: null })
      void desktopAccountActions.reconcile()
    } catch {
      if (useAuthStore.getState().user?.id === accountId && selectedIdRef.current === selectedId)
        Alert.alert(zh ? '发送邀请失败' : 'Could not send invitation')
    } finally { if (useAuthStore.getState().user?.id === accountId) setInviting(false) }
  }
  if (selected) {
    const source = selectedContact
    return <DesktopSocialIdentity identity={{ ...selected, description: '',
      ownerName: source?.owned ? user?.name : undefined,
      canOpenConversation: sentInvitation?.status === 'accepted' }} onBack={() => setSelected(null)}
      invitationStatus={selectedHumanId ? sentState === 'failed' ? 'unavailable' : sentInvitation?.status : undefined} saving={inviting}
      onInvite={selectedHumanId && sentState === 'ready' ? () => void inviteSelectedHuman() : undefined}
      onOpenConversation={sentInvitation?.status === 'accepted'
        ? () => router.navigate({ pathname: '/(main)/room-workspace', params: { roomId: sentInvitation.roomId } } as never)
        : undefined} />
  }
  return <DesktopContactDirectory contacts={rows} invitations={invitations} invitationBusy={invitationBusy}
    onRespondInvitation={(id, decision) => void respond(id, decision)} query={query} state={state}
    onQueryChange={setQuery} onRetry={() => setRevision(value => value + 1)}
    onOpen={contact => contact.agentWorkspaceId
      ? router.navigate(`/(main)/agents/${contact.agentWorkspaceId}` as never)
      : setSelected(contact)}
    onOpenPlaza={() => router.navigate('/(main)/plaza' as never)}
    onCreateAi={() => router.navigate('/(main)/agents/new' as never)}
    onOpenAiWorkbench={() => router.navigate('/(main)/agents' as never)} />
}
