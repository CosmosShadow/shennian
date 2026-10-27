import { describe, expect, it } from 'vitest'
// @covers packages/app/src/features/steward/StewardScreen.tsx
// @covers packages/app/src/features/steward/StewardSettingsScreen.tsx
// @covers packages/app/src/features/steward/StewardSessionsScreen.tsx
// @covers packages/app/src/features/steward/StewardEntryRow.tsx
// @covers packages/app/app/(main)/spaces/index.tsx

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf8')
const has = (source: string, ...parts: string[]) => parts.every((part) => source.includes(part))

// Static invariants of the steward's mobile wiring; behaviour lives in steward-model.test.ts and steward-settings-behavior.test.ts.
describe('steward mobile entry and pages', () => {
  it('has one list entry, three routes, a dedicated management route (not steward-history), and unified settings without a redundant more button', () => {
    expect(read('../../app/(main)/spaces/index.tsx')).not.toContain('<StewardEntryRow')
    expect(has(read('../features/steward/StewardEntryRow.tsx'), "router.navigate('/(main)/steward')",
      'item.lastMessagePreview &&', 'latest.lastMessagePreviewAt ?? latest.lastActivityAt')).toBe(true)
    expect(has(read('../../app/(main)/_layout.tsx'), 'name="steward"')).toBe(true)
    expect(existsSync(resolve(__dirname, '../../app/(main)/steward-history.tsx'))).toBe(false)
    expect(existsSync(resolve(__dirname, '../../app/(main)/steward-sessions.tsx'))).toBe(true)
    const screen = read('../features/steward/StewardScreen.tsx')
    expect(screen.split('{moduleContent ?')[0]!.match(/<HeaderIconButton/g)).toHaveLength(2)
    expect(screen).toContain('testID="steward-back"')
    expect(screen).toContain('testID="steward-more"')
    expect(screen).not.toContain('StewardMoreMenu')
    expect(screen).toContain("onPress={() => router.push('/(main)/steward-settings')}")
    expect(has(screen, 'steward.showMachineName ? machine?.name : undefined',
      "pathname: '/(main)/machine/[machineId]'", 'stewardPrelude={prelude}', 'stewardSwitches={switches}', 'stewardConversationView',
      "stewardName={t('steward_title')}")).toBe(true)
  })





  it('keeps one top-inset owner across standby and ready, including Tab remounts', () => {
    const screen = read('../features/steward/StewardScreen.tsx')
    expect(screen).toContain('paddingTop: props.dockOnly ? 0 : top')
    expect(screen).toContain('testID="steward-viewport"')
    expect(screen).not.toContain('<SafeAreaView')
    expect(read('../features/chat/screens/ChatScreen.tsx')).toContain(
      "edges={embedded || composerOnly || stewardConversationView ? [] : ['top']}",
    )
    expect(read('../features/steward/useStewardConversation.ts')).toContain(
      '!prefs || (primary.loading && !primary.record)',
    )
  })

  it('marks the machine read only after its native conversation paints, using steward watermarks', () => {
    const store = read('../features/steward/stewardSessionsStore.ts')
    expect(has(store, 'async markRead(sessionId, presented)', 'async markMachineRead(machineId, presentedCurrent)',
      'unreadStewardSessionsOnMachine', 'stewardReadWatermark(presented ?? session)',
      'paintedStewardReadSession(presentedCurrent, session)', 'steward_painted_body_stale',
      '/user-state', "method: 'PATCH'", 'accountRuntime.persistSession(read(session))')).toBe(true)
    const hook = read('../features/steward/useStewardConversation.ts')
    expect(hook.includes('markRead(session.id)')).toBe(false)
    const screen = read('../features/steward/StewardScreen.tsx')
    expect(has(screen, 'onStewardMessagesPresented={markPresentedMachineRead}',
      'markMachineRead(pending.machineId, pending.session)', 'cachedBodyRevision',
      'syncVisiblePersonalSessionBody(pending.session.id)', 'retryTimerRef',
      "AppState.addEventListener('change'")).toBe(true)
    expect(screen.includes('if ((body?.cachedBodyRevision ?? 0) < (session.bodyRevision ?? 0)) return')).toBe(false)
    expect(store.includes("throw new Error('steward_read_refresh_failed')")).toBe(true)
    const chat = read('../features/chat/screens/ChatScreen.tsx')
    expect(has(chat, 'skipReadCommit: stewardConversationView', 'presentationToken={pendingPresentationToken}',
      'onConversationPainted: (token)', 'onStewardMessagesPresented?.()', 'paintKey:')).toBe(true)
    const list = read('../features/steward/components/StewardMessageList.tsx')
    expect(has(list, 'requestAnimationFrame', 'onLayout={() => setLaidOut(true)}',
      'presentationToken', 'paintKey', 'onConversationPainted')).toBe(true)
  })



  it('never lets a slower in-flight hydrate/refresh resurrect a session this device just deleted', () => {
    const store = read('../features/steward/stewardSessionsStore.ts')
    expect(has(store, 'deletedIds: Set<string>',
      'local.filter((session) => !state.deletedIds.has(session.id))',
      'remote.filter((session) => !state.deletedIds.has(session.id))',
      'deletedIds: new Set([...state.deletedIds, ...ids])')).toBe(true)
  })

  it('creates steward drafts with the steward scope in its own store and filters the chat only in steward mode', () => {
    const hook = read('../features/steward/useStewardConversation.ts')
    expect(has(hook, "sessionScope: 'steward'", 'workDir: STEWARD_WORKDIR', 'useStewardSessionsStore')).toBe(true)
    expect(hook.includes('useSessionsStore')).toBe(false)
    expect(has(read('../features/sessions/localSessionDraft.ts'), "session.sessionScope === 'steward'")).toBe(true)
    expect(has(read('../storage/db.native.ts'), "'sessionScope'")).toBe(true)
    const chat = read('../features/chat/screens/ChatScreen.tsx')
    expect(has(chat, 'visibleStewardMessages(hydratedMessagesWithToolDetails)', 'hydratedMessages={visibleMessages}',
      'stewardSession?.id === sessionId', 'canShowModelControl && (!stewardMode || stewardShowModel)',
      'canShowReasoningEffort && (!stewardMode || stewardShowEffort)')).toBe(true)
    expect(has(read('../components/chat/webview/chatMessageRendering.js'), 'msg-divider')).toBe(true)
  })

  it('renders the steward conversation view as an ordinary message list, never the technical transcript', () => {
    const chat = read('../features/chat/screens/ChatScreen.tsx')
    expect(has(chat, 'stewardConversationView ?', '<StewardConversationColumn', 'hideStopButton={stewardConversationView}')).toBe(true)
    expect(chat).toContain('ready: !chatLoading && chatSessionId === sessionId')
    const column = read('../features/steward/components/StewardConversationColumn.tsx')
    expect(column).toContain('content ?? <StewardMessageList')
    const composer = read('../features/chat/components/ChatComposer.tsx')
    expect(has(composer, 'hideStopButton', '!hideStopButton && shouldShowChatStopButton(')).toBe(true)
  })
})
