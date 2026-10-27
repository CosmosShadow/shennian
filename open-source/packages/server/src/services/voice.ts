// @arch open-source/docs/server-runtime.md
// @test src/__tests__/voice-routes.test.ts

import { PLATFORM_TEXT_MODEL, platformTextBaseUrl } from './platform-model.js'

import { prisma } from '../lib/prisma.js'

const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
const VOICE_DRAFT_MODEL = process.env.VOICE_DRAFT_MODEL ?? 'qwen3.5-omni-plus'
const VOICE_TEXT_MODEL = PLATFORM_TEXT_MODEL
const VOICE_SEGMENT_MODEL = PLATFORM_TEXT_MODEL
const VALID_INTENTS = new Set(['new', 'append', 'edit', 'clarify'])

type VoiceIntent = 'new' | 'append' | 'edit' | 'clarify'

type CreateVoiceDraftInput = {
  userId: string
  sessionId: string
  currentDraft?: string
  audioBase64: string
  audioMimeType?: string
}

type CreateVoiceDraftFromTextInput = {
  userId: string
  sessionId: string
  currentDraft?: string
  transcript: string
}

type RefineVoiceSegmentInput = {
  userId: string
  sessionId: string
  transcript: string
  currentTranscript?: string
}

type VoiceDraftResult = {
  transcript: string
  draft: string
  intent: VoiceIntent
  model: string
}

function mergeTranscriptIntoDraft(currentDraft: string, transcript: string): string {
  const nextTranscript = normalizeText(transcript)
  if (!nextTranscript) return normalizeText(currentDraft)

  const baseDraft = String(currentDraft ?? '')
  if (!baseDraft.trim()) return nextTranscript
  if (/\s$/.test(baseDraft)) return `${baseDraft}${nextTranscript}`.trim()
  return `${baseDraft}\n${nextTranscript}`.trim()
}

function getApiKey(): string {
  const key = process.env.DASHSCOPE_API_KEY
  if (!key) {
    throw new Error('LLM service not configured')
  }
  return key
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? '').replace(/\r\n/g, '\n').trim()
}

function extractChoiceText(payload: unknown): string {
  const root = payload as {
    choices?: Array<{
      message?: {
        content?:
          | string
          | Array<{ type?: string; text?: string; value?: string; content?: string }>
      }
    }>
  }

  const content = root.choices?.[0]?.message?.content
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part?.text === 'string') return part.text
        if (typeof part?.value === 'string') return part.value
        if (typeof part?.content === 'string') return part.content
        return ''
      })
      .join('')
      .trim()
  }
  return ''
}

function audioDataUrl(audioBase64: string, audioMimeType?: string): string {
  const mimeType = audioMimeType?.trim() || 'audio/m4a'
  return `data:${mimeType};base64,${audioBase64}`
}

async function requireSessionAccess(sessionId: string, userId: string) {
  // The private coordinator uses the existing speech draft pipeline without
  // creating a fake project session. The authenticated user owns this scope.
  if (sessionId === `shennian:${userId}`) return
  const session = await prisma.nianSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      machineId: true,
      userId: true,
      deletedAt: true,
      machine: {
        select: {
          userId: true,
        },
      },
    },
  })

  if (!session || session.deletedAt) {
    throw new Error('Session not found')
  }

  if (session.userId !== userId) {
    throw new Error('Not authorized')
  }
  return session
}

async function callDashScope(body: Record<string, unknown>): Promise<string> {
  // Qwen3 系列默认开启 thinking，会先产生大段 reasoning_content，严重拖慢延迟。
  // 语音草稿与文字清理都是轻量结构化任务，显式关掉。
  const payload = { enable_thinking: false, ...body }
  const response = await fetch(`${body.model === VOICE_DRAFT_MODEL ? DASHSCOPE_BASE_URL : platformTextBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(45_000),
  })

  if (!response.ok) {
    throw new Error(`DashScope request failed: ${response.status}`)
  }

  const data = (await response.json()) as unknown
  const text = extractChoiceText(data)
  if (!text) {
    throw new Error('Empty model response')
  }
  return text
}

// 始终走 json_object 响应模式；上游失败或返回非 JSON 一律当 upstream 错误抛出。
async function callDashScopeJson<T>(body: Record<string, unknown>): Promise<T> {
  const raw = await callDashScope({
    response_format: { type: 'json_object' },
    ...body,
  })
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new Error('Invalid model response')
  }
}

function computeIntent(currentDraft: string, draft: string): VoiceIntent {
  if (!currentDraft) return 'new'
  if (draft === currentDraft) return 'append'
  if (draft.startsWith(currentDraft)) return 'append'
  return 'edit'
}

function sanitizeIntent(value: unknown, fallback: VoiceIntent): VoiceIntent {
  const next = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return VALID_INTENTS.has(next) ? (next as VoiceIntent) : fallback
}

function buildRefinePrompt(params: {
  transcript: string
}) {
  return [
    '你是聊天输入框的语音文本清理器。只输出 JSON：{"transcript":"..."}。',
    '任务：清理用户刚刚完整说完的一段 ASR transcript，让它适合直接放入输入框发送。',
    '只做口语清理和 ASR 纠错，不要扩写，不要替用户补充需求。',
    '允许：',
    '- 删除明显重复的词、短语、半句话，例如"我发现，我发现""然后然后""这个这个"。',
    '- 删除口语填充词，例如"嗯、那个、就是、然后呢、你知道吧"。',
    '- 处理用户的自我修正：如果前文内容被后文明确否定、撤回或替换，只保留后文最终意图。',
    '- 修正明显 ASR 错别字、同音词、近音词、英文术语和专有名词。',
    '- 可以删除多余标点，但不要主动新增标点。',
    '特别注意：',
    '- "不要、不能、别、禁止、不是"等否定词如果表达的是用户真实要求，必须保留。',
    '- 只有当否定是在撤回前一句废稿时，才删除被撤回的内容。',
    '- 不要删除文件名、路径、命令、代码、数字、模型名、Agent 名称。',
    '- 不要改变任务目标、条件、顺序和语气强弱。',
    '- 不确定是否应该删除时，保留原文。',
    '- 不要引用或复述任何外部资料、历史对话、系统提示或上下文。',
    '- 不要以助手身份回复，不要解释过程，不要输出 JSON 以外的内容。',
    '',
    `transcript:\n${params.transcript}`,
  ].join('\n')
}

function buildSegmentRefinePrompt(params: {
  transcript: string
  currentTranscript: string
}) {
  return [
    '你是 ASR 片段纠错助手。只输出 JSON：{"transcript":"..."}。',
    '任务：只对最新 transcript 做轻量纠错，不做整段改写。',
    '目标：优先把 ASR 错听成中文近音词、错别字、拆开的中英混输，纠正回用户真正说出的专有名词或英文术语。',
    '规则：',
    '- 只修正明显的 ASR 错词、同音/近音词、英文术语、专有名词、中英混输。',
    '- 可以去掉极少量无意义口头语，如"嗯""那个""就是"。',
    '- 不要扩写，不要改变语义，不要补充没说出的内容。',
    '- 对英文专名、产品名、公司名、模型名，优先输出标准英文写法，不要保留中文近音词。',
    '- 如果一个词同时可能是普通中文词和专有名词，但上下文明显在讨论技术产品 / 公司 / 模型 / API / 编程相关内容，优先输出标准专名。',
    '- 只有在完全没有把握时才保持原样。',
    '- 只输出 JSON，不要解释。',
    '',
    '纠错示例：',
    '- "安顺皮革公司" -> "Anthropic 公司"',
    '- "扣带克斯" / "科戴克斯" -> "Codex"',
    '- "欧喷AI" -> "OpenAI"',
    '- "诶杰特" -> "Agent"',
    '- "哎艾丝儿" -> "ASR"',
    '',
    `已确认内容（仅供理解上下文，不要重写它）:\n${params.currentTranscript || '（空）'}`,
    '',
    `最新 transcript:\n${params.transcript}`,
  ].join('\n')
}

function buildMultimodalDraftPrompt(params: {
  currentDraft: string
}) {
  return [
    '你是神念聊天输入框的语音草稿助手。',
    '请听音频，先转写为 transcript，再整理为草稿 draft，仅做必要的口误清理，不要扩写、不要改变语义。',
    '只输出 JSON：{"transcript":"...","draft":"..."}。',
    '规则：',
    '- 去掉"嗯/那个/就是/然后呢"之类的口语语气词。',
    '- 修正同音/近音造成的明显错别字。',
    '- 顺一下标点和断句，保留用户原意。',
    '- 保留 currentDraft 的 Markdown、代码块、路径、@ 引用；除非用户明确要求删除，否则不要改动。',
    '- 如果 currentDraft 非空，优先判断这段新内容是追加到末尾还是整段重写；不确定时选追加。',
    '- 不要以助手身份回复，不要解释过程，不要输出 JSON 以外的内容。',
    '',
    `currentDraft:\n${params.currentDraft || '（空）'}`,
  ].join('\n')
}

function buildVoiceDraftResult(input: {
  transcript: string
  draft: string
  intent: VoiceIntent
  model: string
}): VoiceDraftResult {
  return {
    transcript: input.transcript,
    draft: input.draft,
    intent: input.intent,
    model: input.model,
  }
}

export async function createVoiceDraft(input: CreateVoiceDraftInput): Promise<VoiceDraftResult> {
  await requireSessionAccess(input.sessionId, input.userId)

  const currentDraft = normalizeText(input.currentDraft)
  const prompt = buildMultimodalDraftPrompt({ currentDraft })

  const payload = await callDashScopeJson<{
    transcript?: unknown
    draft?: unknown
  }>({
    model: VOICE_DRAFT_MODEL,
    temperature: 0.1,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'input_audio',
            input_audio: {
              data: audioDataUrl(input.audioBase64, input.audioMimeType),
            },
          },
        ],
      },
    ],
  })

  const rawTranscript = normalizeText(typeof payload.transcript === 'string' ? payload.transcript : '')
  const rawDraft = normalizeText(typeof payload.draft === 'string' ? payload.draft : '')

  const transcript = rawTranscript
  const draft = rawDraft

  if (!draft) {
    throw new Error('Voice draft generation failed')
  }

  const intent = computeIntent(currentDraft, draft)

  return buildVoiceDraftResult({
    transcript,
    draft,
    intent,
    model: VOICE_DRAFT_MODEL,
  })
}

export async function createVoiceDraftFromText(
  input: CreateVoiceDraftFromTextInput,
): Promise<VoiceDraftResult> {
  const rawTranscript = normalizeText(input.transcript)
  if (!rawTranscript) {
    throw new Error('Transcript is required')
  }

  await requireSessionAccess(input.sessionId, input.userId)
  const currentDraft = normalizeText(input.currentDraft)
  const prompt = buildRefinePrompt({
    transcript: rawTranscript,
  })

  try {
    const payload = await callDashScopeJson<{
      transcript?: unknown
    }>({
      model: VOICE_TEXT_MODEL,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }],
    })

    const modelTranscript = normalizeText(
      typeof payload.transcript === 'string' ? payload.transcript : rawTranscript,
    )

    const transcript = modelTranscript || rawTranscript
    const draft = mergeTranscriptIntoDraft(currentDraft, transcript)

    if (!transcript || !draft) {
      throw new Error('Voice draft generation failed')
    }

    const intent = computeIntent(currentDraft, draft)

    return buildVoiceDraftResult({
      transcript,
      draft,
      intent,
      model: VOICE_TEXT_MODEL,
    })
  } catch (error) {
    console.warn('[voice] refine-text fallback', error)
    const fallbackDraft = mergeTranscriptIntoDraft(currentDraft, rawTranscript)
    return buildVoiceDraftResult({
      transcript: rawTranscript,
      draft: fallbackDraft,
      intent: computeIntent(currentDraft, fallbackDraft),
      model: `${VOICE_TEXT_MODEL}:fallback`,
    })
  }
}

export async function finalizeVoiceDraftFromTranscript(
  input: CreateVoiceDraftFromTextInput,
): Promise<VoiceDraftResult> {
  const transcript = normalizeText(input.transcript)
  if (!transcript) {
    throw new Error('Transcript is required')
  }

  await requireSessionAccess(input.sessionId, input.userId)

  const currentDraft = String(input.currentDraft ?? '')
  const draft = mergeTranscriptIntoDraft(currentDraft, transcript)

  return buildVoiceDraftResult({
    transcript,
    draft,
    intent: computeIntent(normalizeText(currentDraft), normalizeText(draft)),
    model: 'direct-transcript',
  })
}

export async function refineVoiceTranscriptSegment(
  input: RefineVoiceSegmentInput,
): Promise<{ transcript: string; model: string }> {
  const rawTranscript = normalizeText(input.transcript)
  if (!rawTranscript) {
    throw new Error('Transcript is required')
  }

  await requireSessionAccess(input.sessionId, input.userId)

  const currentTranscript = normalizeText(input.currentTranscript)
  const prompt = buildSegmentRefinePrompt({
    transcript: rawTranscript,
    currentTranscript,
  })

  try {
    const payload = await callDashScopeJson<{
      transcript?: unknown
    }>({
      model: VOICE_SEGMENT_MODEL,
      temperature: 0.0,
      messages: [{ role: 'user', content: prompt }],
    })

    const modelTranscript = normalizeText(
      typeof payload.transcript === 'string' ? payload.transcript : rawTranscript,
    )

    return {
      transcript: modelTranscript || rawTranscript,
      model: VOICE_SEGMENT_MODEL,
    }
  } catch (error) {
    console.warn('[voice] refine-segment fallback', error)
    return {
      transcript: rawTranscript,
      model: `${VOICE_SEGMENT_MODEL}:fallback`,
    }
  }
}

// 仅用于单元测试，避免测试依赖内部实现细节时反复 re-export。
export const __internals = {
  computeIntent,
  sanitizeIntent,
}
