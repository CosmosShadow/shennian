// @vitest-environment happy-dom
// @covers packages/app/src/features/projects/coordination/ProjectCoordinationQuestions.tsx
// @covers packages/app/src/features/projects/coordination/ProjectCoordinationPendingRows.tsx
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() },
  View: ({ children }: any) => React.createElement('div', null, children), Text: ({ children }: any) => React.createElement('span', null, children),
  TextInput: ({ value, onChangeText, accessibilityLabel }: any) => React.createElement('textarea', { value, 'aria-label': accessibilityLabel, onChange: (e: any) => onChangeText(e.target.value) }),
  Pressable: ({ children, onPress, disabled }: any) => React.createElement('button', { onClick: onPress, disabled }, children),
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ colors: {} }) }))
vi.mock('../features/privacy/useAiDataConsent', () => ({ usePersonalAiDataConsent: () => async () => true }))
vi.mock('@shennian/shared', () => ({ formatSessionPreviewForDisplay: (value: string) => value }))
vi.mock('../config/api', () => ({ authApi: vi.fn() }))
import { ProjectCoordinationQuestionCard } from '../features/projects/coordination/ProjectCoordinationQuestions'
import { ProjectCoordinationPendingRows } from '../features/projects/coordination/ProjectCoordinationPendingRows'
it('answers an explicit manager question through its exact id', async () => {
  const host = document.createElement('div'), root = createRoot(host), answer = vi.fn(async () => ({}))
  await act(async () => root.render(React.createElement(ProjectCoordinationQuestionCard, { question: { id: 'question-qa', question: 'Which requirement?', options: ['A', 'B'], at: 1 }, disabled: false, onAnswer: answer })))
  expect(host.textContent).toContain('coordination_question_title')
  await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'A')!.click())
  expect(answer).toHaveBeenCalledWith('question-qa', 'A')
  await act(async () => root.unmount())
})
it('shows pending questions and actionable tasks absent from the loaded session page', async () => {
  const host = document.createElement('div'), root = createRoot(host), manager = vi.fn(), task = vi.fn()
  const state = { tasks: [{ id: 'not-loaded', title: 'Needs input', status: 'waiting', waitingReason: 'waiting_user_input' }, { id: 'failed', status: 'failed', title: 'Manager handles this' }], questions: [{ id: 'question-qa', question: 'Which requirement?', options: [] }] } as any
  await act(async () => root.render(React.createElement(ProjectCoordinationPendingRows, { state, sessions: [], filter: 'attention', onManager: manager, onTask: task })))
  expect(host.querySelectorAll('button')).toHaveLength(2)
  expect(host.textContent).not.toContain('Manager handles this')
  await act(async () => host.querySelectorAll('button')[0]!.click())
  await act(async () => host.querySelectorAll('button')[1]!.click())
  expect(manager).toHaveBeenCalledOnce(); expect(task).toHaveBeenCalledWith('not-loaded')
  await act(async () => root.unmount())
})
