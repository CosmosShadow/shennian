// @vitest-environment happy-dom
// @covers src/project-coordination/workbench-page.ts
import { expect, it, vi } from 'vitest'
import { WORKBENCH_PAGE } from '../project-coordination/workbench-page.js'

it('filters executing work, answers the real task request and reuses a failed send receipt', async () => {
  const state = { enabled: true, tasks: [{ id: 'a', title: 'Executing task', status: 'running', agentType: 'codex' }, { id: 'b', title: 'Queued task', status: 'queued' }], messages: [], instructions: '', automatic: true }
  let failedSend = false
  const api = vi.fn(async (_url: string, init: { body: string }) => {
    const data = JSON.parse(init.body)
    if (data.command === 'message' && !failedSend) { failedSend = true; throw Error('connection lost') }
    const value = data.command === 'task_read' ? { messages: [], permission: { id: 'real-request', questions: [{ id: 'choice', question: 'Choose', options: [{ label: 'A' }, { label: 'B' }] }] } } : state
    return { ok: true, json: async () => value }
  })
  document.documentElement.innerHTML = WORKBENCH_PAGE
  const script = /<script>([\s\S]+)<\/script>/.exec(WORKBENCH_PAGE)![1]!
  new Function('fetch', 'setInterval', 'crypto', script)(api, vi.fn(), { randomUUID: () => `receipt-${Math.random()}` })
  await vi.waitFor(() => expect(document.querySelectorAll('#filters button')).toHaveLength(4))
  ;(document.querySelectorAll('#filters button')[1] as HTMLButtonElement).click()
  expect(document.querySelector('#tasks')?.textContent).toContain('Executing task')
  expect(document.querySelector('#tasks')?.textContent).not.toContain('Queued task')
  ;(document.querySelector('#tasks button') as HTMLButtonElement).click()
  await vi.waitFor(() => expect(document.querySelectorAll('#requests button')).toHaveLength(3))
  const choices = document.querySelectorAll<HTMLButtonElement>('#requests button')
  expect(choices[0]!.getAttribute('aria-pressed')).toBe('false')
  choices[1]!.click(); choices[2]!.click()
  await vi.waitFor(() => expect(api.mock.calls.map(c => JSON.parse(c[1].body))).toContainEqual({ command: 'permission', taskId: 'a', permissionId: 'real-request', optionId: 'input:{"choice":"B"}' }))
  ;(document.querySelector('#chat-tab') as HTMLButtonElement).click()
  const input = document.querySelector<HTMLTextAreaElement>('#input')!
  input.value = 'Fix this'
  const send = () => document.querySelector('#send')!.dispatchEvent(new Event('submit', { cancelable: true }))
  send()
  await vi.waitFor(() => expect(document.querySelector('#error')?.textContent).toBe('connection lost'))
  send()
  await vi.waitFor(() => expect(input.value).toBe(''))
  const sends = api.mock.calls.map(c => JSON.parse(c[1].body)).filter(c => c.command === 'message')
  expect(sends).toHaveLength(2); expect(sends[0].requestId).toBe(sends[1].requestId)
})

it('shows explicit manager questions and removes them after an answer without a Provider grant', async () => {
  const state = { enabled: true, tasks: [{ id: 'done', title: 'Review result', status: 'review' }, { id: 'failed', title: 'Failure for manager', status: 'failed' }], questions: [{ id: 'q1', question: 'Which requirement?', options: ['A', 'B'] }], messages: [], instructions: '', automatic: true }
  const api = vi.fn(async (_url: string, init: { body: string }) => {
    const input = JSON.parse(init.body)
    if (input.command === 'answer') Object.assign(state.questions[0]!, { answer: input.text, answeredAt: 1 })
    return { ok: true, json: async () => state }
  })
  document.documentElement.innerHTML = WORKBENCH_PAGE
  new Function('fetch', 'setInterval', 'crypto', /<script>([\s\S]+)<\/script>/.exec(WORKBENCH_PAGE)![1]!)(api, vi.fn(), { randomUUID: () => 'stable-id' })
  await vi.waitFor(() => expect(document.querySelectorAll('#manager-questions button')).toHaveLength(3))
  ;(document.querySelectorAll('#filters button')[3] as HTMLButtonElement).click()
  expect(document.querySelector('#tasks')?.textContent).toContain('Which requirement?')
  expect(document.querySelector('#tasks')?.textContent).not.toContain('Failure for manager')
  ;(document.querySelector('#manager-questions button') as HTMLButtonElement).click()
  await vi.waitFor(() => expect(document.querySelectorAll('#manager-questions button')).toHaveLength(0))
  expect(api.mock.calls.map(call => JSON.parse(call[1].body))).toContainEqual({ command: 'answer', questionId: 'q1', text: 'A' })
  expect(api.mock.calls.map(call => JSON.parse(call[1].body)).some(input => input.command === 'permission')).toBe(false)
})
