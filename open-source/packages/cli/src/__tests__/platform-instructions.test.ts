// @covers src/agents/platform-instructions.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  PLATFORM_OUTPUT_INSTRUCTIONS,
  buildPlatformInstructions,
  buildInlineChannelPreamble,
  ensurePlatformInstructionsFile,
} from '../agents/platform-instructions.js'

describe('platform agent instructions', () => {
  let workDir = ''
  let homeDir = ''
  let priorHome: string | undefined

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-platform-workdir-'))
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-platform-home-'))
    priorHome = process.env.SHENNIAN_HOME
    process.env.SHENNIAN_HOME = homeDir
  })

  afterEach(() => {
    if (priorHome === undefined) delete process.env.SHENNIAN_HOME
    else process.env.SHENNIAN_HOME = priorHome
    fs.rmSync(workDir, { recursive: true, force: true })
    fs.rmSync(homeDir, { recursive: true, force: true })
  })

  it('injects only neutral file-link output rules for a normal session', () => {
    fs.writeFileSync(path.join(workDir, 'AGENTS.md'), '# Project Rules\n\nReturn Markdown.')

    const content = buildPlatformInstructions(workDir)

    expect(content).toBe(`${PLATFORM_OUTPUT_INSTRUCTIONS}\n`)
    expect(content).not.toContain('Shennian')
    expect(content).not.toContain('Agent Instructions')
    expect(content).not.toContain('# Project Rules')
  })

  it('writes stable instructions under SHENNIAN_HOME for Codex app-server', () => {
    const filePath = ensurePlatformInstructionsFile(workDir)

    expect(filePath).toContain(path.join(homeDir, 'runtime', 'agent-instructions'))
    expect(fs.readFileSync(filePath, 'utf8')).toContain('Do not use file:// URLs')
  })

  it('includes the latest Agent prompt and versions Codex instruction files by policy', () => {
    const first = ensurePlatformInstructionsFile(workDir, null, 'session-agent', '先回答产品问题。')
    const second = ensurePlatformInstructionsFile(workDir, null, 'session-agent', '先检查日志。')

    expect(first).not.toBe(second)
    expect(fs.readFileSync(first, 'utf8')).not.toContain('Agent Instructions')
    expect(fs.readFileSync(first, 'utf8')).toContain('先回答产品问题。')
    expect(fs.readFileSync(second, 'utf8')).toContain('先检查日志。')
  })

  it('does not mix retired external-channel instructions into normal agent policy', () => {
    const content = buildPlatformInstructions(
      workDir,
      {
        connected: true,
        configured: true,
        type: 'wecom',
        name: '客户支持群',
        canReply: true,
        systemPrompt: '只回答产品相关问题。',
      },
      'session-123',
    )

    expect(content).toBe(`${PLATFORM_OUTPUT_INSTRUCTIONS}\n`)
    expect(content).not.toContain('客户支持群')
    expect(content).not.toContain('只回答产品相关问题。')
  })

  it('wraps channel instructions as a system-directive preamble for text-only adapters', () => {
    const preamble = buildInlineChannelPreamble(
      workDir,
      {
        connected: true,
        configured: true,
        type: 'wechat-rpa',
        name: 'ABC',
        canReply: true,
        wechatRpaGroups: [{ name: 'ABC' }],
      },
      'session-inline',
    )

    expect(preamble).toContain('神念运行指令（系统指令，非用户输入')
    expect(preamble).toContain('当前对话已接入外部消息通道：ABC')
    expect(preamble).toContain('shennian external send --session-id session-inline --text')
    expect(preamble.endsWith('---\n\n')).toBe(true)
  })

  it('returns empty preamble when no channel is bound', () => {
    expect(buildInlineChannelPreamble(workDir, null, 'session-inline')).toBe('')
    expect(
      buildInlineChannelPreamble(
        workDir,
        { connected: false, configured: false },
        'session-inline',
      ),
    ).toBe('')
  })

  it('wraps the latest Agent prompt for adapters without a system-prompt flag', () => {
    const preamble = buildInlineChannelPreamble(workDir, null, 'session-inline', '保持简洁。')
    expect(preamble).toContain('## 智能体提示词')
    expect(preamble).toContain('保持简洁。')
  })
})
