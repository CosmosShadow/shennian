// @vitest-environment happy-dom
// @covers packages/app/src/features/chat/components/AgentUserInputForm.tsx
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
vi.mock('react-native', () => ({
  StyleSheet: { create: (v: unknown) => v }, ActivityIndicator: () => null,
  View: ({ children }: any) => React.createElement('div', null, children), Text: ({ children }: any) => React.createElement('span', null, children),
  TextInput: ({ value, onChangeText, accessibilityLabel }: any) => React.createElement('input', { value, 'aria-label': accessibilityLabel, onChange: (e: any) => onChangeText(e.target.value) }),
  Pressable: ({ children, onPress, accessibilityRole, disabled }: any) => React.createElement('button', { onClick: onPress, role: accessibilityRole, disabled }, children),
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
import { AgentUserInputForm, encodeUserInputAnswers } from '../features/chat/components/AgentUserInputForm'
it('does not submit a default option and sends the selected answer through the request response path', async () => {
  const questions = [{ id: 'choice', question: 'Choose', options: [{ label: 'A' }, { label: 'B' }] }]
  expect(() => encodeUserInputAnswers(questions, {})).toThrow('required')
  const host = document.createElement('div'), root = createRoot(host), submit = vi.fn(async () => {})
  await act(async () => root.render(React.createElement(AgentUserInputForm, { questions, colors: {}, busy: false, onSubmit: submit })))
  const buttons = Array.from(host.querySelectorAll('button'))
  await act(async () => buttons.at(-1)!.click())
  expect(submit).not.toHaveBeenCalled()
  await act(async () => buttons[1]!.click())
  await act(async () => buttons.at(-1)!.click())
  expect(submit).toHaveBeenCalledWith('input:{"choice":"B"}')
  await act(async () => root.unmount())
})
