// @arch docs/product/ui-design/互动内容流_极简交互与分发_设计说明.md
// @test src/__tests__/interactive-content-session.test.ts
import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, PanResponder, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTheme } from '../../hooks/useTheme'
import { createHoldToTalk } from './holdToTalk'
import { AppPageHeader, HeaderBackButton, HeaderIconButton } from '../../components/AppPageHeader'
import { GlassSurface } from './GlassSurface'
import { ContentCard } from './ContentCard'
import type { ContentSaveMetadata, ContentCanvasHandle } from './contentRuntimeTypes'
import type { Ref } from 'react'
import type { ContentCard as Card } from './contentClient'
import { ContentPager, type ContentPagerHandle } from './ContentPager'
import { contentSwipeDirection, selectedDocument, type ContentSession, type ContentDocument } from './contentSession'

export type ContentShellProps = {
  mine?: boolean
  onMineChange?(value: boolean): void
  canvasRef?: Ref<ContentCanvasHandle>
  session: ContentSession
  input: string
  onInput(text: string): void
  onBack(): void
  onSubmit(): void
  onPickMaterial(kind: 'image' | 'file'): void
  onRecord(continueHolding?: () => boolean): Promise<boolean> | void
  onCancelRecording?(): void
  onStopRecording(): void
  onPage(direction: -1 | 1, expectedWorkId: string): Promise<boolean>
  canvasResetKey?: number
  previous?: ContentDocument
  next?: ContentDocument
  onShare(): void
  onPublish(): void
  onOpenCompleted(workId: string): void
  onMyOpened?(): void
  onPageIntent?(text: string): void
  onSave?(html: string, metadata?: ContentSaveMetadata): void
  onPaint?(): void
  onOpenCard?(workId: string): void
  onManageCard?(card: Card): void
  sections?: { works: Card[]; interactions: Card[] }
  updating?: boolean
  onCollection?(kind: 'works' | 'interactions' | 'recent'): void
  loading?: boolean
  available: boolean
  recording?: boolean
  transcript?: string
  submitting?: boolean
  feedback?: string
  materialNames?: string[]
  onRemoveMaterial?(index: number): void
  showPublish?: boolean
  publishing?: boolean
  recordingLevel?: number
  canPublish?: boolean
  developmentNote?: boolean
}

/** One host surface for viewing and creating; generated HTML never renders platform controls. */
export function InteractiveContentShell(props: ContentShellProps) {
  const { t } = useTranslation()
  const { colors, isDark } = useTheme()
  const insets = useSafeAreaInsets()
  const [internalMine, setInternalMine] = useState(false)
  const mine = props.mine ?? internalMine
  const setMine = (value: boolean) => { setInternalMine(value); props.onMineChange?.(value) }
  const [materialsOpen, setMaterialsOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [holdFeedback, setHoldFeedback] = useState<{ phase: 'idle' | 'preparing' | 'listening'; cancelling: boolean }>({ phase: 'idle', cancelling: false })
  const touchY = useRef(0)
  const current = useRef(props)
  current.current = props
  const editor = useRef<TextInput>(null)
  const hold = useRef<ReturnType<typeof createHoldToTalk> | null>(null)
  if (!hold.current) hold.current = createHoldToTalk({
    available: () => current.current.available && !current.current.recording && !current.current.submitting,
    start: async (keepHolding) => (await current.current.onRecord(keepHolding)) === true,
    stop: () => current.current.onStopRecording(), cancel: () => current.current.onCancelRecording?.(),
    focus: () => editor.current?.focus(), feedback: (phase, cancelling) => setHoldFeedback({ phase, cancelling }),
  })
  useEffect(() => () => hold.current?.dispose(), [])
  const pager = useRef<ContentPagerHandle>(null)
  const protectedGesture = useRef(false)
  protectedGesture.current = editing || Boolean(props.recording) || holdFeedback.phase !== 'idle'
  const blockedAtStart = useRef(true)
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponderCapture: () => { blockedAtStart.current = protectedGesture.current; return false },
    // Only this dedicated handle owns paging. The HTML and composer never capture its gesture.
    onMoveShouldSetPanResponderCapture: (_, g) => !blockedAtStart.current && !current.current.recording && Math.abs(g.dy) > 12 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
    onPanResponderGrant: () => { Keyboard.dismiss(); pager.current?.begin() },
    onPanResponderMove: (_, g) => pager.current?.move(g.dy),
    onPanResponderRelease: (_, g) => {
      const direction = contentSwipeDirection({ dx: g.dx, dy: g.dy,
        editing: blockedAtStart.current, recording: Boolean(current.current.recording) })
      pager.current?.finish(direction || null)
    },
    onPanResponderTerminate: () => pager.current?.finish(null),
    onPanResponderTerminationRequest: () => false,
  }), [])
  const document = selectedDocument(props.session)
  const glass = { borderColor: isDark ? '#ffffff24' : '#ffffffdd' }
  const icon = (name: React.ComponentProps<typeof Ionicons>['name'], label: string,
    action: () => void, disabled = false, testID?: string) => (
    <HeaderIconButton icon={name} label={label} onPress={action} disabled={disabled} testID={testID} />
  )
  if (mine) return <View style={[styles.root, { paddingTop: insets.top, backgroundColor: colors.bg }]}>
    <AppPageHeader title={t('content_my')} onBack={() => setMine(false)} hideDivider />
    <ScrollView contentContainerStyle={styles.myBody}>
      {(['works', 'interactions'] as const).map((kind) => <View key={kind} style={styles.section}>
        <Pressable testID={`interactive-content-${kind}`} accessibilityRole="button" accessibilityLabel={t(`content_${kind}`)} disabled={!props.onCollection}
          onPress={() => props.onCollection?.(kind)} style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>{t(`content_${kind}`)}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Pressable>
        {props.sections?.[kind].length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14 }}>
          {props.sections[kind].slice(0, 4).map((card) => <ContentCard key={card.workId} card={card} width={156}
            onOpen={() => { if (card.versionId) { props.onOpenCard?.(card.workId); setMine(false) } }}
            onMore={kind === 'works' && props.onManageCard ? () => props.onManageCard?.(card) : undefined} />)}
        </ScrollView> : <Text style={[styles.emptyRow, { color: colors.textMuted }]}>{t('content_no_items')}</Text>}
      </View>)}
      <Pressable testID="interactive-content-recent" accessibilityRole="button" accessibilityLabel={t('content_recent')} disabled={!props.onCollection}
        onPress={() => props.onCollection?.('recent')} style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('content_recent')}</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </Pressable>
    </ScrollView>
  </View>

  const modifying = props.updating || props.session.jobs.some((job) => job.workId === document?.workId && job.kind === 'modify')
  const creating = props.session.jobs.some((job) => job.kind === 'create')
  const placeholderKey = modifying ? 'content_input_modifying' : document
    ? document.published ? 'content_input_current' : 'content_input_edit' : 'content_input_empty'
  return <KeyboardAvoidingView style={[styles.root, { backgroundColor: colors.bg }]}
    behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View testID="interactive-content-module" style={[styles.canvas, { marginTop: insets.top + 4, backgroundColor: colors.surface }]}>
      {document ? <ContentPager key={props.canvasResetKey ?? 0} ref={pager} document={document} previous={props.previous} next={props.next} canvasRef={props.canvasRef} onPage={props.onPage} onIntent={props.onPageIntent} onSave={props.onSave} onPaint={props.onPaint} />
        : props.loading ? <View style={styles.empty}><ActivityIndicator accessibilityLabel={t('loading')} color={colors.textMuted} /></View> : null}
    </View>
    <View pointerEvents="box-none" style={[styles.top, { top: insets.top }]}>
      <HeaderBackButton onPress={props.onBack} accessibilityLabel={t('content_lab_back')} />
      {document ? ((props.showPublish ?? props.canPublish) ? <GlassSurface style={[styles.publishGlass, glass]}>
        <Pressable testID="interactive-content-publish" accessibilityRole="button" accessibilityLabel={t('content_publish')}
          accessibilityState={{ disabled: !props.canPublish || props.publishing, busy: props.publishing }}
          disabled={!props.canPublish || props.publishing} onPress={props.onPublish}
          style={[styles.publish, { opacity: props.canPublish && !props.publishing ? 1 : 0.35 }]}>
          <Text style={{ color: colors.text, fontWeight: '600' }}>{t('content_publish')}</Text>
        </Pressable>
      </GlassSurface> : document.published ? icon('share-outline', t('content_share'), props.onShare) : null) : null}
    </View>
    {materialsOpen ? <Pressable testID="interactive-content-material-dismiss" accessibilityLabel={t('cancel')}
      style={StyleSheet.absoluteFillObject} onPress={() => setMaterialsOpen(false)} /> : null}
    <View pointerEvents="box-none" style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      {materialsOpen ? <GlassSurface testID="interactive-content-material-menu" style={[styles.materialMenu, glass]}>
        {(['image', 'file'] as const).map((kind) => <Pressable key={kind} accessibilityRole="button"
          testID={`interactive-content-pick-${kind}`} accessibilityLabel={t(kind === 'image' ? 'content_pick_image' : 'content_pick_file')}
          onPress={() => { setMaterialsOpen(false); props.onPickMaterial(kind) }} style={styles.materialChoice}>
          <Ionicons name={kind === 'image' ? 'image-outline' : 'document-outline'} size={22} color={colors.text} />
          <Text style={{ color: colors.text, fontSize: 15 }}>{t(kind === 'image' ? 'content_pick_image' : 'content_pick_file')}</Text>
        </Pressable>)}
      </GlassSurface> : null}
      {props.developmentNote ? <Text style={[styles.note, { color: colors.textMuted }]}>{t('content_lab_note')}</Text> : null}
      {props.feedback || modifying || creating || props.submitting || props.publishing ? <GlassSurface testID="interactive-content-status" accessibilityLiveRegion="polite" style={[styles.status, glass]}>
        {(modifying || creating || props.submitting || props.publishing) ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
        <Text numberOfLines={1} style={[styles.statusText, { color: colors.textSecondary }]}>
          {props.publishing ? t('content_publishing') : modifying ? t('content_modifying') : props.submitting ? t('content_thinking') : creating ? t('content_creating') : props.feedback}
        </Text>
      </GlassSurface> : null}
      {props.session.completedWorkId ? <GlassSurface style={[styles.completionGlass, glass]}><Pressable testID="interactive-content-completed" accessibilityRole="button"
        onPress={() => props.onOpenCompleted(props.session.completedWorkId!)} style={styles.completion}>
        <Ionicons name="checkmark-circle" size={22} color={colors.brand} />
        <Text style={{ color: colors.text }}>{t('content_completed')}</Text>
      </Pressable></GlassSurface> : null}
      {props.materialNames?.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {props.materialNames.map((name, index) => <Pressable key={`${index}:${name}`} accessibilityRole="button"
          accessibilityLabel={t('content_remove_material', { name })} onPress={() => props.onRemoveMaterial?.(index)}
          style={[styles.materialChip, { backgroundColor: colors.surface }]}>
          <Text numberOfLines={1} style={[styles.materials, { color: colors.textSecondary }]}>{name}</Text>
          <Ionicons name="close" size={15} color={colors.textMuted} />
        </Pressable>)}
      </ScrollView> : null}
      <View testID="interactive-content-paging-zone" collapsable={false} {...pan.panHandlers} style={styles.pagingHandle}
        accessibilityLabel={t('content_page_handle')} accessibilityRole="adjustable"
        accessibilityActions={[{ name: 'increment', label: t('content_next') }, { name: 'decrement', label: t('content_previous') }]}
        onAccessibilityAction={(event) => {
          if (!protectedGesture.current) { const direction = event.nativeEvent.actionName === 'increment' ? 1 : -1; pager.current?.begin(); pager.current?.finish(direction) }
        }}>
        <View pointerEvents="none" style={[styles.handleLine, { backgroundColor: colors.textMuted }]} />
      </View>
      <GlassSurface testID="interactive-content-input-bar" style={[styles.bar, glass]}>
        {icon('ellipsis-horizontal', t('content_my'), () => { props.onMyOpened?.(); setMine(true) }, false, 'interactive-content-my')}
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <View style={styles.inputSlot}>{props.recording || holdFeedback.phase !== 'idle' ? <View testID="interactive-content-recording" style={styles.recording}>
          <View testID="interactive-content-level" accessible={false} style={styles.wave}>
            {[0.4, 0.75, 1, 0.65, 0.35].map((scale, i) => <View key={i} style={{ width: 3, borderRadius: 2, backgroundColor: '#F36F8F', height: 4 + 22 * scale * Math.max(0, Math.min(1, props.recordingLevel ?? 0)) }} />)}
          </View><Text numberOfLines={1} style={[styles.transcript, { color: colors.text }]}>{holdFeedback.cancelling ? t('content_hold_cancel') : props.transcript || t(holdFeedback.phase === 'preparing' ? 'content_hold_preparing' : 'content_hold_listening')}</Text></View>
          : <TextInput ref={editor} pointerEvents={editing ? 'auto' : 'none'} testID="interactive-content-input" value={props.input} onChangeText={props.onInput}
            onFocus={() => setEditing(true)} onBlur={() => setEditing(false)}
            placeholder={t(placeholderKey)}
            placeholderTextColor={colors.textMuted} accessibilityLabel={t(placeholderKey)}
            style={[styles.input, { color: colors.text }]} clearButtonMode="while-editing" maxLength={8000} returnKeyType="send"
            onSubmitEditing={props.available && !props.submitting ? props.onSubmit : undefined} />}
            {!editing ? <Pressable testID="interactive-content-activate-input" accessible={false}
              style={StyleSheet.absoluteFillObject} delayLongPress={350}
              pressRetentionOffset={{ top: 180, bottom: 80, left: 100, right: 100 }}
              onPressIn={(event) => { touchY.current = event.nativeEvent.pageY; hold.current?.arm() }}
              onTouchMove={(event) => hold.current?.move(event.nativeEvent.pageY - touchY.current)}
              onTouchCancel={() => hold.current?.cancel()} onLongPress={() => hold.current?.start()}
              onPressOut={() => hold.current?.release()} onPress={() => hold.current?.tap()} /> : null}
          </View>
        {props.recording || holdFeedback.phase !== 'idle' ? icon('stop', t('content_stop_record'), () => { if (holdFeedback.phase !== 'idle') hold.current?.cancel(); else props.onStopRecording() })
          : props.input.trim() ? icon('arrow-up', t('content_send'), props.onSubmit, !props.available || props.submitting, 'interactive-content-send')
            : icon('mic-outline', t('content_record'), () => { void props.onRecord() }, !props.available)}
        <View style={[styles.actionDivider, { backgroundColor: colors.border }]} />
        {icon('add', t('content_assets'), () => { Keyboard.dismiss(); setMaterialsOpen(!materialsOpen) }, Boolean(props.recording), 'interactive-content-assets')}
      </GlassSurface>
    </View>
  </KeyboardAvoidingView>
}

const styles = StyleSheet.create({
  materialMenu: { alignSelf: 'flex-end', borderRadius: 22, borderWidth: 1, padding: 6, marginBottom: 10, minWidth: 168 },
  materialChoice: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingHorizontal: 16 },
  root: { flex: 1 }, canvas: { flex: 1, marginHorizontal: 8, marginBottom: 8, borderRadius: 24, overflow: 'hidden' },
  pagingHandle: { height: 32, marginBottom: -6, alignItems: 'center', justifyContent: 'center' },
  handleLine: { width: 40, height: 4, borderRadius: 2, opacity: 0.35 },
  top: { position: 'absolute', left: 0, right: 0, height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  publishGlass: { borderWidth: 1, borderRadius: 24, overflow: 'hidden' },
  publish: { paddingHorizontal: 20, justifyContent: 'center', minHeight: 44 },
  recording: { flex: 1, minWidth: 0, flexDirection: 'row', gap: 10, alignItems: 'center' },
  wave: { width: 23, height: 28, flexDirection: 'row', gap: 2, alignItems: 'center' },
  actionDivider: { width: StyleSheet.hairlineWidth, height: 22 },
  completionGlass: { borderRadius: 18, borderWidth: 1, overflow: 'hidden' },
  completion: { padding: 14, minHeight: 48, flexDirection: 'row', gap: 10, alignItems: 'center' },
  bottom: { paddingHorizontal: 16, gap: 10 },
  bar: { flexDirection: 'row', alignItems: 'center', borderRadius: 27, minHeight: 54,
    paddingHorizontal: 5, borderWidth: 1, shadowColor: '#000', shadowOpacity: 0.09, shadowRadius: 18, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  divider: { width: StyleSheet.hairlineWidth, height: 22, marginRight: 10 },
  inputSlot: { flex: 1, minWidth: 0 },
  input: { minWidth: 0, fontSize: 15, paddingVertical: 12 },
  transcript: { flex: 1, minWidth: 0, fontSize: 15 },
  empty: { flex: 1, justifyContent: 'center', paddingHorizontal: 36, paddingBottom: 100, gap: 12 },
  emptyTitle: { fontSize: 30, fontWeight: '600', letterSpacing: -0.6 },
  emptyBody: { fontSize: 16, lineHeight: 25 },
  note: { fontSize: 12, textAlign: 'center' },
  status: { alignSelf: 'flex-start', maxWidth: '100%', borderRadius: 18, paddingHorizontal: 14,
    paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1 },
  materialChip: { minHeight: 36, maxWidth: 220, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, borderRadius: 18 },
  statusText: { fontSize: 14, flexShrink: 1 }, materials: { fontSize: 13, paddingHorizontal: 14 },
  myBody: { padding: 20, paddingTop: 12, gap: 24 },
  section: { gap: 12 }, sectionHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 21, fontWeight: '600' }, emptyRow: { fontSize: 14, paddingBottom: 24 },
})
