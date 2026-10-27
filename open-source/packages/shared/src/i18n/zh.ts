import { zhPersonalModel } from './zh-personal-model'
import { zhProjectCoordination } from './zh-project-coordination'
import { zhInspiration } from './zh-inspiration'
import personalWorkspace from './zh-personal-workspace'
import { zhRemoteFolders } from './zh-remote-folders'
import { zhPersonalModules } from './zh-personal-modules'
import { zhInteractiveContent } from './zh-interactive-content'
import { zhAgentSetup } from './zh-agent-setup'
import { zhSetup } from './zh-setup'
import { zhSchedules } from './zh-schedules'
import { zhChatPreferences } from './zh-chat-preferences'
import { zhDocs } from './zh-docs'
// @arch open-source/docs/shared-runtime.md
// @test src/__tests__/i18n-reasoning-effort.test.ts
import { zhCorePart1 } from './zh-core-part-1'
import { zhCorePart2 } from './zh-core-part-2'
import { zhCorePart3 } from './zh-core-part-3'
import { zhCorePart4 } from './zh-core-part-4'
import { zhCorePart5 } from './zh-core-part-5'

const base = {
  mobile_home_no_recording: '暂无本地记录',
  mobile_home_no_schedules: '暂无待办日程',
  mobile_home_open_schedules: '打开查看日程',
  mobile_home_no_diary: '暂无已同步日记',
  mobile_home_no_folders: '尚未添加文件夹',
  mobile_home_settings: '神念首页',
  mobile_home_settings_hint: '控制首页入口的显示。隐藏后仍可从神念对话右上角「…」的全部功能进入，不会删除内容或停止记录和任务。',
  mobile_recording_active: '正在全天候记录',
  ...zhProjectCoordination,
  ...zhInspiration,
  mobile_features_show_list: '切换为列表',
  mobile_features_show_grid: '切换为网格',
  mobile_features: '更多',
  mobile_all_features: '全部功能',
  mobile_navigation_manage: '管理',
  mobile_customize_navigation: '自定义底部导航',
  mobile_customize_navigation_hint: '把常用功能放到底部，打开更方便。',
  mobile_bottom_navigation: '底部导航',
  mobile_schedules: '日程',
  mobile_my_computers: '我的电脑',
  mobile_ai_plaza: 'AI 广场',
  mobile_my_agents: '智能体',
  mobile_search_features: '搜索功能',
  mobile_features_empty: '没有找到相关功能',
  mobile_navigation_hint: '神念必须保留，可与其他入口一起排序，最多 {{count}} 个。只保留神念时隐藏底栏。',
  mobile_navigation_selected: '已添加',
  mobile_navigation_available: '可添加',
  mobile_navigation_drag_hint: '拖动到底栏添加，左右拖动排序，拖出底栏移除。',
  mobile_navigation_drag_guide: '拖入底栏添加 · 左右拖动排序 · 拖出移除',
  mobile_navigation_required_hint: '神念是必选入口，可以左右拖动排序，不能移除。',
  mobile_navigation_fixed: '固定',
  mobile_navigation_move_up: '上移{{name}}',
  mobile_navigation_move_down: '下移{{name}}',
  mobile_navigation_remove: '移除{{name}}',
  mobile_navigation_add: '添加{{name}}',
  mobile_navigation_limit: '底部最多放置 {{count}} 个入口，请先移除一个。',
  mobile_navigation_reset: '恢复默认',
  mobile_navigation_save_failed: '保存失败，请重试。',

  render_failure_title: '此部分暂时无法显示',
  render_failure_body: '其他功能仍可使用，请重试或返回。',
  render_failure_auto_leave: '{{seconds}} 秒后自动返回，也可以立即重试或返回。',
  render_failure_retry: '重试',
  render_failure_leave: '返回',

  ...zhAgentSetup,
  ...zhSetup,
  ...zhCorePart1,
  ...zhSchedules,
  ...zhCorePart2,
  ...zhCorePart3,
  ...zhCorePart4,
  ...zhCorePart5,
} as const

export default {
  ...zhPersonalModel,
  ...personalWorkspace,
  ...zhRemoteFolders,
  ...zhPersonalModules,
  ...zhInteractiveContent,
  ...base,
  ...zhChatPreferences,
  ...zhDocs,
} as const
