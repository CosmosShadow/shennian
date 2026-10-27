// @covers packages/app/src/features/chat/components/SessionDetailsModal.tsx
// @covers packages/app/src/features/chat/screens/ChatScreen.tsx
// @covers packages/app/src/features/schedules/scheduleVisibility.ts
// @covers packages/app/src/features/schedules/ConversationSchedules.tsx

import { readChatScreenSource } from './chat-screen-source-test-helper'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canShowSessionSchedules, hasActiveSchedule } from '../features/schedules/scheduleVisibility'
import type { LinkedRoomBindingView } from '../features/rooms/types'
import type { ConversationSchedule } from '@shennian/wire'

const read = (relative: string) => readFileSync(resolve(__dirname, relative), 'utf8')

describe('Session details modal', () => {
  it('only exposes scheduling for an owned agent in an active managed Room', () => {
    const activeBinding = {
      id: 'binding-1',
      status: 'active',
      activationMode: 'mention_only',
      agentDisplayName: 'Manager',
      room: { id: 'room-1', name: 'Project', status: 'active' },
    } as LinkedRoomBindingView

    expect(canShowSessionSchedules(true, undefined, null)).toBe(false)
    expect(canShowSessionSchedules(true, undefined, activeBinding)).toBe(false)
    expect(canShowSessionSchedules(true, 'agent-1', null)).toBe(false)
    expect(canShowSessionSchedules(false, 'agent-1', activeBinding)).toBe(false)
    expect(canShowSessionSchedules(true, 'agent-1', activeBinding)).toBe(true)
    expect(canShowSessionSchedules(true, 'agent-1', { ...activeBinding, status: 'detached' })).toBe(
      false,
    )
    expect(
      canShowSessionSchedules(true, 'agent-1', {
        ...activeBinding,
        room: { ...activeBinding.room, status: 'archived' },
      }),
    ).toBe(false)
  })

  it('hides the scheduled-tasks section once loaded with zero active tasks, keeping loading/failure visible', () => {
    const schedules = read('../features/schedules/ConversationSchedules.tsx')

    const guard = 'if (!alwaysShow && !loading && !failed && tasks.length === 0) return null'
    expect(schedules).toContain(guard)
    const guardIndex = schedules.indexOf(guard)
    expect(guardIndex).toBeGreaterThan(-1)
    expect(guardIndex).toBeLessThan(schedules.indexOf('embeddedSummary'))
    expect(guardIndex).toBeLessThan(schedules.indexOf("t('schedules_title')"))
    // The promotional "ask your agent to schedule a task" hint no longer renders for an empty
    // conversation/Room list (the guard above short-circuits those two call sites); it only
    // reappears behind the explicit alwaysShow escape hatch used by the steward settings page,
    // which is a dedicated "定时任务" entry rather than an embedded hint prone to new-user clutter.
    expect(schedules).toContain('alwaysShow && !loading && !failed && tasks.length === 0')
    expect(schedules).toContain('schedules_hint')
    expect(schedules).toContain('if (embedded && (loading || failed))')
    expect(schedules).toContain("t('schedules_failed')")
  })

  it('hides the Desktop schedule menu for the default empty state and preserves historical management', () => {
    const desktop = read('../features/desktop-chat/DesktopChatScreenView.tsx')
    const scheduleHook = read('../features/schedules/useHasActiveSchedules.ts')
    const task = (state: ConversationSchedule['state']) => ({ state }) as ConversationSchedule

    expect(hasActiveSchedule([])).toBe(false)
    expect(hasActiveSchedule([task('ended')])).toBe(false)
    expect(hasActiveSchedule([task('deleted')])).toBe(false)
    expect(hasActiveSchedule([task('active')])).toBe(true)
    expect(hasActiveSchedule([task('paused')])).toBe(true)

    expect(desktop).toContain('useHasActiveSchedules(')
    expect(desktop).toContain('const showSessionSchedules = canManageSessionSchedules && hasActiveSchedules')
    expect(desktop).toContain("...(showSessionSchedules ? [{ label: t('schedules_title')")
    expect(desktop).toContain('<ConversationSchedules sessionId={sessionId} showHeading={false} />')
    expect(desktop).toContain('refreshHasActiveSchedules()')
    expect(scheduleHook).toContain('if (active) setHasActiveSchedules(true)')
  })

  it('uses one compact bottom sheet with only durable conversation actions', () => {
    const modal = read('../features/chat/components/SessionDetailsModal.tsx')
    const chat = readChatScreenSource()

    expect(modal).toContain("justifyContent: 'flex-end'")
    expect(modal).toContain('showDesktopInspector ? 16 : Math.max(insets.bottom, 10)')
    expect(modal).toContain('width: 32')
    expect(modal).toContain('height: 32')
    expect(modal).toContain('borderRadius: 16')
    expect(modal).toContain('closeText: { fontSize: 15 }')
    expect(modal).toContain('desktopInspector?: boolean')
    expect(modal).toContain('showDesktopInspector && styles.inspectorOverlay')
    expect(modal).toContain('showDesktopInspector && styles.inspectorTitle')
    expect(modal).toContain('styles.summaryCard')
    expect(modal).toContain('styles.actionGroup')
    expect(modal).toContain('styles.dangerGroup')
    expect(modal).toContain("label={t('file_browser')}")
    expect(modal).toContain("label={t('rename_session')}")
    expect(modal).toContain("label={t('delete_session')}")
    expect(modal).toContain('managedAgent && onRestart')
    expect(modal).toContain(
      "label={restartBusy ? t('session_restart_busy') : t('session_restart')}",
    )
    expect(modal).toContain('agentDescription')
    expect(modal).toContain('ownerAvatar={agentOwnerAvatar}')
    expect(modal).not.toContain("t('session_restart_hint')")
    expect(modal).toContain('<SessionRuntimeRow')
    expect(modal).toContain("label={t('agents_file_access')}")
    expect(modal).toContain("label={t('agents_external_capabilities')}")
    expect(modal).toContain("label={t('agents_run_access')}")
    expect(modal).toContain("value={t('agents_run_access_full')}")
    expect(modal).toContain("managedAgentExecutionMode(permissionPolicy) === 'native-full'")
    expect(modal).toContain('formatExternalCapabilities')
    expect(modal).toContain("return t('agents_external_disabled')")
    expect(modal).not.toContain('resolveManagedAgentEffectivePermissionPolicy')
    expect(modal).toContain('permissionPolicy.externalCapabilities[capability]')
    expect(modal).toContain("t('session_runtime_loading')")
    expect(modal).toContain("t('session_runtime_load_failed')")
    expect(modal).toContain("? 'session_details_managed_agent'")
    expect(modal).toContain(": 'session_details_accessibility'")
    expect(modal).not.toContain("label={t('agents_protection')}")
    expect(modal).toContain("label={t('session_work_mode')}")
    expect(modal).toContain("sessionMode === 'manager'")
    expect(modal).toContain('canManage && !managedAgent')
    expect(modal).toContain('{!managedAgent ? (')
    expect(modal).toContain('ellipsizeMode="middle"')
    expect(modal.indexOf("t('agents_machine')")).toBeLessThan(
      modal.indexOf("t('agents_work_directory')"),
    )
    expect(modal.indexOf("t('agents_work_directory')")).toBeLessThan(
      modal.indexOf("t('agents_runtime')"),
    )
    expect(modal.indexOf("t('agents_runtime')")).toBeLessThan(modal.indexOf("t('agents_model')"))
    expect(chat).toContain('workspaceAgentOwnerAvatar')
    expect(chat).not.toContain("t('session_restart_confirm_title', { agent: agentName })")
    expect(chat).not.toContain("t('session_restart_confirm')")
    expect(chat).not.toContain('onRestart=')
    expect(chat).toContain('permissionPolicy={managedAgentProfile?.permissionPolicy}')
    expect(chat).not.toContain('runtimeProtection={')
    expect(chat).toContain('sessionAccountClient.getSession(sessionId)')
    expect(chat).toContain('upsertSession(roomSession)')
    expect(chat).toContain('roomSession.agentIdentityId !== workspaceAgentIdentityId')
    expect(chat).toContain("setRoomSessionState('failed')")
    expect(chat).toContain("machine?.name ?? session?.machineName ?? ''")
    expect(chat).toContain("effectiveAgentIdentityId ? t('agents_default_model') : ''")
    expect(chat).toContain("sessionMode={session?.sessionMode ?? 'standard'}")
    expect(chat).not.toContain('managedAgentProfile?.sessionMode')
    expect(chat).toContain('managedAgentProfile?.runtimeAdapter')

    expect(modal).not.toContain("t('web_share_publish')")
    expect(modal).toContain('{!managedAgent ? (')
    expect(modal).not.toContain("label={t('refresh_session')}")
    expect(modal).not.toContain("label={t('copy')}")
    expect(modal).not.toContain("t('long_screenshot')")
    expect(modal).not.toContain("t('pin_session')")
    expect(modal).not.toContain("t('mark_unread')")
    expect(modal).not.toContain("t('spaces_add_agent_to_room')")
    expect(chat).not.toContain('onOpenWebShare=')
    expect(chat).not.toContain('onLongScreenshot=')
    expect(chat).not.toContain('onTogglePin=')
    expect(chat).not.toContain('onToggleUnread=')
  })
})
