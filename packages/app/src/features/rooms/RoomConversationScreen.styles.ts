// @arch docs/features/network-rooms/ui.md#五web--desktop-web
// @test src/__tests__/room-message-layout.test.ts

import { StyleSheet } from 'react-native'

export const roomConversationStyles = StyleSheet.create({
  root: { flex: 1 },
  keyboardView: { flex: 1, minHeight: 0 },
  layout: { flex: 1, minHeight: 0, flexDirection: 'row' },
  conversation: { flex: 1, minWidth: 0, minHeight: 0 },
  composerMenuBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  header: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 0,
  },
  headerButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  detailsButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  title: { maxWidth: '100%', fontSize: 14, lineHeight: 19, fontWeight: '500' },
  mobileTitle: { fontSize: 16, lineHeight: 21, fontWeight: '600' },
  offlineBanner: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  offlineText: { flexShrink: 1, fontSize: 12, lineHeight: 17, textAlign: 'center' },
  messages: { flex: 1 },
  messageContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    width: '100%',
    maxWidth: 860,
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingBottom: 14,
  },
  messageHeader: { marginBottom: 8 },
  messageSeparator: { height: 8 },
  messageFooter: { height: 14 },
  loadOlder: {
    minHeight: 36,
    alignSelf: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    paddingHorizontal: 16,
  },
  loadOlderText: { fontSize: 12, fontWeight: '600' },
  details: { width: 300, borderLeftWidth: StyleSheet.hairlineWidth },
  loadState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 10 },
  loadTitle: { fontSize: 16, fontWeight: '600' },
})
