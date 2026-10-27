// @arch docs/architecture/server/auth-flows.md
// @test src/__tests__/auth-providers.test.ts
import { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import BottomSheet from '../../../components/BottomSheet'
import { AccessibleButton } from '../../../components/AccessibleButton'
import { useTheme } from '../../../hooks/useTheme'
import { useAuthStore } from '../../../config/auth'
import { useNicknamePrompt, type NicknamePrompt } from '../nicknameSetup'

export function NicknameSetupPrompt() {
  const prompt = useNicknamePrompt((state) => state.prompt)
  const accountId = useAuthStore((state) => state.user?.id)
  useEffect(() => {
    if (prompt?.accountId && prompt.accountId !== accountId) prompt.finish()
  }, [accountId, prompt])
  return prompt ? <NicknameEditor key={prompt.id} prompt={prompt} /> : null
}

function NicknameEditor({ prompt }: { prompt: NicknamePrompt }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [name, setName] = useState(prompt.name)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)
  const save = async () => {
    if (inFlight.current) return
    const normalized = name.replace(/\s+/g, ' ').trim()
    if (!normalized) { setError(t('first_login_name_required')); return }
    inFlight.current = true
    setSaving(true)
    setError('')
    try {
      await prompt.save(normalized)
      prompt.finish()
    } catch {
      setError(t('nickname_save_failed'))
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }
  return (
    <BottomSheet isOpen onClose={prompt.finish} title={t('first_login_name_title')}>
      <View style={styles.content}>
        <Text style={[styles.body, { color: colors.textSecondary }]}>{t('first_login_name_body')}</Text>
        <Text style={[styles.body, { color: colors.text }]}>{t('profile_nickname')}</Text>
        <TextInput
          accessibilityLabel={t('profile_nickname')}
          value={name}
          onChangeText={(value) => { setName(value); setError('') }}
          maxLength={40}
          editable={!saving}
          selectTextOnFocus
          returnKeyType="done"
          onSubmitEditing={() => void save()}
          style={[styles.input, { color: colors.text, borderColor: colors.textSecondary }]}
        />
        <Text style={[styles.body, { color: colors.textSecondary }]}>{t('nickname_skip_hint', { name: prompt.name })}</Text>
        {error ? <Text accessibilityRole="alert" style={[styles.body, { color: colors.errorText }]}>{error}</Text> : null}
        <AccessibleButton busy={saving} onPress={() => void save()} style={styles.button}>
          <Text style={[styles.action, { color: colors.brand }]}>{t(saving ? 'nickname_saving' : 'first_login_name_continue')}</Text>
        </AccessibleButton>
        <AccessibleButton onPress={prompt.finish} style={styles.button}>
          <Text style={[styles.body, { color: colors.textSecondary }]}>{t('nickname_skip')}</Text>
        </AccessibleButton>
      </View>
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  content: { gap: 16 },
  body: { fontSize: 17, lineHeight: 24 },
  action: { fontSize: 17, lineHeight: 24, fontWeight: '600' },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 17 },
  button: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
})
