// @arch open-source/docs/server-runtime.md
// @test src/__tests__/voice-chief-ws.test.ts

import {
  hangUpVoiceCall,
  HANG_UP_CALL_TOOL,
  loadVoiceChiefProjects,
} from './voice-chief-control.js'
import {
  continueTaskFromVoice,
  createTaskFromVoice,
  inspectTaskFromVoice,
  listProjectTasksFromVoice,
  stopTaskFromVoice,
} from './voice-chief-task-router.js'
import { VOICE_SHENNIAN_V5_TASK_TOOLS } from './voice-chief-v5.js'

export type VoiceChiefCallToolEffect = { type: 'none' } | { type: 'hang_up_now'; reason: string }

type VoiceChiefProjects = Awaited<ReturnType<typeof loadVoiceChiefProjects>>

type VoiceChiefV5Args = {
  projectRef?: string
  taskRef?: string
  instruction?: string
  page?: number
  reason?: string
}

function parseArguments(argumentsJson: string): VoiceChiefV5Args | null {
  try {
    const value = JSON.parse(argumentsJson || '{}')
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as VoiceChiefV5Args)
      : null
  } catch {
    return null
  }
}

function requiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function isVoiceChiefExecutableTool(name: string): boolean {
  return (
    VOICE_SHENNIAN_V5_TASK_TOOLS.some((tool) => tool.name === name) ||
    name === HANG_UP_CALL_TOOL.name
  )
}

export async function executeVoiceChiefCallTool(params: {
  name: string
  argumentsJson: string
  userId: string
  chiefConversationId: string
  /** Stable for the whole phone call; distinct from the model tool-call id. */
  voiceCallId: string
  callId: string
  operationId?: string
  projects: VoiceChiefProjects
}): Promise<{
  result: unknown
  projects: VoiceChiefProjects
  effect: VoiceChiefCallToolEffect
}> {
  const args = parseArguments(params.argumentsJson)
  if (!args) {
    return {
      result: { status: 'failed', message: '工具参数无效。' },
      projects: params.projects,
      effect: { type: 'none' },
    }
  }
  if (params.name === HANG_UP_CALL_TOOL.name) {
    const reason = requiredString(args.reason) ?? 'AI 结束通话。'
    return {
      result: hangUpVoiceCall({ reason }),
      projects: params.projects,
      effect: { type: 'hang_up_now', reason },
    }
  }
  if (!VOICE_SHENNIAN_V5_TASK_TOOLS.some((tool) => tool.name === params.name)) {
    return {
      result: { status: 'failed', message: `不支持的工具：${params.name}` },
      projects: params.projects,
      effect: { type: 'none' },
    }
  }

  const projects = await loadVoiceChiefProjects(params.userId)
  const projectRef = requiredString(args.projectRef)
  const taskRef = requiredString(args.taskRef)
  const instruction = requiredString(args.instruction)
  let result: unknown

  if (params.name === 'list_project_tasks') {
    result = projectRef
      ? await listProjectTasksFromVoice({
          userId: params.userId,
          projects,
          projectRef,
          page: args.page,
        })
      : { status: 'failed', message: '缺少项目引用。' }
  } else if (params.name === 'read_task') {
    result = taskRef
      ? await inspectTaskFromVoice({
          userId: params.userId,
          projects,
          taskRef,
          callId: params.voiceCallId,
        })
      : { status: 'failed', message: '缺少任务引用。' }
  } else if (params.name === 'create_task') {
    result =
      projectRef && instruction
        ? await createTaskFromVoice({
            userId: params.userId,
            projects,
            projectRef,
            instruction,
            chiefConversationId: params.chiefConversationId,
            callId: params.callId,
            operationId: params.operationId,
          })
        : { status: 'failed', message: '缺少项目引用或任务指令。' }
  } else if (params.name === 'continue_task') {
    result =
      taskRef && instruction
        ? await continueTaskFromVoice({
            userId: params.userId,
            projects,
            taskRef,
            instruction,
            chiefConversationId: params.chiefConversationId,
            callId: params.callId,
          })
        : { status: 'failed', message: '缺少任务引用或后续指令。' }
  } else if (params.name === 'stop_task') {
    result = taskRef
      ? await stopTaskFromVoice({ userId: params.userId, projects, taskRef })
      : { status: 'failed', message: '缺少任务引用。' }
  } else {
    result = { status: 'failed', message: `不支持的工具：${params.name}` }
  }

  return { result, projects, effect: { type: 'none' } }
}
