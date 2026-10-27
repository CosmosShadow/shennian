// @covers packages/app/src/components/chat/webview/chat.js
// @covers packages/app/src/components/chat/webview/chatCss.ts
// @covers packages/app/src/components/chat/webview/chatMarkdown.js
// @covers packages/app/src/components/chat/ChatWebViewMarkdown.web.ts
// @covers packages/app/src/features/chat/utils/agentErrorPresentation.ts

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { MARKED_JS } from '../components/chat/webview/markedJs'
import {
  getCodeBlockCopyText,
  renderMarkdown,
} from '../components/chat/ChatWebViewMarkdown.web'
import { CHAT_CSS_NATIVE, CHAT_CSS_WEB } from '../components/chat/webview/chatCss'
import { createChatHtml } from '../components/chat/webview/bundledHtml'
import { createHarness } from './chat-webview-harness'
import { presentAgentUpstreamError } from '../features/chat/utils/agentErrorPresentation'

describe('agent error presentation', () => {
  const t = (_key: string, options?: Record<string, unknown>) =>
    `模型服务暂时不可用（${options?.status}），请稍后重试。`

  it('presents a known upstream failure as a readable status without raw JSON', () => {
    expect(presentAgentUpstreamError(
      '502: {"message":"Managed model request failed","type":"upstream_error"}', t,
    )).toBe('模型服务暂时不可用（502），请稍后重试。')
  })

  it('preserves ordinary agent content and unrelated JSON', () => {
    expect(presentAgentUpstreamError('502: retry later', t)).toBe('502: retry later')
    expect(presentAgentUpstreamError('502: {"type":"example","message":"hello"}', t))
      .toBe('502: {"type":"example","message":"hello"}')
  })
})

describe('chat webview mobile markdown css', () => {
  it('renders display and inline LaTeX as local MathML without touching code spans', () => {
    const { dispatch, flushAnimationFrames, getHtml, getRenderedMath } = createHarness()
    const content = [
      '一个经典比特是：',
      '',
      '\\[',
      '0 \\quad \\text{或} \\quad 1',
      '\\]',
      '',
      '一个量子比特是：',
      '',
      '$$',
      '|\\psi\\rangle=|\\alpha|0\\rangle+|\\beta|1\\rangle',
      '\\begin{bmatrix} \\alpha \\\\ \\beta \\end{bmatrix}',
      '$$',
      '',
      '行内公式 \\(E=mc^2\\)，价格 $5，代码 `\\(not-math\\)`。',
    ].join('\n')

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages: [{ id: 'm-math', role: 'agent', ts: 1_000, content }],
    })
    flushAnimationFrames()

    expect(getRenderedMath()).toEqual([
      { latex: '0 \\quad \\text{或} \\quad 1', displayMode: true },
      {
        latex:
          '|\\psi\\rangle=|\\alpha|0\\rangle+|\\beta|1\\rangle\n' +
          '\\begin{bmatrix} \\alpha \\\\ \\beta \\end{bmatrix}',
        displayMode: true,
      },
      { latex: 'E=mc^2', displayMode: false },
    ])
    const html = getHtml()
    expect(html.match(/class="chat-math-block"/g)).toHaveLength(2)
    expect(html).toContain('class="chat-math-inline"')
    expect(html).toContain('<math data-display="true">')
    expect(html).toContain('$5')
    expect(html).toContain('<code>\\(not-math\\)</code>')
  })

  it('renders formulas only inside the bounded long-chat window', () => {
    const { dispatch, flushAnimationFrames, getHtml, getRenderedMath } = createHarness()
    const messages = Array.from({ length: 500 }, (_, index) => ({
      id: `m-formula-${index}`,
      role: 'user',
      ts: 1_000 + index,
      content: `第 ${index} 条：\\(x_{${index}}^2\\)`,
    }))

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages,
      initialScroll: { kind: 'bottom' },
    })
    flushAnimationFrames()

    expect(getRenderedMath().length).toBeLessThanOrEqual(48)
    expect(getRenderedMath().at(-1)).toEqual({ latex: 'x_{499}^2', displayMode: false })
    expect(getHtml().match(/data-virtual-key=/g)?.length).toBeLessThanOrEqual(48)
    expect(getHtml()).not.toContain('x_{0}^2')
  })

  it('renders nested bullet markdown with heading and inline path text without raw html execution', () => {
    const { dispatch, flushAnimationFrames, getHtml } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages: [
        {
          id: 'm-markdown',
          role: 'agent',
          ts: 1_000,
          content: [
            '普通段落说明。',
            '',
            '## 我建议的定位',
            '',
            '- 第一层 bullet，含 `packages/app/src/components/chat/ChatWebView.web.tsx`',
            '  - 第二层 bullet，含 `/Users/example/Documents/code/projects/shennian/packages/app`',
            '- 另一条 <script>alert(1)</script>',
          ].join('\n'),
        },
      ],
    })
    flushAnimationFrames()

    const html = getHtml()
    expect(html).toContain('<h2>我建议的定位</h2>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<code>packages/app/src/components/chat/ChatWebView.web.tsx</code>')
    expect(html).toContain('/Users/example/Documents/code/projects/shennian/packages/app')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('keeps long code block copy text out of the rendered html attribute payload', () => {
    const longCode = `echo start\n${'x'.repeat(10_000)}\necho done`
    const html = renderMarkdown(`\`\`\`bash\n${longCode}\n\`\`\``)
    const copyId = /data-code-id="([^"]+)"/.exec(html)?.[1]

    expect(copyId).toBeTruthy()
    expect(html).not.toContain('data-code=')
    expect(html.length).toBeLessThan(longCode.length * 1.4)
    expect(getCodeBlockCopyText(copyId!)).toBe(longCode)
  })

  it('renders the release smoke markdown sample with headings, paragraphs, colon lists and Chinese text', () => {
    const { dispatch, flushAnimationFrames, getHtml, getParsedMarkdownInputs } = createHarness()

    const releaseSmokeMarkdown = [
      '# 发布后 Markdown 验证',
      '',
      '这是一段中文段落，用来确认普通文本不会被列表或标题吞掉。',
      '',
      '覆盖点如下:',
      '',
      '- 嵌套列表第一层，包含 inline code `pnpm test:fast`',
      '  - 第二层包含路径 `/Users/example/Documents/code/projects/shennian/packages/app/src/components/chat`',
      '  - 第二层中文说明：冒号后的列表也应正常缩进',
      '- 另一条第一层，包含文件路径 `packages/app/src/components/chat/webview/chat.js`',
      '',
      '结论: 如果你能看到标题、段落、嵌套列表和 `inline code/path`，说明渲染正常。',
    ].join('\n')

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages: [
        {
          id: 'm-release-smoke',
          role: 'agent',
          ts: 1_000,
          content: releaseSmokeMarkdown,
        },
      ],
    })
    flushAnimationFrames()

    expect(getParsedMarkdownInputs()[0]).toBe(releaseSmokeMarkdown)
    const html = getHtml()
    expect(html).toContain('<h1>发布后 Markdown 验证</h1>')
    expect(html).toContain('<p>这是一段中文段落，用来确认普通文本不会被列表或标题吞掉。</p>')
    expect(html).toContain('<p>覆盖点如下:</p>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<code>pnpm test:fast</code>')
    expect(html).toContain(
      '<code>/Users/example/Documents/code/projects/shennian/packages/app/src/components/chat</code>',
    )
    expect(html).toContain('第二层中文说明：冒号后的列表也应正常缩进')
    expect(html).toContain('<code>packages/app/src/components/chat/webview/chat.js</code>')
    expect(html).toContain(
      '<p>结论: 如果你能看到标题、段落、嵌套列表和 <code>inline code/path</code>，说明渲染正常。</p>',
    )
  })

  it('renders the original Codex markdown sample as markdown DOM without pre-flattening lines', () => {
    const { dispatch, flushAnimationFrames, getHtml, getParsedMarkdownInputs } = createHarness()
    const codexMarkdown = [
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

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages: [
        {
          id: 'm-codex-original-markdown',
          role: 'agent',
          ts: 1_000,
          content: codexMarkdown,
        },
      ],
    })
    flushAnimationFrames()

    expect(getParsedMarkdownInputs()[0]).toBe(codexMarkdown)
    const html = getHtml()
    expect(html).toContain('<h1>Codex Markdown 原样验证</h1>')
    expect(html).toContain('<strong>第一层重点</strong>')
    expect(html).toContain('<code>inline code</code>')
    expect(html).toContain('第二层 A：保留两个空格缩进')
    expect(html).toContain('<h2>小结</h2>')
    expect(html).not.toContain(
      '第一层重点</strong>：包含 <code>inline code</code> 和普通说明 第二层 A',
    )
  })

  it('shows local file line labels while keeping the whole link directly openable', () => {
    const { dispatch, flushAnimationFrames, getHtml } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages: [
        {
          id: 'm-file-lines',
          role: 'agent',
          ts: 1_000,
          content: ['请看 ./src/app.ts:123', '[入口文件](./src/index.ts:10:2)'].join('\n'),
        },
      ],
    })
    flushAnimationFrames()

    const html = getHtml()
    expect(html).toContain('href="&lt;./src/app.ts:123&gt;"')
    expect(html).toContain('./src/app.ts:123')
    expect(html).toContain('href="./src/index.ts:10:2"')
    expect(html).toContain('入口文件<span class="resource-line-label">line 10:2</span>')
  })

  it('keeps inline code file references with line ranges directly openable', () => {
    const { dispatch, flushAnimationFrames, getHtml } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      runPhase: 'idle',
      messages: [
        {
          id: 'm-inline-file-lines',
          role: 'agent',
          ts: 1_000,
          content: '引用文件：`packages/app/src/features/chat/FilePreviewPanel.tsx:120-136`',
        },
      ],
    })
    flushAnimationFrames()

    const html = getHtml()
    expect(html).toContain('href="packages/app/src/features/chat/FilePreviewPanel.tsx:120-136"')
    expect(html).toContain(
      '<code>packages/app/src/features/chat/FilePreviewPanel.tsx:120-136</code>',
    )
  })

  it('renders native dark mode before the bridge init message arrives', () => {
    const html = createChatHtml({
      i18nScript: 'window._i18n={};',
      theme: {
        isDark: true,
        colors: {
          bg: '#0a0a0a',
          text: '#fafafa',
          surfaceHover: '#262626',
        },
      },
    })

    expect(html).toContain('<html class="dark" style="--bg:#0a0a0a;')
    expect(html).toContain('--text:#fafafa;')
    expect(html).toContain('--surface-hover:#262626;')
    expect(html).toContain('<script>window._i18n={};</script>')
  })

  it('wraps long code lines instead of relying on horizontal scrolling in native webview', () => {
    expect(CHAT_CSS_NATIVE).toContain(
      'overflow-x:hidden; white-space:pre-wrap; word-break:break-word; overflow-wrap:anywhere;',
    )
    expect(CHAT_CSS_NATIVE).toContain('table-layout:fixed;')
  })

  it('keeps user markdown lists and inline code readable inside the bubble', () => {
    expect(CHAT_CSS_NATIVE).toContain(
      'font-size:15px; line-height:24px; overflow-wrap:break-word; white-space:pre-wrap;',
    )
    expect(CHAT_CSS_NATIVE).toContain(
      'font-size:15px; line-height:24px; color:var(--text); white-space:normal;',
    )
    expect(CHAT_CSS_NATIVE).toContain('.bubble-user .md ul, .bubble-user .md ol')
    expect(CHAT_CSS_NATIVE).toContain('list-style-position:outside;')
    expect(CHAT_CSS_NATIVE).toContain('.bubble-user .md li > p { margin:0; }')
    expect(CHAT_CSS_NATIVE).toContain('.bubble-user .md code:not(pre code)')
    expect(CHAT_CSS_NATIVE).toContain('overflow-wrap:anywhere; word-break:break-word;')
  })

  it('preserves all six heading levels and inline emphasis on native and web', () => {
    const content = Array.from({ length: 6 }, (_, i) => '#'.repeat(i + 1) + ' **层级 ' + (i + 1) + '**').join('\n\n')
    const { dispatch, flushAnimationFrames, getHtml } = createHarness()
    dispatch({ type: 'init', theme: { isDark: false, colors: {} }, runPhase: 'idle',
      messages: [{ id: 'heading-levels', role: 'agent', ts: 1_000, content }] })
    flushAnimationFrames()
    const nativeSource = readFileSync(resolve(__dirname, '../components/chat/webview/chatMarkdown.js'), 'utf8')
    const nativeHtml = runInNewContext(MARKED_JS + '\n' + nativeSource + '\nmarked.parse(' + JSON.stringify(content) + ')', { window: {} })
    for (const html of [getHtml(), renderMarkdown(content), nativeHtml]) {
      for (let depth = 1; depth <= 6; depth++) {
        expect(html).toContain(`<h${depth}><strong>层级 ${depth}</strong></h${depth}>`)
      }
    }
  })

  it('uses the same restrained emphasis on native and web without dimming body text', () => {
    for (const [css, scope] of [[CHAT_CSS_NATIVE, ''], [CHAT_CSS_WEB, '.cwv ']]) {
      expect(css).toContain(scope + '.bubble-agent .md strong { font-weight:600; }')
      expect(css).not.toContain(scope + '.bubble-agent .md strong { font-weight:700; }')
      expect(css).toContain('font-size:1em; font-weight:600; margin:1em 0 0.4em; line-height:1.45;')
      expect(css).toContain(scope + '.bubble-agent .md li { margin:0.35em 0; padding-left:0.15em; }')
      expect(css).toContain('background:var(--surface); border:0; border-radius:3px; padding:0 0.2em;')
    }
    const content = '## **分组 Heading**\n\n正文 **重点** `inline code`\n\n1. **标题**：内容'
    expect(renderMarkdown(content)).toContain('<strong>重点</strong>')
    expect(renderMarkdown(content)).toContain('<code>inline code</code>')
    expect(renderMarkdown(content)).toContain('<ol>')
  })

  it('keeps markdown headings compact inside chat bubbles', () => {
    expect(CHAT_CSS_NATIVE).toContain(
      '.bubble-user .md h1, .bubble-user .md h2, .bubble-user .md h3',
    )
    expect(CHAT_CSS_NATIVE).toContain(
      '.bubble-agent .md h1, .bubble-agent .md h2, .bubble-agent .md h3',
    )
    expect(CHAT_CSS_NATIVE).toContain(
      'font-size:15px; line-height:22px; font-weight:700; margin:6px 0 4px;',
    )
    expect(CHAT_CSS_NATIVE).toContain(
      'font-size:1em; font-weight:600; margin:1em 0 0.4em; line-height:1.45;',
    )
  })

  it('keeps agent nested bullets, paragraphs, headings and inline code readable', () => {
    expect(CHAT_CSS_NATIVE).toContain('.bubble-agent .md {')
    expect(CHAT_CSS_NATIVE).toContain('font-size:15px; line-height:23px; color:var(--text);')
    expect(CHAT_CSS_NATIVE).toContain('.bubble-agent .md > *:first-child { margin-top:0; }')
    expect(CHAT_CSS_NATIVE).toContain('.bubble-agent .md p { margin:0.5em 0; }')
    expect(CHAT_CSS_NATIVE).toContain('.bubble-agent .md code:not(pre code)')
    expect(CHAT_CSS_NATIVE).toContain('background:var(--surface); border:0; border-radius:3px; padding:0 0.2em;')
    expect(CHAT_CSS_NATIVE).toContain(
      'white-space:normal; overflow-wrap:anywhere; word-break:break-word;',
    )
    expect(CHAT_CSS_NATIVE).toContain(
      '.bubble-agent .md li > ul, .bubble-agent .md li > ol { margin:0.25em 0; padding-left:1.25em; }',
    )
    expect(CHAT_CSS_NATIVE).toContain(
      '.bubble-agent .md li::marker { color:var(--text-secondary); font-weight:400; }',
    )
    expect(CHAT_CSS_WEB).toContain(
      '.cwv .bubble-agent .md li > ul, .cwv .bubble-agent .md li > ol { margin:0.25em 0; padding-left:1.25em; }',
    )
  })
})

describe('chat webview markdown normalization', () => {
  it('repairs fenced code blocks when the language marker is joined to the first line', () => {
    const { dispatch, getParsedMarkdownInputs } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      messages: [
        {
          id: 'm-code',
          role: 'agent',
          ts: 1_000,
          content:
            '我已经帮你执行过一次构建：\n\n```bashnpm run build:h5```\n\n访问地址：\n\n```txtHTTP://LOCALHOST:5173/```',
        },
      ],
      runPhase: 'idle',
    })

    expect(getParsedMarkdownInputs()[0]).toContain('```bash\nnpm run build:h5\n```')
    expect(getParsedMarkdownInputs()[0]).toContain('```txt\nHTTP://LOCALHOST:5173/\n```')
  })

  it('repairs opening fences joined to preceding prose', () => {
    const { dispatch, getParsedMarkdownInputs } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      messages: [
        {
          id: 'm-inline-fence',
          role: 'agent',
          ts: 1_000,
          content:
            'MVP2: 长期运行```bash\nnian-manager watch\n```\n\n### MVP3\n- Discord / Telegram\n\n**关键判断**',
        },
      ],
      runPhase: 'idle',
    })

    expect(getParsedMarkdownInputs()[0]).toContain('MVP2: 长期运行\n\n```bash')
    expect(getParsedMarkdownInputs()[0]).toContain('```bash\nnian-manager watch\n```')
    expect(getParsedMarkdownInputs()[0]).toContain('\n\n### MVP3')
    expect(getParsedMarkdownInputs()[0]).toContain('**关键判断**')
  })

  it('closes leaked fenced code blocks before normal markdown resumes', () => {
    const { dispatch, getParsedMarkdownInputs } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      messages: [
        {
          id: 'm-leaked-fence',
          role: 'agent',
          ts: 1_000,
          content:
            'MVP2: 长期运行\n\n```bash\nnian-manager watch\n\n支持 timer / worker final / file change。\n\n### MVP3\n- Discord / Telegram\n\n**关键判断**',
        },
      ],
      runPhase: 'idle',
    })

    expect(getParsedMarkdownInputs()[0]).toContain(
      '```bash\nnian-manager watch\n\n```\n支持 timer / worker final / file change。',
    )
    expect(getParsedMarkdownInputs()[0]).toContain('\n\n### MVP3')
    expect(getParsedMarkdownInputs()[0]).toContain('\n- Discord / Telegram')
    expect(getParsedMarkdownInputs()[0]).toContain('\n\n**关键判断**')
  })

  it('caps blank-line holes from leaked fenced code blocks before markdown resumes', () => {
    const { dispatch, getParsedMarkdownInputs } = createHarness()
    const blankRun = '\n'.repeat(80)

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      messages: [
        {
          id: 'm-leaked-fence-blank-hole',
          role: 'agent',
          ts: 1_000,
          content:
            '执行摘要\n\n```bash\nnpm run inspect' +
            blankRun +
            '- validate_clickhouse_to_postgres.py\n- checkpoint_summary.py',
        },
      ],
      runPhase: 'idle',
    })

    const normalized = getParsedMarkdownInputs()[0]
    expect(normalized).toContain('```bash\nnpm run inspect\n\n\n```')
    expect(normalized).toContain('\n- validate_clickhouse_to_postgres.py')
    expect(normalized).not.toContain('\n'.repeat(20))
  })

  it('keeps intentional blank lines inside valid fenced code blocks', () => {
    const { dispatch, getParsedMarkdownInputs } = createHarness()
    const content = '```txt\nline 1\n\n\n\n\nline 2\n```'

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      messages: [{ id: 'm-valid-fence-blanks', role: 'agent', ts: 1_000, content }],
      runPhase: 'idle',
    })

    expect(getParsedMarkdownInputs()[0]).toBe(content)
  })

  it('closes a leaked fenced code block at the end of a message', () => {
    const { dispatch, getParsedMarkdownInputs } = createHarness()

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      messages: [
        {
          id: 'm-eof-fence',
          role: 'agent',
          ts: 1_000,
          content: '命令：\n\n```bash\nnpm run dev:h5',
        },
      ],
      runPhase: 'idle',
    })

    expect(getParsedMarkdownInputs()[0]).toBe('命令：\n\n```bash\nnpm run dev:h5\n```')
  })

  it('leaves valid fenced code blocks unchanged', () => {
    const { dispatch, getParsedMarkdownInputs } = createHarness()
    const content = '```bash\nnpm run dev:h5\n```'

    dispatch({
      type: 'init',
      theme: { isDark: false, colors: {} },
      messages: [{ id: 'm-code-ok', role: 'agent', ts: 1_000, content }],
      runPhase: 'idle',
    })

    expect(getParsedMarkdownInputs()[0]).toBe(content)
  })
})
