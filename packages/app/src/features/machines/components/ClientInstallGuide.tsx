// @arch docs/features/machine-onboarding.md
// @test ../../../__tests__/desktop-machine-pairing.test.ts
// Desktop mirror of the official site "download & install" step; the mobile page uses native grouped rows.
import { useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import * as Clipboard from 'expo-clipboard'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../hooks/useTheme'
import { copySetupText } from '../utils/setupClipboard'
import { SHENNIAN_AGENT_INSTALL_DOC_URL } from '../installPrompt'

const size = { step: 18, stepLine: 24, title: 16, body: 14, prompt: 15, promptLine: 24 } as const

export function SetupStepHeading({
  index,
  title,
}: {
  index: number
  title: string
}) {
  const { colors } = useTheme()
  return (
    <View style={styles.stepHeading}>
      <Text style={[styles.stepIndexText, { color: colors.brand }]}>
        {String(index).padStart(2, '0')}
      </Text>
      <Text
        accessibilityRole="header"
        style={{ flex: 1, fontSize: size.step, lineHeight: size.stepLine, fontWeight: '600', color: colors.text }}
      >
        {title}
      </Text>
    </View>
  )
}

export function ClientInstallGuide({
  onOpenManualInstall,
}: {
  onOpenManualInstall: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const prompt = t('setup_client_install_prompt', { url: SHENNIAN_AGENT_INSTALL_DOC_URL })
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const inFlight = useRef(false)
  const copy = async () => {
    if (inFlight.current) return
    inFlight.current = true
    const result = await copySetupText(prompt, Clipboard.setStringAsync)
    setStatus(result)
    inFlight.current = false
    if (result === 'copied') setTimeout(() => setStatus('idle'), 1500)
  }
  return (
    <View style={styles.guide}>
      <View style={styles.introRow}>
        <View style={styles.introCopy}>
          <Text style={{ fontSize: size.title, lineHeight: size.title + 6, fontWeight: '600', color: colors.text }}>
            {t('setup_install_with_ai')}
          </Text>
          <Text style={{ fontSize: size.body, lineHeight: size.body + 6, color: colors.text }}>
            {t('setup_copy_prompt_to_computer_ai')}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(status === 'copied' ? 'copied' : 'setup_copy_install_prompt')}
          hitSlop={8}
          onPress={() => {
            void copy()
          }}
          style={({ pressed }) => [
            styles.copyButton,
            { backgroundColor: pressed ? `${colors.brand}26` : `${colors.brand}14` },
          ]}
        >
          <Ionicons
            name={status === 'copied' ? 'checkmark' : 'copy-outline'}
            size={18}
            color={colors.brand}
          />
        </Pressable>
      </View>
      <View
        testID="client-install-prompt"
        style={[styles.promptCard, { borderColor: `${colors.brand}55`, backgroundColor: colors.brandLight }]}
      >
        <Text
          selectable
          style={{ fontSize: size.prompt, lineHeight: size.promptLine, color: colors.text }}
        >
          {prompt}
        </Text>
      </View>
      {status === 'failed' ? (
        <Text accessibilityRole="alert" style={{ color: colors.errorText }}>
          {t('setup_copy_failed')}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="link"
        onPress={onOpenManualInstall}
        hitSlop={6}
        style={({ pressed }) => [styles.manualLink, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Text style={{ fontSize: size.body, lineHeight: size.body + 6, fontWeight: '600', color: colors.brand }}>
          {t('setup_manual_install_client')}
        </Text>
        <Ionicons name="chevron-forward" size={16} color={colors.brand} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  stepHeading: { flexDirection: 'row', alignItems: 'baseline', gap: 12, paddingHorizontal: 2 },
  stepIndexText: { fontSize: size.step, lineHeight: size.stepLine, fontWeight: '700' },
  guide: { gap: 12 },
  introRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  introCopy: { minWidth: 0, flex: 1, gap: 4 },
  promptCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
  },
  copyButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualLink: {
    minHeight: 32,
    alignSelf: 'flex-start',
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
})
