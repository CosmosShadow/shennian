// @arch docs/design/project-coordination-ios.md
// @test src/__tests__/project-coordination-questions.test.ts
import { useState } from 'react'
import { Alert, Pressable, Text, TextInput, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../hooks/useTheme'
import { usePersonalAiDataConsent } from '../../privacy/useAiDataConsent'
import { mobileTypography } from '../../../theme/mobileTypography'
import type { CoordinationQuestion } from './client'

export function ProjectCoordinationQuestionCard({ question, disabled, onAnswer }: {
  question: CoordinationQuestion; disabled: boolean; onAnswer: (id: string, answer: string) => Promise<unknown>
}) {
  const { t } = useTranslation(), { colors } = useTheme()
  const ensureConsent = usePersonalAiDataConsent()
  const [draft, setDraft] = useState(''), [busy, setBusy] = useState(false)
  const send = async (answer: string) => {
    if (!answer.trim() || disabled || busy) return
    setBusy(true)
    try { if (await ensureConsent()) await onAnswer(question.id, answer.trim()) }
    catch { Alert.alert(t('coordination_action_failed'), t('coordination_error')) }
    finally { setBusy(false) }
  }
  return <View style={{ padding: 16, gap: 10, borderBottomWidth: 0.5, borderBottomColor: colors.border, backgroundColor: colors.ownMessage }}>
    <Text style={[mobileTypography.compactAction, { color: colors.brand }]}>{t('coordination_question_title')}</Text>
    <Text style={[mobileTypography.body, { color: colors.text }]}>{question.question}</Text>
    {question.options.map(option => <Pressable key={option} disabled={disabled || busy} accessibilityRole="button" onPress={() => void send(option)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={[mobileTypography.body, { color: colors.brand }]}>{option}</Text></Pressable>)}
    <TextInput maxLength={20000} value={draft} onChangeText={setDraft} editable={!disabled && !busy} multiline accessibilityLabel={t('coordination_answer_placeholder')} placeholder={t('coordination_answer_placeholder')} placeholderTextColor={colors.textMuted} style={[mobileTypography.body, { color: colors.text, backgroundColor: colors.bg, padding: 12, borderRadius: 12, minHeight: 48 }]} />
    <Pressable disabled={disabled || busy || !draft.trim()} accessibilityRole="button" accessibilityLabel={t('coordination_answer_send')} onPress={() => void send(draft)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={[mobileTypography.compactAction, { color: colors.brand }]}>{t(busy ? 'coordination_loading' : 'coordination_answer_send')}</Text></Pressable>
  </View>
}
