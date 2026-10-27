// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/codex-user-question.test.ts

import type { ApprovalPendingPayload } from '@shennian/wire'

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** Only recognized question tools expose their prompt; ordinary tool arguments stay local. */
export function buildCodexUserQuestion(
  name: unknown,
  input: unknown,
): Partial<ApprovalPendingPayload> | null {
  if (
    typeof name !== 'string' ||
    !/(?:^|[./])(?:request_user_input(?:_async)?|requestUserInput)$/.test(name)
  )
    return null
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input)
    } catch {
      input = null
    }
  }
  const questions = record(input)?.questions
  const blocks = Array.isArray(questions)
    ? questions.flatMap((value, index) => {
        const question = record(value)
        if (!question) return []
        const text =
          typeof question.question === 'string'
            ? question.question
            : typeof question.title === 'string'
              ? question.title
              : ''
        if (!text.trim()) return []
        const options = Array.isArray(question.options)
          ? question.options.flatMap((option, optionIndex) => {
              const entry = record(option)
              const label = typeof option === 'string' ? option : entry?.label
              if (typeof label !== 'string' || !label.trim()) return []
              const description =
                typeof entry?.description === 'string' ? `：${entry.description}` : ''
              return [`${optionIndex + 1}. ${label}${description}`]
            })
          : []
        return [[questions.length > 1 ? `${index + 1}. ${text}` : text, ...options].join('\n')]
      })
    : []
  return {
    title: 'Codex 等待你回答',
    content: blocks.join('\n\n') || 'Codex 提出了问题，正在等待你回答后继续。',
    source: 'codex',
    actionHint:
      '这不是卡死。当前神念暂不支持远程回答此类问题，请回到运行 Codex 的电脑/终端回答后继续。',
  }
}
