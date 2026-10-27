import type { AgentType, BuiltinAgentType } from '@shennian/wire'

export const AGENT_ABBREV: Record<BuiltinAgentType, string> & Partial<Record<AgentType, string>> = {
  shennian: 'Sn', claude: 'Cl', cursor: 'Cu', gemini: 'Ge', codex: 'Cx', workbuddy: 'Wb', openclaw: '--', opencode: 'Op', pi: 'Ni', 'pi-coding-agent': 'Pi', manager: 'Mg',
}

export const AGENT_DISPLAY_NAME: Record<BuiltinAgentType, string> & Partial<Record<AgentType, string>> = {
  shennian: '神念', claude: 'Claude', cursor: 'Cursor', gemini: 'Gemini', codex: 'Codex', workbuddy: 'WorkBuddy', openclaw: 'Disabled Agent', opencode: 'opencode', pi: 'Nian', 'pi-coding-agent': 'Pi', manager: 'Manager',
}

export const AGENT_HEX: Record<BuiltinAgentType, string> & Partial<Record<AgentType, string>> = {
  shennian: '#6366f1', claude: '#f97316', cursor: '#3b82f6', gemini: '#10b981', codex: '#a855f7', workbuddy: '#2563eb', openclaw: '#f59e0b', opencode: '#14b8a6', pi: '#6366f1', 'pi-coding-agent': '#0ea5e9', manager: '#0f766e',
}

export const AGENT_BADGE_COLORS: Record<BuiltinAgentType, string> & Partial<Record<AgentType, string>> = {
  shennian: 'bg-indigo-500', claude: 'bg-orange-500', cursor: 'bg-blue-500', gemini: 'bg-emerald-500', codex: 'bg-purple-500', workbuddy: 'bg-blue-600', openclaw: 'bg-amber-500', opencode: 'bg-teal-500', pi: 'bg-indigo-500', 'pi-coding-agent': 'bg-sky-500', manager: 'bg-teal-700',
}

export const AGENT_BG_COLORS: Record<BuiltinAgentType, string> & Partial<Record<AgentType, string>> = {
  shennian: 'bg-indigo-100 dark:bg-indigo-900/20', claude: 'bg-orange-100 dark:bg-orange-900/20', cursor: 'bg-blue-100 dark:bg-blue-900/20', gemini: 'bg-emerald-100 dark:bg-emerald-900/20', codex: 'bg-purple-100 dark:bg-purple-900/20', workbuddy: 'bg-blue-100 dark:bg-blue-900/20', openclaw: 'bg-amber-100 dark:bg-amber-900/20', opencode: 'bg-teal-100 dark:bg-teal-900/20', pi: 'bg-indigo-100 dark:bg-indigo-900/20', 'pi-coding-agent': 'bg-sky-100 dark:bg-sky-900/20', manager: 'bg-teal-100 dark:bg-teal-900/20',
}

export const AGENT_TEXT_COLORS: Record<BuiltinAgentType, string> & Partial<Record<AgentType, string>> = {
  shennian: 'text-indigo-700 dark:text-indigo-400', claude: 'text-orange-700 dark:text-orange-400', cursor: 'text-blue-700 dark:text-blue-400', gemini: 'text-emerald-700 dark:text-emerald-400', codex: 'text-purple-700 dark:text-purple-400', workbuddy: 'text-blue-700 dark:text-blue-400', openclaw: 'text-amber-700 dark:text-amber-400', opencode: 'text-teal-700 dark:text-teal-400', pi: 'text-indigo-700 dark:text-indigo-400', 'pi-coding-agent': 'text-sky-700 dark:text-sky-400', manager: 'text-teal-800 dark:text-teal-300',
}

export const AGENT_RING_COLORS: Record<BuiltinAgentType, string> & Partial<Record<AgentType, string>> = {
  shennian: 'ring-2 ring-indigo-400', claude: 'ring-2 ring-orange-400', cursor: 'ring-2 ring-blue-400', gemini: 'ring-2 ring-emerald-400', codex: 'ring-2 ring-purple-400', workbuddy: 'ring-2 ring-blue-500', openclaw: 'ring-2 ring-amber-400', opencode: 'ring-2 ring-teal-400', pi: 'ring-2 ring-indigo-400', 'pi-coding-agent': 'ring-2 ring-sky-400', manager: 'ring-2 ring-teal-500',
}

export function getAgentDisplayName(type: AgentType, displayName?: string): string {
  if (typeof displayName === 'string' && displayName.trim()) return displayName.trim()
  if (typeof type !== 'string') return 'AI'
  const known = AGENT_DISPLAY_NAME[type]
  if (typeof known === 'string') return known
  return type.replace(/^(acp|custom):/, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

export function getAgentAbbreviation(type: AgentType, displayName?: string): string {
  const known = typeof type === 'string' ? AGENT_ABBREV[type] : undefined
  if (typeof known === 'string') return known
  const words = getAgentDisplayName(type, displayName).split(/\s+/).filter(Boolean)
  return (words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : words[0]?.slice(0, 2) || 'AI').toUpperCase()
}
