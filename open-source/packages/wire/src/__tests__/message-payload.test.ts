// @covers open-source/packages/wire/src/message-payload.ts

import { describe, expect, it } from 'vitest'
import {
  buildUserMessagePayload,
  extractPayloadText,
  isAgentHiddenPayload,
  isSystemControlPayload,
  parseUserMessagePayload,
  sanitizeSessionPreview,
  sessionPreviewFromPayload,
} from '../message-payload'

describe('message payload markdown fidelity', () => {
  it('extracts Codex markdown text without collapsing blank lines or nested list indentation', () => {
    const markdown = [
      '# Codex Markdown 原样验证',
      '',
      '- **第一层重点**：包含 `inline code` 和普通说明',
      '  - 第二层 A：保留两个空格缩进',
      '  - 第二层 B：中间有 **bold**',
      '- 第一层第二项',
      '',
      '',
      '## 小结',
      '',
      '段落之间保留 Codex 原始空行。',
    ].join('\n')

    expect(extractPayloadText(markdown)).toBe(markdown)
    expect(extractPayloadText(JSON.stringify({ v: 1, content: markdown }))).toBe(markdown)
  })

  it('preserves folder attachments in structured user payloads', () => {
    const payload = buildUserMessagePayload('[zb-工作包](</home/zb-工作包>)', [
      {
        path: '/home/zb-工作包',
        name: 'zb-工作包',
        mimeType: 'inode/directory',
        kind: 'folder',
      },
    ])

    expect(parseUserMessagePayload(payload)?.attachments).toEqual([
      {
        path: '/home/zb-工作包',
        name: 'zb-工作包',
        mimeType: 'inode/directory',
        kind: 'folder',
      },
    ])
  })
})

describe('channel delivery status payload', () => {
  it('is visible text but hidden from agent context', () => {
    const payload = JSON.stringify({
      v: 1,
      type: 'channel_delivery_status',
      channel: 'wechat',
      status: 'failed',
      agentVisible: false,
      content: '未能自动发送到微信\n\n请手动复制这段内容。',
      copyText: '请手动复制这段内容。',
    })

    expect(extractPayloadText(payload)).toBe('未能自动发送到微信\n\n请手动复制这段内容。')
    expect(isAgentHiddenPayload(payload)).toBe(true)
    expect(isSystemControlPayload(payload)).toBe(false)
  })
})

describe('system control payload detection', () => {
  it('detects recommended plugins alone or followed by injected context, preserving ordinary text', () => {
    const plugins = '<recommended_plugins>\n- Airtable (airtable@openai-curated-remote)\n</recommended_plugins>'
    const environment = '<environment_context><cwd>/tmp/demo</cwd><shell>zsh</shell><current_date>2026-09-06</current_date><timezone>Asia/Shanghai</timezone></environment_context>'
    const instructions = '# AGENTS.md instructions for /tmp/demo\n<INSTRUCTIONS>rules</INSTRUCTIONS>'
    for (const suffix of ['', environment, instructions, instructions + environment]) {
      expect(isSystemControlPayload(plugins + '\n' + suffix)).toBe(true)
    }
    for (const text of [
      '解释 <recommended_plugins> 标签',
      '```xml\n' + plugins + '\n```',
      plugins + '\n请帮我选一个插件',
      plugins + environment + '\n真实问题',
      '<recommended_plugins>未闭合',
    ]) expect(isSystemControlPayload(text)).toBe(false)
  })

  it('hides standalone Codex Apps page context but preserves requests and code examples', () => {
    for (const pageId of [null, 'page-123']) {
      const context = `<external_codex_apps_open_page>\n${JSON.stringify({ page_id: pageId })}\n</external_codex_apps_open_page>`
      expect(isSystemControlPayload(` \n${context}\n `)).toBe(true)
      expect(sessionPreviewFromPayload(context)).toBeNull()
      for (const text of [
        '解释 ' + context,
        '```xml\n' + context + '\n```',
        context + '\n帮我创建分享链接',
        '<external_codex_apps_open_page>未闭合',
      ]) expect(isSystemControlPayload(text)).toBe(false)
    }
  })

  it('detects Codex injected AGENTS.md project instructions', () => {
    const payload = [
      '# AGENTS.md instructions for /home/example/Documents/code/projects/shennian',
      '',
      '<INSTRUCTIONS>',
      '# Shennian（神念）',
      '',
      '随时随地，掌控你的 AI Agent。',
      '</INSTRUCTIONS>',
      '<environment_context>',
      '  <cwd>/home/example/Documents/code/projects/shennian</cwd>',
      '  <shell>zsh</shell>',
      '  <current_date>2026-05-29</current_date>',
      '  <timezone>Asia/Shanghai</timezone>',
      '</environment_context>',
    ].join('\n')

    expect(isSystemControlPayload(payload)).toBe(true)
  })

  it('detects expanded Codex environment context with filesystem permissions', () => {
    const payload = [
      '<environment_context>',
      '  <cwd>/home/example/Documents/code/projects/shennian</cwd>',
      '  <shell>zsh</shell>',
      '  <current_date>2026-06-20</current_date>',
      '  <timezone>Asia/Shanghai</timezone>',
      '  <filesystem><workspace_roots><root>/home/example/Documents/code/projects/shennian</root></workspace_roots>',
      '  <permission_profile type="disabled"><file_system type="unrestricted" /></permission_profile></filesystem>',
      '</environment_context>',
    ].join('\n')

    expect(isSystemControlPayload(payload)).toBe(true)
  })

  it('detects compact Codex environment context with workspace roots but without cwd shell tags', () => {
    const payload = [
      '<environment_context>',
      '  <current_date>2026-07-04</current_date>',
      '  <timezone>Asia/Shanghai</timezone>',
      '  <filesystem><workspace_roots><root>/home/example/Documents/code/projects/shennian</root></workspace_roots>',
      '  <permission_profile type="disabled"><file_system type="unrestricted" /></permission_profile></filesystem>',
      '</environment_context>',
    ].join('\n')

    expect(isSystemControlPayload(payload)).toBe(true)
  })

  it('does not treat ordinary XML mentions as system environment context', () => {
    expect(isSystemControlPayload('为什么会显示 <environment_context> 这个标签？')).toBe(false)
    expect(isSystemControlPayload('<environment_context><timezone>Asia/Shanghai</timezone></environment_context>')).toBe(false)
  })

  it('keeps user messages that merely discuss AGENTS.md instructions', () => {
    expect(
      isSystemControlPayload('为什么会显示 “AGENTS.md instructions for /home/example/...” 这段？'),
    ).toBe(false)
  })

  it('detects standalone Codex internal context without hiding ordinary discussion', () => {
    const internalContext = [
      '<codex_internal_context source="goal">',
      'Continue working toward the active thread goal.',
      '<objective>完成剩余任务。</objective>',
      '</codex_internal_context>',
    ].join('\n')

    expect(isSystemControlPayload(internalContext)).toBe(true)
    expect(isSystemControlPayload('为什么会显示 <codex_internal_context> 这个标签？')).toBe(false)
  })
})

describe('personal session index preview privacy', () => {
  it('extracts only user text and never attachment metadata or previewData', () => {
    const payload = buildUserMessagePayload('请分析这张图', [{
      path: '/Users/private/screenshot.png',
      name: 'screenshot.png',
      mimeType: 'image/png',
      kind: 'image',
      previewData: `data:image/png;base64,${'A'.repeat(120)}`,
    }])

    expect(sessionPreviewFromPayload(payload)).toBe('请分析这张图')
  })

  it('rejects tool JSON, arbitrary JSON, base64 and injected system context', () => {
    expect(sessionPreviewFromPayload(JSON.stringify({
      v: 1, type: 'tool_result', content: 'private result', args: { token: 'secret' },
    }))).toBeNull()
    expect(sessionPreviewFromPayload(JSON.stringify({ args: { token: 'secret' } }))).toBeNull()
    expect(sanitizeSessionPreview(`data:image/png;base64,${'A'.repeat(120)}`)).toBeNull()
    expect(sanitizeSessionPreview('prefix <environment_context>private</environment_context>')).toBeNull()
    expect(sanitizeSessionPreview(`binary ${'Ab1/'.repeat(30)}`)).toBeNull()
  })

  it('normalizes and bounds ordinary visible text', () => {
    expect(sessionPreviewFromPayload('  完成\n\n全部测试  ', 20)).toBe('完成 全部测试')
    expect(sessionPreviewFromPayload('一'.repeat(25), 20)).toBe(`${'一'.repeat(20)}…`)
  })
})
