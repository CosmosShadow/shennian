// @arch docs/design/project-coordination-ios.md#10-任务内真实确认与输入
// @test src/__tests__/agent-user-input.test.ts
import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import type { AgentUserInputQuestion } from '@shennian/wire'
import { useTranslation } from 'react-i18next'
import { mobileTypography } from '../../../theme/mobileTypography'
export function encodeUserInputAnswers(questions: AgentUserInputQuestion[], answers: Record<string, string>) {
  if (!questions.length || questions.some(q => !answers[q.id]?.trim() || (q.options?.length && !q.isOther && !q.options.some(o => o.label === answers[q.id])))) throw new Error('user_input_required')
  return `input:${JSON.stringify(Object.fromEntries(questions.map(q => [q.id, answers[q.id]])))}`
}
export function AgentUserInputForm({ questions, colors, busy, onSubmit }: { questions: AgentUserInputQuestion[]; colors: any; busy: boolean; onSubmit: (value: string) => Promise<void> }) {
  const { t } = useTranslation(), [answers, setAnswers] = useState<Record<string, string>>({}), [error, setError] = useState('')
  return <View style={styles.form}>
    {questions.map(q => <View key={q.id} style={styles.question}>
      <Text style={[mobileTypography.body, { color: colors.text }]}>{q.question}</Text>
      {q.options?.map(o => <Pressable key={o.label} accessibilityRole="radio" accessibilityState={{ checked: answers[q.id] === o.label, disabled: busy }} disabled={busy}
        onPress={() => setAnswers(a => ({ ...a, [q.id]: o.label }))} style={[styles.choice, { borderColor: answers[q.id] === o.label ? colors.brand : colors.border }]}>
        <Text style={[mobileTypography.body, { color: colors.text }]}>{o.label}</Text>
        {o.description ? <Text style={[mobileTypography.secondary, { color: colors.textMuted }]}>{o.description}</Text> : null}
      </Pressable>)}
      {!q.options?.length || q.isOther ? <TextInput editable={!busy} secureTextEntry={q.isSecret} value={answers[q.id] ?? ''} onChangeText={value => setAnswers(a => ({ ...a, [q.id]: value }))}
        accessibilityLabel={q.question} style={[styles.input, { color: colors.text, borderColor: colors.border }]} /> : null}
    </View>)}
    <Pressable accessibilityRole="button" disabled={busy} onPress={async () => {
      try { const value = encodeUserInputAnswers(questions, answers); setError(''); await onSubmit(value) } catch { setError(t('coordination_input_required')) }
    }} style={[styles.submit, { backgroundColor: colors.brand }]}>
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={[mobileTypography.compactAction, { color: '#fff' }]}>{t('coordination_input_submit')}</Text>}
    </Pressable>
    {error ? <Text accessibilityRole="alert" style={{ color: colors.errorText ?? colors.error }}>{error}</Text> : null}
  </View>
}
const styles = StyleSheet.create({ form: { gap: 12 }, question: { gap: 8 }, choice: { borderWidth: 1, borderRadius: 8, padding: 10, minHeight: 44, justifyContent: 'center' }, input: { minHeight: 44, borderWidth: 1, padding: 10, borderRadius: 8, fontSize: 17 }, submit: { minHeight: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center' } })
