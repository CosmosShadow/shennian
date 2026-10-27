// @arch docs/architecture/app/chat-attachments-preview.md
// @test packages/app/src/__tests__/file-selection-ai.test.ts

export type FileSelectionAiActionId =
  | 'improve'
  | 'formal'
  | 'shorter'
  | 'longer'
  | 'translate_zh'
  | 'translate_en'
  | 'summarize'

export type FileSelectionAiAction = {
  id: FileSelectionAiActionId
  labelKey: string
  taskZh: string
  taskEn: string
}

export type FilePreviewSelection = {
  text: string
  line?: number
  endLine?: number
  rect: {
    x: number
    y: number
    width: number
    height: number
  }
}

export type FileSelectionAiRequest = {
  actionId: FileSelectionAiActionId
  filePath: string
  filename: string
  selectedText: string
}

export type FileSelectionQuoteRequest = {
  filePath: string
  filename: string
  selectedText: string
  line?: number
  endLine?: number
}

export const FILE_SELECTION_AI_ACTIONS: FileSelectionAiAction[] = [
  {
    id: 'improve',
    labelKey: 'file_ai_improve',
    taskZh: '润色这段文字，让表达更清晰、自然、专业',
    taskEn: 'Improve this text so it is clearer, more natural, and more polished',
  },
  {
    id: 'formal',
    labelKey: 'file_ai_formal',
    taskZh: '把这段文字改得更正式、更适合文档表达',
    taskEn: 'Rewrite this text in a more formal tone suitable for documentation',
  },
  {
    id: 'shorter',
    labelKey: 'file_ai_shorter',
    taskZh: '缩短这段文字，保留核心含义',
    taskEn: 'Make this text shorter while preserving the core meaning',
  },
  {
    id: 'longer',
    labelKey: 'file_ai_longer',
    taskZh: '扩写这段文字，补充必要说明，但不要改变原意',
    taskEn: 'Expand this text with useful detail without changing the original meaning',
  },
  {
    id: 'translate_zh',
    labelKey: 'file_ai_translate_zh',
    taskZh: '把这段文字翻译成中文',
    taskEn: 'Translate this text into Chinese',
  },
  {
    id: 'translate_en',
    labelKey: 'file_ai_translate_en',
    taskZh: '把这段文字翻译成英文',
    taskEn: 'Translate this text into English',
  },
  {
    id: 'summarize',
    labelKey: 'file_ai_summarize',
    taskZh: '总结这段文字，让它更精炼',
    taskEn: 'Summarize this text so it is more concise',
  },
]

export function getFileSelectionAiAction(actionId: FileSelectionAiActionId) {
  return (
    FILE_SELECTION_AI_ACTIONS.find((action) => action.id === actionId) ??
    FILE_SELECTION_AI_ACTIONS[0]
  )
}

function fenceText(text: string): string {
  const fence = text.includes('```') ? '````' : '```'
  return `${fence}text\n${text.trim()}\n${fence}`
}

export function buildFileSelectionAiPrompt(
  request: FileSelectionAiRequest,
  language = 'zh',
): string {
  const action = getFileSelectionAiAction(request.actionId)
  const task = language.toLowerCase().startsWith('zh') ? action.taskZh : action.taskEn

  return [
    `请编辑文件：${request.filePath}`,
    '',
    `任务：${task}。`,
    '',
    '要求：',
    '1. 直接修改原文件，不要只在聊天里回复修改结果。',
    '2. 只改选中文本对应的段落或片段，不要改无关内容。',
    '3. 保持 Markdown 结构、链接、代码块、列表和周围格式。',
    '4. 如果选中文本在文件中出现多次，请结合上下文只修改最匹配的一处；不确定时先说明。',
    '5. 修改完成后简短说明改了什么。',
    '',
    '选中文本：',
    fenceText(request.selectedText),
  ].join('\n')
}

function blockquoteText(text: string): string {
  const body = text.trim()
  if (!body) return '> '
  return body
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}

function inlineCode(text: string): string {
  return text.includes('`') ? `\`\` ${text} \`\`` : `\`${text}\``
}

function formatFileLocation(request: FileSelectionQuoteRequest): string {
  if (!request.line) return request.filePath
  const endLine = request.endLine && request.endLine > request.line ? request.endLine : undefined
  return `${request.filePath}:${endLine ? `${request.line}-${endLine}` : request.line}`
}

export function buildFileSelectionQuoteDraft(
  request: FileSelectionQuoteRequest,
  language = 'zh',
): string {
  const isZh = language.toLowerCase().startsWith('zh')
  const header = isZh ? '引用文件：' : 'Quoted file: '
  const userPromptLine = isZh ? '用户补充：' : 'User note:'
  const location = inlineCode(formatFileLocation(request))

  return [header + location, '', blockquoteText(request.selectedText), '', userPromptLine, ''].join(
    '\n',
  )
}

export function appendFileSelectionQuoteDraft(currentDraft: string, quoteDraft: string): string {
  if (!currentDraft.trim()) return quoteDraft
  const separator = currentDraft.endsWith('\n') ? '\n' : '\n\n'
  return `${currentDraft}${separator}${quoteDraft}`
}
