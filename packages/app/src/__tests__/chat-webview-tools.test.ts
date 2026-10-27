// @covers packages/app/src/components/chat/webview/chat.js
// @covers packages/app/src/components/chat/webview/chatVirtualization.js
// @covers packages/app/src/components/chat/webview/chatHooks.js
// @covers packages/app/src/components/chat/webview/chatCopy.js

import { buildApprovalPendingPayload } from '@shennian/wire'
import { envelopeToChatMessage } from '@shennian/shared'
import { describe, expect, it } from 'vitest'
import { createHarness, loadChatScript } from './chat-webview-harness'

describe('chat webview tool and process rendering', () => {
  it('groups a tool-only user turn across minute boundaries', () => {
    const { dispatch, flushAnimationFrames, getHtml, renderToolGroupItems } = createHarness()

    const toolMessages = [
      {
        id: 'tool-1',
        role: 'agent',
        ts: 1_000,
        content: '',
        toolCalls: [
          { name: 'command_execution', args: { command: 'rg -n "swipe"' }, result: 'match' },
        ],
      },
      {
        id: 'tool-2',
        role: 'agent',
        ts: 61_100,
        content: '',
        toolCalls: [
          { name: 'command_execution', args: { command: 'sed -n "1,120p"' }, result: 'file' },
        ],
      },
    ]

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages: [{ id: 'user-1', role: 'user', ts: 500, content: '执行检查' }, ...toolMessages],
    })
    flushAnimationFrames()

    const html = getHtml()
    expect(html).toContain('tool-disclosure tool-group')
    expect(html).toContain('2 个工具')
    expect(html).not.toContain('tool-chevron')
    expect(html).toContain('data-loaded="false"')
    expect(html).not.toContain('tool-item-label')
    expect(html).not.toContain('rg -n &quot;swipe&quot;')
    expect(html).not.toContain('sed -n &quot;1,120p&quot;')
    expect(html.match(/class="tool-block"/g) ?? []).toHaveLength(0)

    const expandedHtml = renderToolGroupItems(toolMessages)
    expect(expandedHtml).toContain('tool-item-label')
    expect(expandedHtml).toContain('&quot;command&quot;: &quot;rg -n')
    expect(expandedHtml).toContain('&quot;command&quot;: &quot;sed -n')
    expect(expandedHtml).toContain('data-detail-key="tool-item:tool-1:0"')
    expect(expandedHtml).not.toContain('tool-status-running')
  })

  it('uses the live activity count for the active tool group instead of imported records', () => {
    const { dispatch, flushAnimationFrames, getHtml } = createHarness()
    const messages = Array.from({ length: 6 }, (_, index) => ({
      id: `tool-live-${index}`,
      role: 'agent',
      ts: 1_000 + index,
      content: '',
      toolCalls: [{ name: index % 2 === 0 ? 'command_execution' : 'custom_tool_call_output' }],
    }))

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'tool_running',
      activeToolCallCount: 2,
      messages,
    })
    flushAnimationFrames()

    expect(getHtml()).toContain('2 个工具')
    expect(getHtml()).not.toContain('6 个工具')
  })

  it('uses a product-level tool label and keeps raw tool input out of the collapsed header', () => {
    const { renderToolGroupItems } = createHarness()
    const html = renderToolGroupItems([
      {
        id: 'tool-params',
        role: 'agent',
        ts: 1,
        content: '',
        toolCalls: [
          {
            name: 'shennian_room',
            args: { action: 'read', limit: 50, attachmentIds: ['attachment_1'] },
          },
        ],
      },
    ])

    const header = /<summary class="tool-group-item-header">([\s\S]*?)<\/summary>/.exec(html)?.[1]
    expect(header).toContain('工具调用')
    expect(header).not.toContain('shennian_room')
    expect(header).not.toMatch(/已完成|失败|无详情|可查看详情/)
    expect(header).not.toContain('action')
    expect(header).not.toContain('attachment_1')
    expect(html).toContain('&quot;attachmentIds&quot;')
  })

  it('keeps tool status, duration, and detail availability out of the summary', () => {
    const { renderToolGroupItems } = createHarness({
      i18n: {
        toolStatusCompleted: 'DONE',
        toolDetailAvailableLabel: 'DETAIL',
      },
    })
    const html = renderToolGroupItems([
      {
        id: 'tool-meta',
        role: 'agent',
        ts: 1,
        content: '',
        toolCalls: [
          {
            name: 'shell_command',
            status: 'completed',
            durationMs: 1_250,
            detailAvailable: true,
            argsSummary: { command: 'secret command' },
          },
        ],
      },
    ])

    const header = /<summary class="tool-group-item-header">([\s\S]*?)<\/summary>/.exec(html)?.[1]
    expect(header).toContain('工具调用')
    expect(header).not.toContain('shell_command')
    expect(header).not.toMatch(/DONE|1\.3 s|DETAIL/)
    expect(header).not.toContain('secret command')
  })

  it('does not attach a detail request target to the outer tool group', () => {
    const source = loadChatScript()

    expect(source).toContain('<details class="tool-disclosure tool-group" data-tool-group-ids="')
    expect(source).not.toContain('tool-group" data-tool-message-id=')
    expect(source).toContain(
      "node.addEventListener('toggle', function () {\n          if (node.open) load(pageSize)",
    )
    expect(source).toMatch(
      /content\.setAttribute\('data-loaded', 'true'\)[\s\S]{0,300}hookLinks\(\)[\s\S]{0,300}hookToolDetails\(\)/,
    )
  })

  it('segments large tool groups into bounded pages', () => {
    const { renderToolGroupItems } = createHarness()
    const messages = Array.from({ length: 100 }, (_, index) => ({
      id: `tool-${index}`,
      role: 'agent',
      ts: index,
      content: '',
      toolCalls: [{ name: 'command_execution', argsSummary: { command: `echo ${index}` } }],
    }))

    const firstPage = renderToolGroupItems(messages, 0, 20)
    const secondPage = renderToolGroupItems(messages, 20, 20)
    expect(firstPage.match(/class="tool-group-item"/g) ?? []).toHaveLength(20)
    expect(firstPage).toContain('echo 0')
    expect(firstPage).not.toContain('echo 20')
    expect(secondPage.match(/class="tool-group-item"/g) ?? []).toHaveLength(20)
    expect(secondPage).toContain('echo 20')
  })

  it('keeps tool-group identity stable and updates visible tail tools incrementally', () => {
    const source = loadChatScript()

    expect(source).toContain("key: 'tool-group-' + grouped[0].id")
    expect(source).not.toContain("grouped[0].id + '-' + grouped[grouped.length - 1].id")
    expect(source).toContain('appendTailToolsToVisibleGroup')
    expect(source).toContain("content.insertAdjacentHTML('beforeend', toolGroupItemsHtml(")
    expect(source).toContain('updateToolMessageDom(tcm)')
    expect(source).toContain('updateToolMessageDom(tdm)')
  })

  it('truncates large tool results by default to reduce mobile DOM pressure', () => {
    const { dispatch, flushAnimationFrames, getHtml } = createHarness()
    const longResult = `${'a'.repeat(1200)}TAIL`

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages: [
        {
          id: 'tool-long',
          role: 'agent',
          ts: 1_000,
          content: '',
          toolCalls: [
            { name: 'command_execution', args: { command: 'cat huge.log' }, result: longResult },
          ],
        },
      ],
    })
    flushAnimationFrames()

    const html = getHtml()
    expect(html).toContain('tool-code-truncated')
    expect(html).toContain('已截断 4 字符')
    expect(html).not.toContain('TAIL')
  })

  it('does not show running dots for completed omitted tool results', () => {
    const { dispatch, flushAnimationFrames, getHtml } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages: [
        {
          id: 'tool-omitted',
          role: 'agent',
          ts: 1_000,
          content: '',
          toolCalls: [
            {
              name: 'command_execution',
              status: 'completed',
              resultOmitted: true,
              detailAvailable: true,
              detailRef: { runId: 'run1', sourceSeq: 2 },
            },
          ],
        },
      ],
    })
    flushAnimationFrames()

    const html = getHtml()
    expect(html).not.toContain('tool-status-running')
    expect(html).toContain('执行结果未同步，结果保存在运行机器上。')
    expect(html).toContain('展开后从运行机器加载命令详情。')
  })

  it('requests command details when an omitted tool is expanded', () => {
    const { dispatch, flushAnimationFrames, getHtml, getPostedMessages, triggerFirstToolDetail } =
      createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages: [
        {
          id: 'tool-detail',
          role: 'agent',
          ts: 1_000,
          content: '',
          toolCalls: [
            {
              name: 'command_execution',
              status: 'completed',
              resultOmitted: true,
              detailRef: { runId: 'run1', sourceSeq: 3 },
            },
          ],
        },
      ],
    })
    flushAnimationFrames()

    expect(getPostedMessages()).not.toContainEqual(
      expect.objectContaining({ type: 'toolDetailRequest' }),
    )

    triggerFirstToolDetail()

    expect(getPostedMessages()).toContainEqual({
      type: 'toolDetailRequest',
      messageId: 'tool-detail',
      toolIndex: 0,
      name: 'command_execution',
      detailRef: { runId: 'run1', sourceSeq: 3 },
    })
    expect(getHtml()).not.toContain('正在从运行机器加载命令详情...')
  })

  it('keeps the tool group and selected item open while detail loads and updates', () => {
    const source = loadChatScript()

    expect(source).not.toContain(
      "tc.detailStatus = 'loading'\n            config.updateMessageDom(msg)",
    )
    expect(source).toContain('var wasOpen = Boolean(item.open)')
    expect(source).toContain('if (replacement && wasOpen) replacement.open = true')
  })

  it('renders loaded command details and results in memory', () => {
    const { dispatch, flushAnimationFrames, getHtml } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages: [
        {
          id: 'tool-detail-loaded',
          role: 'agent',
          ts: 1_000,
          content: '',
          toolCalls: [
            {
              name: 'command_execution',
              status: 'completed',
              resultOmitted: true,
              detailRef: { runId: 'run1', sourceSeq: 4 },
            },
          ],
        },
      ],
    })
    flushAnimationFrames()

    dispatch({
      type: 'updateToolDetail',
      msgId: 'tool-detail-loaded',
      toolIndex: 0,
      name: 'command_execution',
      status: 'completed',
      command: 'pnpm test:fast',
      argsSummary: { command: 'pnpm test:fast', cwd: '/repo' },
      result: 'PASS 12 tests',
      resultOmitted: false,
      detailStatus: 'loaded',
    })

    expect(getHtml()).toContain('pnpm test:fast')
    expect(getHtml()).toContain('&quot;cwd&quot;: &quot;/repo&quot;')
    expect(getHtml()).toContain('PASS 12 tests')
    expect(getHtml()).not.toContain('执行结果未同步，结果保存在运行机器上。')

    dispatch({
      type: 'updateToolDetail',
      msgId: 'tool-detail-loaded',
      toolIndex: 0,
      name: 'command_execution',
      status: 'completed',
      resultOmitted: true,
      detailStatus: 'offline',
    })
    expect(getHtml()).toContain('需要运行机器在线才能查看详情。')

    dispatch({
      type: 'updateToolDetail',
      msgId: 'tool-detail-loaded',
      toolIndex: 0,
      name: 'command_execution',
      status: 'completed',
      resultOmitted: true,
      detailStatus: 'unsupported',
    })
    expect(getHtml()).toContain('当前 daemon 版本不支持按需查看工具详情。')

    dispatch({
      type: 'updateToolDetail',
      msgId: 'tool-detail-loaded',
      toolIndex: 0,
      name: 'command_execution',
      status: 'completed',
      resultOmitted: true,
      detailStatus: 'unavailable',
    })
    expect(getHtml()).toContain('这条工具详情在运行机器上不可用。')
  })

  it('redacts system context from rendered tool details', () => {
    const { dispatch, flushAnimationFrames, getHtml } = createHarness()
    const environmentContext = [
      '<environment_context>',
      '<cwd>/repo</cwd>',
      '<shell>zsh</shell>',
      '<current_date>2026-06-20</current_date>',
      '<timezone>Asia/Shanghai</timezone>',
      '<filesystem><workspace_roots><root>/repo</root></workspace_roots>',
      '<permission_profile type="disabled"><file_system type="unrestricted" /></permission_profile></filesystem>',
      '</environment_context>',
    ].join('\n')

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages: [
        {
          id: 'tool-context',
          role: 'agent',
          ts: 1_000,
          content: '',
          toolCalls: [
            {
              name: 'command_execution',
              status: 'completed',
              command: environmentContext,
              argsSummary: { prompt: environmentContext },
              resultOmitted: true,
            },
          ],
        },
      ],
    })
    flushAnimationFrames()

    expect(getHtml()).toContain('[SYSTEM CONTEXT REDACTED]')
    expect(getHtml()).not.toContain('&lt;environment_context&gt;')
    expect(getHtml()).not.toContain('permission_profile')
  })

  it('keeps a manually expanded tool detail open when the tool call updates', () => {
    const { dispatch, flushAnimationFrames, getHtml, openDetail } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'tool_running',
      messages: [
        {
          id: 'tool-live',
          role: 'agent',
          ts: 1_000,
          content: '',
          toolCalls: [{ name: 'command_execution', args: { command: 'pnpm test' } }],
        },
      ],
    })
    flushAnimationFrames()

    openDetail('tool:tool-live')
    dispatch({
      type: 'updateToolCall',
      msgId: 'tool-live',
      toolCalls: [
        {
          name: 'command_execution',
          args: { command: 'pnpm test' },
          result: 'PASS',
        },
      ],
    })

    expect(getHtml()).toContain(
      '<details open class="tool-disclosure tool-block" data-detail-key="tool:tool-live"',
    )
    expect(getHtml()).toContain('PASS')
  })

  it('collapses completed agent process messages behind the final answer', () => {
    const { dispatch, flushAnimationFrames, getHtml } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages: [
        { id: 'user-1', role: 'user', ts: 1_000, content: '查一下' },
        { id: 'agent-1', role: 'agent', ts: 1_100, content: '我先看代码。' },
        {
          id: 'tool-1',
          role: 'agent',
          ts: 1_200,
          content: '',
          toolCalls: [
            { name: 'command_execution', args: { command: 'rg voice' }, result: 'match' },
          ],
        },
        {
          id: 'tool-2',
          role: 'agent',
          ts: 1_300,
          content: '',
          toolCalls: [
            { name: 'command_execution', args: { command: 'sed -n 1,80p' }, result: 'file' },
          ],
        },
        { id: 'agent-final', role: 'agent', ts: 1_400, content: '结论是 final 已经接入。' },
      ],
    })
    flushAnimationFrames()

    const html = getHtml()
    expect(html).toContain('process-collapse')
    expect(html).toContain('1 条消息 · 2 个工具')
    expect(html).toContain('结论是 final 已经接入。')
    expect(html).toContain('data-loaded="false"')
    expect(html).not.toContain('我先看代码。')
    expect(html).not.toContain('rg voice')
    expect(html.indexOf('process-collapse')).toBeLessThan(html.indexOf('结论是 final 已经接入。'))
  })

  it('keeps every message of the running turn visible, then collapses it when the run ends', () => {
    const { dispatch, flushAnimationFrames, getHtml } = createHarness()

    const messages = [
      { id: 'user-1', role: 'user', ts: 1_000, content: '查一下' },
      { id: 'agent-1', role: 'agent', ts: 1_100, content: '我先看代码。' },
      {
        id: 'tool-1',
        role: 'agent',
        ts: 1_200,
        content: '',
        toolCalls: [{ name: 'command_execution', args: { command: 'rg voice' }, result: 'match' }],
      },
      {
        id: 'tool-2',
        role: 'agent',
        ts: 1_250,
        content: '',
        toolCalls: [{ name: 'command_execution', args: { command: 'sed -n 1,80p' }, result: 'file' }],
      },
      { id: 'agent-final', role: 'agent', ts: 1_300, content: '结论是 final 已经接入。' },
      {
        id: 'tool-after-text',
        role: 'agent',
        ts: 61_000,
        content: '',
        toolCalls: [{ name: 'command_execution', args: { command: 'pnpm test' } }],
      },
    ]

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'tool_running',
      messages,
    })
    flushAnimationFrames()
    let html = getHtml()
    expect(html).not.toContain('process-collapse')
    expect(html).not.toContain('collapsed-run-user-1')
    expect(html).toContain('我先看代码。')
    expect(html).toContain('结论是 final 已经接入。')
    // Adjacent tools merge into one folded group between the text messages.
    expect(html).toContain('data-virtual-key="tool-group-tool-1"')
    expect(html.indexOf('我先看代码。')).toBeLessThan(html.indexOf('tool-group-tool-1'))
    expect(html.indexOf('tool-group-tool-1')).toBeLessThan(html.indexOf('结论是 final 已经接入。'))

    dispatch({
      type: 'addMessage',
      message: { id: 'agent-latest', role: 'agent', ts: 62_000, content: '测试已经通过。' },
    })
    flushAnimationFrames()
    html = getHtml()
    expect(html).not.toContain('process-collapse')
    expect(html).toContain('我先看代码。')
    expect(html).toContain('结论是 final 已经接入。')
    expect(html).toContain('测试已经通过。')

    dispatch({ type: 'setRunPhase', runPhase: 'idle' })
    flushAnimationFrames()
    html = getHtml()
    expect(html).toContain('2 条消息 · 3 个工具')
    expect(html).toContain('data-virtual-key="collapsed-run-user-1"')
    expect(html).toContain('测试已经通过。')
    expect(html).not.toContain('我先看代码。')
  })

  it('shows time separators between turns but never inside one agent turn', () => {
    const { dispatch, flushAnimationFrames, getHtml } = createHarness()
    const tool = (id: string, ts: number) => ({
      id,
      role: 'agent',
      ts,
      content: '',
      toolCalls: [{ name: 'command_execution', args: { command: id }, result: 'ok' }],
    })
    const messages = [
      { id: 'user-1', role: 'user', ts: 1_000, content: '第一轮' },
      { id: 'a-1', role: 'agent', ts: 1_100, content: '开始处理。' },
      tool('t-1', 121_000),
      { id: 'a-2', role: 'agent', ts: 241_000, content: '处理完成。' },
      { id: 'user-2', role: 'user', ts: 600_000, content: '第二轮' },
      { id: 'b-1', role: 'agent', ts: 660_000, content: '第二轮进度。' },
      tool('t-2', 720_000),
    ]

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'tool_running',
      messages,
    })
    flushAnimationFrames()
    // Running turn 2 spans three minutes; only the two user messages carry a time.
    expect(getHtml().match(/class="time-separator"/g)).toHaveLength(2)

    dispatch({ type: 'setRunPhase', runPhase: 'idle' })
    flushAnimationFrames()
    expect(getHtml().match(/class="time-separator"/g)).toHaveLength(2)
  })

  it('keeps earlier turns collapsed while only the latest turn is running', () => {
    const { dispatch, flushAnimationFrames, getHtml } = createHarness()
    const tool = (id: string, ts: number) => ({
      id,
      role: 'agent',
      ts,
      content: '',
      toolCalls: [{ name: 'command_execution', args: { command: id }, result: 'ok' }],
    })

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'thinking',
      messages: [
        { id: 'user-1', role: 'user', ts: 1_000, content: '第一轮' },
        { id: 'old-progress', role: 'agent', ts: 1_100, content: '旧轮次过程。' },
        tool('old-tool', 1_200),
        { id: 'old-final', role: 'agent', ts: 1_300, content: '旧轮次结论。' },
        { id: 'user-2', role: 'user', ts: 2_000, content: '第二轮' },
        { id: 'new-progress', role: 'agent', ts: 2_100, content: '新轮次过程。' },
        tool('new-tool', 2_200),
      ],
    })
    flushAnimationFrames()

    const html = getHtml()
    expect(html).toContain('data-virtual-key="collapsed-run-user-1"')
    expect(html).not.toContain('旧轮次过程。')
    expect(html).toContain('旧轮次结论。')
    expect(html).not.toContain('collapsed-run-user-2')
    expect(html).toContain('新轮次过程。')
  })

  it('keeps a manually expanded completed process open after later message updates rerender', () => {
    const { dispatch, flushAnimationFrames, getHtml, openDetail } = createHarness()
    const messages = [
      { id: 'user-1', role: 'user', ts: 1_000, content: '查一下' },
      { id: 'agent-1', role: 'agent', ts: 1_100, content: '我先看代码。' },
      {
        id: 'tool-1',
        role: 'agent',
        ts: 1_200,
        content: '',
        toolCalls: [{ name: 'command_execution', args: { command: 'rg voice' }, result: 'match' }],
      },
      { id: 'agent-final', role: 'agent', ts: 1_300, content: '结论是 final 已经接入。' },
    ]

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages,
    })
    flushAnimationFrames()

    openDetail('process:agent-1')
    dispatch({
      type: 'addMessage',
      message: { id: 'agent-follow-up', role: 'agent', ts: 1_400, content: '追加说明。' },
    })

    expect(getHtml()).toContain(
      '<details open class="process-collapse" data-process-ids="agent-1,tool-1,agent-final" data-detail-key="process:agent-1">',
    )
    expect(getHtml()).toContain('追加说明。')
  })

  it('localizes collapsed process labels', () => {
    const { dispatch, flushAnimationFrames, getHtml } = createHarness({
      i18n: {
        processMessagesWithTools: '__MESSAGES__ messages · __TOOLS__ tools',
      },
    })
    const messages = [
      { id: 'u1', role: 'user', ts: 1_000, content: 'question' },
      { id: 'a1', role: 'agent', ts: 1_001, content: 'checking' },
      {
        id: 'tool1',
        role: 'agent',
        ts: 1_002,
        content: '',
        toolCalls: [{ id: 't1', name: 'read', args: {}, result: 'ok' }],
      },
      { id: 'a2', role: 'agent', ts: 1_003, content: 'answer' },
    ]

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages,
    })
    flushAnimationFrames()

    expect(getHtml()).toContain('1 messages · 1 tools')

    expect(getHtml()).not.toContain('条过程消息')
  })

  it('keeps historical conversation turns in the scroll flow', () => {
    const { dispatch, flushAnimationFrames, getHtml } = createHarness()
    const messages = Array.from({ length: 6 }, (_, index) => [
      {
        id: `user-${index}`,
        role: 'user',
        ts: 1_000 + index * 1_000,
        content: `question-${index}`,
      },
      {
        id: `agent-${index}`,
        role: 'agent',
        ts: 1_500 + index * 1_000,
        content: `answer-${index}`,
      },
    ]).flat()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages,
    })
    flushAnimationFrames()

    const html = getHtml()
    expect(html).not.toContain('history-collapse')
    expect(html).toContain('question-0')
    expect(html).toContain('answer-1')
    expect(html).toContain('answer-5')
  })

  it('keeps leading agent fragments before the first visible user message', () => {
    const { dispatch, flushAnimationFrames, getHtml } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages: [
        { id: 'agent-leading', role: 'agent', ts: 1_000, content: '前导说明' },
        { id: 'user-first', role: 'user', ts: 2_000, content: '第一个问题' },
        { id: 'agent-answer', role: 'agent', ts: 3_000, content: '第一个回答' },
      ],
    })
    flushAnimationFrames()

    const html = getHtml()
    expect(html.indexOf('前导说明')).toBeLessThan(html.indexOf('第一个问题'))
    expect(html.indexOf('第一个问题')).toBeLessThan(html.indexOf('第一个回答'))
  })

  it('does not move a later attachment message above a paginated agent tail', () => {
    const { dispatch, flushAnimationFrames, getHtml } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages: [
        { id: 'old-tool', role: 'agent', ts: 1_000, content: '', toolCalls: [{ name: 'exec' }] },
        { id: 'old-final', role: 'agent', ts: 2_000, content: '上一轮完成' },
        {
          id: 'later-user',
          role: 'user',
          ts: 3_000,
          content: '![shot.png](</tmp/shot.png>)',
          attachments: [
            {
              path: '/tmp/shot.png',
              name: 'shot.png',
              mimeType: 'image/png',
              kind: 'image',
            },
          ],
        },
        { id: 'new-tool', role: 'agent', ts: 4_000, content: '', toolCalls: [{ name: 'exec' }] },
        { id: 'new-final', role: 'agent', ts: 5_000, content: '这一轮完成' },
      ],
    })
    flushAnimationFrames()

    const html = getHtml()
    expect(html.indexOf('上一轮完成')).toBeLessThan(html.indexOf('data-id="later-user"'))
    expect(html.indexOf('data-id="later-user"')).toBeLessThan(html.indexOf('这一轮完成'))
  })

  it('bridges code-block copy requests back to native with decoded text', () => {
    const { getPostedMessages, triggerCopy } = createHarness()

    const button = triggerCopy('echo &quot;hi&quot; &amp;&amp; true')

    expect(getPostedMessages().at(-1)).toEqual({ type: 'copyCode', code: 'echo "hi" && true' })
    expect(button.textContent).toBe('✓ Copied')
  })

  it('falls back to navigator clipboard copy when native bridge is unavailable', () => {
    const { getCopiedTexts, triggerCopy } = createHarness({ includeNativeBridge: false })

    triggerCopy('sudo &lt;run&gt;')

    expect(getCopiedTexts()).toEqual(['sudo <run>'])
  })
})

it('renders imported Codex questions as visible mobile cards, not collapsed process tools', () => {
  const { dispatch, getHtml, flushAnimationFrames } = createHarness()
  dispatch({
    type: 'init',
    theme: { isDark: false, colors: {} },
    runPhase: 'running',
    messages: [
      envelopeToChatMessage({
        sessionId: 'question-session',
        id: 'question',
        role: 'agent',
        ts: 100,
        payload: buildApprovalPendingPayload({
          title: 'Codex 等待你回答',
          content: '选择助手 <script>\n1. 产品问答助手\n2. 展示已有智能体',
          source: 'codex',
          actionHint: '当前神念暂不支持远程回答此类问题，请回到电脑端回答。',
        }),
      }),
    ],
  })
  flushAnimationFrames()
  const html = getHtml()
  expect(html).toContain('class="approval-card"')
  expect(html).toContain('Codex 等待你回答')
  expect(html).toContain('1. 产品问答助手')
  expect(html).toContain('2. 展示已有智能体')
  expect(html).toContain('暂不支持远程回答')
  expect(html).toContain('&lt;script&gt;')
  expect(html).not.toContain('class="process-collapse"')
})
