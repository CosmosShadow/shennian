// @arch docs/architecture/interactive-web-agent-and-versioning.md
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActionSheetIOS, Alert, Keyboard, Platform, Share } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import * as ImagePicker from 'expo-image-picker'
import * as DocumentPicker from 'expo-document-picker'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import { File } from 'expo-file-system'
import type { ContentCanvasHandle } from './contentRuntimeTypes'
import { useContentRuntime } from './useContentRuntime'
import { InteractiveContentShell } from './InteractiveContentShell'
import { ContentCollection } from './ContentCollection'
import { contentClient, type CollectionKind, type ContentCard } from './contentClient'
import { useVoiceDraft } from '../chat/hooks/useVoiceDraft'
import { requestAiDataConsent } from '../privacy/aiDataConsent'

export function InteractiveContentScreen() {
  const params = useLocalSearchParams<{ workId?: string }>(), router = useRouter(), { t } = useTranslation()
  const canvas = useRef<ContentCanvasHandle>(null)
  const observe = useCallback(async (part?: 'state' | 'methods') => { if (!canvas.current) throw new Error('no_current_canvas'); return canvas.current.observe(part) }, [])
  const invoke = useCallback(async (name: string, args: Record<string, unknown>) => { if (!canvas.current) throw new Error('no_current_canvas'); return canvas.current.invoke(name, args) }, [])
  const runtime = useContentRuntime(params.workId, observe, invoke)
  const [input, setInput] = useState('')
  const [materials, setMaterials] = useState<Array<{ id: string; name: string }>>([])
  const [mine, setMine] = useState(false)
  const account = useRef(runtime.accountId); account.current = runtime.accountId
  const [collection, setCollection] = useState<CollectionKind | null>(null)
  const [sections, setSections] = useState<{ owner: string; works: ContentCard[]; interactions: ContentCard[] }>({ owner: runtime.accountId, works: [], interactions: [] })
  const [refresh, setRefresh] = useState(0)
  const [uploading, setUploading] = useState(false)
  useEffect(() => { setInput(''); setMaterials([]); setMine(false); setCollection(null); setUploading(false) }, [runtime.accountId, params.workId])
  const consent = useCallback(() => requestAiDataConsent({ accountId: runtime.accountId, kind: 'interactive',
    title: t('content_consent_title'), message: t('content_consent_body'), allowLabel: t('content_consent_allow'),
    declineLabel: t('ai_consent_not_now'), privacyLabel: t('ai_consent_privacy') }), [runtime.accountId, t])
  const submit = useCallback(async (text: string, source: 'user' | 'page' = 'user') => {
    if (uploading || !runtime.ready || !(await consent())) return
    if (await runtime.submit(text, source === 'user' ? materials.map((asset) => asset.id) : [], source)) {
      if (source === 'user') {
        setInput((current) => current.trim() === text.trim() ? '' : current)
        const sent = new Set(materials.map((item) => item.id))
        setMaterials((current) => current.filter((item) => !sent.has(item.id)))
      }
    }
  }, [runtime.submit, runtime.ready, materials, uploading, consent])
  const voice = useVoiceDraft({ sessionId: runtime.accountId ? `shennian:${runtime.accountId}` : null,
    active: runtime.ready && !collection && !mine, sessionDraftEnabled: false, currentDraft: input,
    onListeningTextChange: setInput, onDraftReady: (result) => { void submit(result.draft) } })
  useEffect(() => { void voice.cancelRecording() }, [runtime.accountId, params.workId])
  const open = useCallback((workId: string) => { Keyboard.dismiss(); void runtime.open(workId).catch(() => runtime.notify(t('content_work_unavailable'))) }, [runtime.open, runtime.notify, t])
  const pageIntent = useCallback((text: string) => { void submit(text, 'page') }, [submit])
  const paint = useCallback(() => {
    if (runtime.document) void contentClient.viewed(runtime.document.workId).catch(() => {})
  }, [runtime.document?.workId])
  const refreshSections = async () => {
    const owner = account.current
    const [works, interactions] = await Promise.all([contentClient.collection('works'), contentClient.collection('interactions')])
    if (account.current !== owner) return
    setSections({ owner, works: works.works.slice(0, 4), interactions: interactions.works.filter((card) => card.creatorId !== owner).slice(0, 4) })
  }
  useEffect(() => { if (mine && !collection) void refreshSections().catch(() => {}) }, [mine, collection, runtime.session.jobs.length, runtime.document?.headRevision, runtime.accountId])
  const manage = (card: ContentCard) => {
    const remove = () => Alert.alert(t('content_delete'), t(card.published ? 'content_delete_shared' : 'content_delete_confirm'), [
      { text: t('cancel'), style: 'cancel' }, { text: t('content_delete'), style: 'destructive', onPress: () => {
        void contentClient.delete(card.workId).then(async () => { setRefresh((value) => value + 1); await refreshSections() })
          .catch(() => runtime.notify(t('content_request_unavailable')))
      } },
    ])
    const options = [t('cancel'), t('content_delete')]
    if (Platform.OS === 'ios') ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: 0, destructiveButtonIndex: 1 },
      (index) => { if (index === 1) remove() })
    else Alert.alert(card.title, '', [{ text: options[1], style: 'destructive', onPress: remove }, { text: options[0], style: 'cancel' }])
  }
  const upload = async (files: Array<{ uri: string; name: string; type: string }>) => {
    const owner = account.current
    if (!(await consent()) || account.current !== owner) return
    setUploading(true)
    try {
      const added: Array<{ id: string; name: string }> = []
      for (const file of files.slice(0, 8 - materials.length)) {
        const image = file.type.startsWith('image/') ? await manipulateAsync(file.uri, [{ resize: { width: 1600 } }], { format: SaveFormat.JPEG, compress: 0.85 }) : null
        const local = new File(image?.uri || file.uri)
        if (local.size > 8 * 1024 * 1024) throw new Error('asset_too_large')
        const base64 = await local.base64()
        if (account.current !== owner) return
        const result = await contentClient.upload(image ? 'image/jpeg' : file.type, base64)
        added.push({ id: result.id, name: file.name })
      }
      if (account.current === owner) setMaterials((old) => [...old, ...added].slice(0, 8))
    } catch { runtime.notify(t('content_upload_unavailable')) }
    finally { setUploading(false) }
  }
  const pick = (kind: 'image' | 'file') => {
    void (async () => {
      if (kind === 'image') {
        const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: Math.max(1, 8 - materials.length) })
        if (!result.canceled) await upload(result.assets.map((asset) => ({ uri: asset.uri, name: asset.fileName || t('content_pick_image'), type: asset.mimeType || 'image/jpeg' })))
      } else {
        const result = await DocumentPicker.getDocumentAsync({ multiple: true, type: ['image/jpeg', 'image/png', 'image/webp', 'text/plain', 'application/json'] })
        if (!result.canceled) await upload(result.assets.map((asset) => ({ uri: asset.uri, name: asset.name, type: asset.mimeType || 'text/plain' })))
      }
    })().catch(() => runtime.notify(t('content_upload_unavailable')))
  }
  if (collection) return <ContentCollection kind={collection} onBack={() => setCollection(null)} refreshKey={refresh}
    onOpen={(workId) => { setCollection(null); setMine(false); open(workId) }} onMore={manage} />
  return <InteractiveContentShell key={runtime.accountId} canvasResetKey={runtime.surfaceReset} previous={runtime.previous} next={runtime.next} mine={mine} onMineChange={setMine} canvasRef={canvas} session={runtime.session} input={input} onInput={setInput}
    onBack={() => { void voice.cancelRecording(); if (router.canGoBack()) router.back(); else router.replace('/(main)/spaces') }}
    loading={runtime.booting} available={runtime.ready && !uploading} submitting={runtime.submitting || uploading} updating={runtime.updating}
    feedback={voice.error ? t('content_voice_unavailable') : runtime.feedback || (!runtime.ready && !runtime.booting ? t('content_ready_unavailable') : '')}
    onRemoveMaterial={(index) => setMaterials((old) => old.filter((_, i) => i !== index))}
    onSubmit={() => { void submit(input) }} onPickMaterial={pick} materialNames={materials.map((asset) => asset.name)}
    recordingLevel={voice.meterLevel} publishing={runtime.publishing}
    showPublish={runtime.document?.creatorId === runtime.accountId && !runtime.document.published}
    recording={voice.phase === 'listening'} transcript={voice.transcript}
    onRecord={(continueHolding) => voice.startRecording(continueHolding)} onCancelRecording={() => { void voice.cancelRecording() }} onStopRecording={() => { void voice.stopRecording() }}
    onPage={async (direction, expectedWorkId) => { void voice.cancelRecording(); try { return await runtime.page(direction, expectedWorkId) } catch { runtime.notify(t('content_request_unavailable')); return false } }}
    onShare={() => { if (runtime.document?.shareUrl) void Share.share({ url: runtime.document.shareUrl, message: Platform.OS === 'ios' ? undefined : runtime.document.shareUrl }) }}
    canPublish={runtime.document?.creatorId === runtime.accountId && !runtime.document.published && Boolean(runtime.session.position?.followCurrent) && !runtime.submitting && !runtime.updating && !runtime.session.jobs.some((job) => job.workId === runtime.document?.workId)}
    onPublish={() => { void runtime.publish().catch(() => runtime.notify(t('content_request_unavailable'))) }}
    onOpenCompleted={open} onCollection={setCollection} onOpenCard={open} onManageCard={manage}
    onMyOpened={() => { void voice.cancelRecording(); void refreshSections().catch(() => {}) }} sections={sections.owner === runtime.accountId ? sections : { works: [], interactions: [] }}
    onPageIntent={pageIntent} onSave={(html, metadata) => { void consent().then((ok) => ok ? runtime.save(html, metadata) : undefined).catch(() => runtime.notify(t('content_request_unavailable'))) }} onPaint={paint} />
}
