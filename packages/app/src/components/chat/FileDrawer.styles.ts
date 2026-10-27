// @arch docs/design/foundations.md#移动端存量界面第一轮收敛
// @test src/__tests__/mobile-typography.test.ts
import { Platform, StyleSheet } from 'react-native'
import { mobileTypography } from '../../theme/mobileTypography'

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: Platform.OS === 'web' ? 48 : 56,
    paddingHorizontal: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: '600',
    ...(Platform.OS !== 'web' && mobileTypography.navigationTitle),
  },
  pathText: {
    fontSize: 10,
    marginTop: 1,
    ...(Platform.OS !== 'web' && mobileTypography.metadata),
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 6,
    paddingRight: 12,
  },
  headerActionBtn: {
    width: Platform.OS === 'web' ? 28 : 44,
    height: Platform.OS === 'web' ? 28 : 44,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  editToolbar: {
    minHeight: 42,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  editToolbarText: {
    fontSize: 12,
    fontWeight: '600',
  },
  editToolbarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  editToolbarBtn: {
    minHeight: 28,
    borderRadius: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editToolbarBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  progressTrack: {
    height: 2,
    backgroundColor: 'transparent',
  },
  progressFill: {
    height: 2,
    borderRadius: 1,
  },
  pctText: {
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    minWidth: 32,
    textAlign: 'right',
  },
  errorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  errorText: {
    fontSize: 12,
    flex: 1,
  },
  retryText: {
    fontSize: 12,
    textDecorationLine: 'underline',
    marginLeft: 8,
  },
  noticeBar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  noticeText: {
    fontSize: 12,
    fontWeight: '500',
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: Platform.OS === 'web' ? 9 : 13,
    gap: 12,
    minHeight: Platform.OS === 'web' ? 40 : 60,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  list: {
    flex: 1,
    minHeight: 0,
  },
  listContent: {
    flexGrow: 1,
  },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: Platform.OS === 'web' ? 9 : 13,
    gap: 12,
    minHeight: Platform.OS === 'web' ? 40 : 60,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  entryIconFeather: {
    width: 20,
    textAlign: 'center',
  },
  entryName: {
    fontSize: 13,
    flexShrink: 1,
    ...(Platform.OS !== 'web' && mobileTypography.secondary),
  },
  entryNameDir: {
    fontWeight: Platform.OS === 'web' ? '600' : '400',
  },
  navText: {
    fontSize: 13,
    fontWeight: '500',
    ...(Platform.OS !== 'web' && mobileTypography.secondary),
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  actionIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
  },
  atText: {
    fontSize: 13,
    fontWeight: '700',
  },
  headerAtText: {
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 18,
  },
  emptyText: {
    textAlign: 'center',
    paddingVertical: 32,
    fontSize: 12,
  },
  fileDetails: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 16 },
  fileDetailIcon: {
    width: 88,
    height: 88,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  fileDetailName: { fontSize: 20, fontWeight: '600', textAlign: 'center' },
  fileDetailMeta: { fontSize: 14, textAlign: 'center' },
  fileDetailPath: { fontSize: 12, textAlign: 'center' },
  downloadFooter: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
  downloadButton: {
    minHeight: 48,
    borderRadius: 14,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  downloadButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  previewArea: {
    flex: 1,
    minHeight: 0,
  },
})
