import { enPersonalModel } from './en-personal-model'
import { enProjectCoordination } from './en-project-coordination'
import { enInspiration } from './en-inspiration'
import personalWorkspace from './en-personal-workspace'
import { enRemoteFolders } from './en-remote-folders'
import { enPersonalModules } from './en-personal-modules'
import { enInteractiveContent } from './en-interactive-content'
import { enAgentSetup } from './en-agent-setup'
import { enSetup } from './en-setup'
import { enSchedules } from './en-schedules'
import { enChatPreferences } from './en-chat-preferences'
import { enDocs } from './en-docs'
// @arch open-source/docs/shared-runtime.md
// @test src/__tests__/i18n-reasoning-effort.test.ts
import { enCorePart1 } from './en-core-part-1'
import { enCorePart2 } from './en-core-part-2'
import { enCorePart3 } from './en-core-part-3'
import { enCorePart4 } from './en-core-part-4'
import { enCorePart5 } from './en-core-part-5'

const base = {
  mobile_home_no_recording: 'No recordings saved here yet',
  mobile_home_no_schedules: 'No upcoming events',
  mobile_home_open_schedules: 'Open calendar',
  mobile_home_no_diary: 'No synced diary entries yet',
  mobile_home_no_folders: 'No folders added yet',
  mobile_home_settings: 'Shennian home',
  mobile_home_settings_hint: 'Choose which shortcuts appear on your home screen. Hidden features remain in All features in the Shennian conversation’s More menu. Hiding a shortcut does not delete content or stop recording or tasks.',
  mobile_recording_active: 'Recording in progress',
  ...enProjectCoordination,
  ...enInspiration,
  mobile_features_show_list: 'Switch to list view',
  mobile_features_show_grid: 'Switch to grid view',
  mobile_features: 'More',
  mobile_all_features: 'All features',
  mobile_navigation_manage: 'Manage',
  mobile_customize_navigation: 'Customize bottom navigation',
  mobile_customize_navigation_hint: 'Keep frequently used features in the bottom bar for quicker access.',
  mobile_bottom_navigation: 'Bottom navigation',
  mobile_schedules: 'Schedule',
  mobile_my_computers: 'My Computers',
  mobile_ai_plaza: 'AI Plaza',
  mobile_my_agents: 'Agents',
  mobile_search_features: 'Search features',
  mobile_features_empty: 'No matching features',
  mobile_navigation_hint: 'Keep Shennian in the bar. Reorder any shortcut, up to {{count}} tabs. With only Shennian, the bottom bar is hidden.',
  mobile_navigation_selected: 'Added',
  mobile_navigation_available: 'Available',
  mobile_navigation_drag_hint: 'Drag into the bar to add, along the bar to reorder, or out of the bar to remove.',
  mobile_navigation_drag_guide: 'Drag in to add · Drag across to reorder · Drag out to remove',
  mobile_navigation_required_hint: 'Shennian is required. Drag across to reorder; it cannot be removed.',
  mobile_navigation_fixed: 'Fixed',
  mobile_navigation_move_up: 'Move {{name}} up',
  mobile_navigation_move_down: 'Move {{name}} down',
  mobile_navigation_remove: 'Remove {{name}}',
  mobile_navigation_add: 'Add {{name}}',
  mobile_navigation_limit: 'The bottom bar holds up to {{count}} tabs. Remove one first.',
  mobile_navigation_reset: 'Restore defaults',
  mobile_navigation_save_failed: 'Could not save. Please retry.',

  render_failure_title: 'This section could not be displayed',
  render_failure_body: 'Other parts of the app are still available. Please retry or go back.',
  render_failure_auto_leave: 'Going back in {{seconds}} seconds. You can also retry or go back now.',
  render_failure_retry: 'Retry',
  render_failure_leave: 'Go back',

  ...enAgentSetup,
  ...enSetup,
  ...enCorePart1,
  ...enSchedules,
  ...enCorePart2,
  ...enCorePart3,
  ...enCorePart4,
  ...enCorePart5,
} as const

export default {
  ...enPersonalModel,
  ...personalWorkspace,
  ...enRemoteFolders,
  ...enPersonalModules,
  ...enInteractiveContent,
  ...base,
  ...enChatPreferences,
  ...enDocs,
} as const
