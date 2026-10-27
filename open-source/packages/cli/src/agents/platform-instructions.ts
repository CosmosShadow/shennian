// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/platform-instructions.test.ts

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { resolveShennianPath } from '../config/index.js'
import type { ExternalChannelSessionStatus } from '@shennian/wire'
import { buildExternalChannelInstructions } from './external-channel-instructions.js'

export const PLATFORM_OUTPUT_INSTRUCTIONS = `When you mention a local file that the user may want to open, format it as a Markdown link using the exact local path:

- Use [filename.ext](</absolute/path/to/filename.ext>) for absolute Unix, macOS, or Windows paths.
- Use [filename.ext](<relative/path/to/filename.ext>) for paths relative to the current working directory.
- Do not use file:// URLs for local files.
- Do not put user-openable file paths only inside code blocks.
- Keep normal http:// and https:// links unchanged.`

export function buildPlatformInstructions(
  _workDir: string,
  _externalChannel?: ExternalChannelSessionStatus | null,
  _sessionId?: string,
  agentSystemPrompt?: string | null,
): string {
  const sections = [
    agentSystemPrompt?.trim() ?? '',
    PLATFORM_OUTPUT_INSTRUCTIONS,
  ].filter(Boolean)
  return `${sections.join('\n\n')}\n`
}

// 用于没有独立 system-prompt 入口的 adapter（gemini/cursor/opencode/custom/openclaw）：
// 把外部消息通道说明作为「系统指令」前缀塞进首轮用户消息文本。
export function buildInlineChannelPreamble(
  workDir: string,
  externalChannel?: ExternalChannelSessionStatus | null,
  sessionId?: string,
  agentSystemPrompt?: string | null,
): string {
  const channelInstructions = buildExternalChannelInstructions(
    externalChannel,
    path.resolve(workDir),
    sessionId,
  )
  const sections = [
    agentSystemPrompt?.trim() ? `## 智能体提示词\n\n${agentSystemPrompt.trim()}` : '',
    channelInstructions ? `## 外部消息通道说明\n\n${channelInstructions}` : '',
  ].filter(Boolean)
  if (!sections.length) return ''
  return `# 神念运行指令（系统指令，非用户输入，请遵循后再回应下方用户消息）\n\n${sections.join('\n\n')}\n\n---\n\n`
}

export function ensurePlatformInstructionsFile(
  workDir: string,
  externalChannel?: ExternalChannelSessionStatus | null,
  sessionId?: string,
  agentSystemPrompt?: string | null,
): string {
  const key = createHash('sha256')
    .update(
      `${path.resolve(workDir)}:${sessionId ?? ''}:${JSON.stringify(externalChannel ?? null)}:${agentSystemPrompt ?? ''}`,
    )
    .digest('hex')
    .slice(0, 16)
  const filePath = resolveShennianPath('runtime', 'agent-instructions', `${key}.md`)
  const content = buildPlatformInstructions(workDir, externalChannel, sessionId, agentSystemPrompt)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  try {
    if (fs.readFileSync(filePath, 'utf8') === content) return filePath
  } catch {
    // Write the generated instruction file below.
  }
  fs.writeFileSync(filePath, content)
  return filePath
}
