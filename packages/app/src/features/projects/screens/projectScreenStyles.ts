// @arch docs/architecture/session-organization.md
// @test packages/app/src/__tests__/project-launch-entry.test.ts

import { Platform, StyleSheet } from 'react-native'
import { mobileTypography } from '../../../theme/mobileTypography'

export const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: {
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  launchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unavailableAction: {
    opacity: 0.45,
  },
  launchBtnExpanded: {
    height: 36,
    borderRadius: 18,
    paddingHorizontal: 10,
    gap: 4,
  },
  launchBtnText: {
    fontSize: 13,
    fontWeight: '700',
    flexShrink: 1,
  },
  headerCenter: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    textAlign: 'center',
  },
  sessionSectionTitle: { fontSize: 13, paddingHorizontal: 18, paddingTop: 20, paddingBottom: 8 },
  actionsOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.22)',
  },
  actionsBackdrop: { ...StyleSheet.absoluteFillObject },
  actionsScroll: { flexShrink: 1, minHeight: 0 },
  actionsOverlaySheet: {
    justifyContent: 'flex-end',
  },
  actionsOverlayPopover: {
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 56,
    paddingRight: 12,
  },
  actionsCard: {
    flexShrink: 1,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.16,
    shadowRadius: 28,
    elevation: 18,
  },
  actionsSheetCard: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 16,
    paddingBottom: 22,
  },
  actionsPopoverCard: {
    width: 320,
    borderRadius: 20,
    padding: 12,
  },
  actionsContent: {
    gap: 10,
  },
  actionsHeader: {
    flexShrink: 0,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 4,
  },
  actionsTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    ...(Platform.OS !== 'web' && mobileTypography.navigationTitle),
  },
  inlineLaunchPanel: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    padding: 12,
    gap: 12,
  },
  inlineLaunchPath: {
    fontSize: 12,
    lineHeight: 16,
    ...(Platform.OS !== 'web' && mobileTypography.metadata),
  },
  inlineLaunchButton: {
    alignSelf: 'stretch',
    marginTop: 16,
  },
  launchSelectionSection: {
    gap: 8,
  },
  launchAgentHeading: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  launchAgentRefresh: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  projectDefaultSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
    gap: 10,
  },
  projectDefaultCopy: {
    gap: 3,
  },
  projectDefaultTitleButton: {
    minHeight: 28,
    alignSelf: 'flex-start',
    justifyContent: 'center',
  },
  projectDefaultCurrentRow: {
    minHeight: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  projectDefaultCurrentValue: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
    ...(Platform.OS !== 'web' && mobileTypography.body),
  },
  projectDefaultHint: {
    fontSize: 13,
    lineHeight: 19,
    ...(Platform.OS !== 'web' && mobileTypography.metadata),
  },
  projectDefaultButton: {
    minHeight: 38,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  projectDefaultButtonText: {
    fontSize: 13,
    fontWeight: '700',
    ...(Platform.OS !== 'web' && mobileTypography.compactAction),
  },
  secondaryAction: {
    minHeight: 64,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  actionIconSecondary: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  secondaryActionText: {
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryActionHint: {
    fontSize: 12,
    lineHeight: 16,
  },
})
