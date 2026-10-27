// @arch docs/features/machine-onboarding.md
// @test ../../../__tests__/first-machine-setup.test.ts
import { useState, type ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import * as Clipboard from 'expo-clipboard'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { AppPageHeader } from '../../../components/AppPageHeader'
import { useGoBack } from '../../../hooks/useGoBack'
import { useTheme } from '../../../hooks/useTheme'
import { mobileTypography } from '../../../theme/mobileTypography'
import { copySetupText } from '../utils/setupClipboard'
import { useMachineCodeClaim } from '../hooks/useMachineCodeClaim'
import { SHENNIAN_AGENT_INSTALL_DOC_URL } from '../installPrompt'
import { getServerUrl, isSelfHostedSelection } from '../../../config/server'

export default function AddMachineScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const goBack = useGoBack()
  const { from } = useLocalSearchParams<{ from?: string }>()
  const claim = useMachineCodeClaim({ from })
  const [inputFocused, setInputFocused] = useState(false)
  const canSubmit = !claim.busy && claim.input.trim().length > 0
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      <AppPageHeader title={t('add_machine')} onBack={goBack} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: colors.groupedBackground ?? colors.surface }}
        contentContainerStyle={styles.scroll}
      >
        <Section title={t('setup_step_install')}>
          <InstallPrompt />
        </Section>

        <Section title={t('setup_step_connect')}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.navigate('/(main)/scan')}
            style={({ pressed }) => [
              styles.row,
              {
                backgroundColor: pressed ? colors.surfaceHover : colors.groupedSurface ?? colors.bg,
              },
            ]}
          >
            <Ionicons name="scan-outline" size={22} color={colors.brand} />
            <View style={styles.rowCopy}>
              <Text style={[styles.rowLabel, { color: colors.text }]}>{t('scan_machine_cta')}</Text>
              <Text style={[styles.rowDescription, { color: colors.textSecondary }]}>
                {t('setup_scan_summary')}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </Pressable>
          <View
            style={[
              styles.row,
              styles.divider,
              {
                borderTopColor: colors.groupedSeparator ?? colors.border,
                backgroundColor: colors.groupedSurface ?? colors.bg,
              },
            ]}
          >
            <Ionicons name="keypad-outline" size={22} color={colors.brand} />
            <TextInput
              testID="add-machine-pair-code"
              value={claim.input}
              onChangeText={claim.setInput}
              editable={!claim.busy}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              onSubmitEditing={() => void claim.submit()}
              accessibilityLabel={t('setup_pair_code_placeholder')}
              placeholder={t('setup_pair_code_placeholder')}
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              style={[
                styles.input,
                { color: colors.text, borderBottomColor: inputFocused ? colors.brand : 'transparent' },
              ]}
            />
            <Pressable
              testID="add-machine-pair-submit"
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSubmit, busy: claim.busy }}
              disabled={!canSubmit}
              onPress={() => void claim.submit()}
              style={({ pressed }) => [
                styles.connect,
                { backgroundColor: colors.brand, opacity: !canSubmit ? 0.4 : pressed ? 0.75 : 1 },
              ]}
            >
              {claim.busy ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.connectLabel}>{t('setup_connect')}</Text>
              )}
            </Pressable>
          </View>
        </Section>
        {claim.error ? (
          <Text accessibilityRole="alert" style={[styles.error, { color: colors.errorText }]}>
            {claim.error}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme()
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.text }]}>
        {title}
      </Text>
      <View
        style={[
          styles.group,
          {
            backgroundColor: colors.groupedSurface ?? colors.bg,
            borderColor: colors.groupedSeparator ?? colors.border,
          },
        ]}
      >
        {children}
      </View>
    </View>
  )
}

function InstallPrompt() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const prompt = isSelfHostedSelection()
    ? t('setup_selfhost_client_install_prompt', { server: getServerUrl() })
    : t('setup_client_install_prompt', { url: SHENNIAN_AGENT_INSTALL_DOC_URL })
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copy = async () => {
    const result = await copySetupText(prompt, Clipboard.setStringAsync)
    setStatus(result)
    if (result === 'copied') setTimeout(() => setStatus('idle'), 1500)
  }
  return (
    <View testID="client-install-prompt" style={styles.prompt}>
      <View style={styles.promptHeader}>
        <View style={styles.promptIntro}>
          <Text style={[styles.promptLabel, { color: colors.text }]}>
            {t('setup_install_with_ai')}
          </Text>
          <Text style={[styles.promptInstruction, { color: colors.textSecondary }]}>
            {t('setup_copy_prompt_to_computer_ai')}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(status === 'copied' ? 'copied' : 'setup_copy_install_prompt')}
          onPress={() => void copy()}
          style={({ pressed }) => [
            styles.copy,
            { backgroundColor: colors.brandLight, opacity: pressed ? 0.55 : 1 },
          ]}
        >
          <Ionicons
            name={status === 'copied' ? 'checkmark' : 'copy-outline'}
            size={20}
            color={colors.brand}
          />
        </Pressable>
      </View>
      <View style={[styles.promptCard, { backgroundColor: colors.brandLight }]}>
        <Text selectable style={[styles.promptText, { color: colors.text }]}>
          {prompt}
        </Text>
      </View>
      {status === 'failed' ? (
        <Text accessibilityRole="alert" style={{ ...mobileTypography.metadata, color: colors.errorText }}>
          {t('setup_copy_failed')}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 40, gap: 28 },
  section: { gap: 10 },
  sectionTitle: { ...mobileTypography.sectionTitle, paddingHorizontal: 4 },
  group: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    overflow: 'hidden',
  },
  row: {
    minHeight: 56,
    paddingHorizontal: 20,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  divider: { borderTopWidth: StyleSheet.hairlineWidth },
  rowLabel: { ...mobileTypography.body, flex: 1 },
  rowCopy: { minWidth: 0, flex: 1, gap: 2 },
  rowDescription: { ...mobileTypography.metadata },
  prompt: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 14, gap: 12 },
  promptHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  promptIntro: { minWidth: 0, flex: 1, gap: 4 },
  promptLabel: { ...mobileTypography.body, fontWeight: '600' },
  promptInstruction: { ...mobileTypography.metadata },
  promptCard: {
    borderRadius: 12,
    padding: 14,
  },
  promptText: { ...mobileTypography.secondary, flex: 1 },
  copy: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    ...mobileTypography.body,
    flex: 1,
    minWidth: 0,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  connect: {
    minWidth: 64,
    minHeight: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectLabel: { ...mobileTypography.compactAction, color: '#fff' },
  error: { ...mobileTypography.secondary, paddingHorizontal: 20, marginTop: -16 },
})
