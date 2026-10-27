// @arch docs/features/desktop-independent-client.md
// @test ../../__tests__/desktop-client-missing-card.test.ts

import Ionicons from '@expo/vector-icons/Ionicons'
import { useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import type { DesktopBridge } from '../desktop-control/types'
import { desktopControlMetrics, desktopTypography } from '../desktop-shell/desktopDesignTokens'
import { openDesktopClientInstallGuide } from './desktopClientInstallation'

type ActionState = 'idle' | 'copied' | 'checking' | 'error'

export function DesktopClientMissingCard({
  bridge,
  onRecheck,
}: {
  bridge: DesktopBridge
  onRecheck(): Promise<unknown>
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [state, setState] = useState<ActionState>('idle')
  const inFlight = useRef(false)
  const run = async (
    action: () => Promise<boolean>,
    success: ActionState = 'idle',
    checking = false,
  ) => {
    if (inFlight.current) return
    inFlight.current = true
    setState(checking ? 'checking' : 'idle')
    try {
      setState((await action()) ? success : 'error')
    } catch {
      setState('error')
    } finally {
      inFlight.current = false
    }
  }
  const recheck = async () => {
    await onRecheck()
    return true
  }
  const prompt = t('desktop_client_install_prompt')
  return (
    <View
      testID="desktop-client-missing"
      accessibilityRole="summary"
      style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}
    >
      <View style={[styles.icon, { backgroundColor: colors.bg }]}>
        <Ionicons name="terminal-outline" size={22} color={colors.brand} />
      </View>
      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.text }]}>
          {t('desktop_client_missing_title')}
        </Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          {t('desktop_client_missing_body')}
        </Text>
        <View style={styles.actions}>
          <ActionButton
            label={state === 'copied' ? t('copied') : t('desktop_client_copy_for_ai')}
            icon={state === 'copied' ? 'checkmark' : 'copy-outline'}
            primary
            disabled={inFlight.current}
            onPress={() => void run(
              () => bridge.clipboard?.writeText(prompt) ?? Promise.resolve(false),
              'copied',
            )}
          />
          <ActionButton
            label={t('desktop_client_manual_install')}
            icon="open-outline"
            disabled={inFlight.current}
            onPress={() => void run(() => openDesktopClientInstallGuide(bridge))}
          />
          <ActionButton
            label={state === 'checking' ? t('ai_setup_checking') : t('desktop_client_recheck')}
            icon="refresh-outline"
            disabled={inFlight.current}
            onPress={() => void run(recheck, 'idle', true)}
          />
        </View>
        {state === 'error' ? (
          <Text accessibilityRole="alert" style={[styles.error, { color: colors.errorText }]}>
            {t('desktop_client_action_failed')}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

function ActionButton({ label, icon, primary = false, disabled, onPress }: {
  label: string
  icon: keyof typeof Ionicons.glyphMap
  primary?: boolean
  disabled: boolean
  onPress(): void
}) {
  const { colors } = useTheme()
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.button,
        {
          borderColor: focused || primary ? colors.brand : colors.border,
          backgroundColor: primary ? colors.brand : pressed ? colors.surfaceHover : colors.bg,
          opacity: disabled ? 0.6 : pressed ? 0.78 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={16} color={primary ? colors.bg : colors.brand} />
      <Text style={[styles.buttonText, { color: primary ? colors.bg : colors.brand }]}>
        {label}
      </Text>
    </Pressable>
  )
}


const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 10, padding: 20, flexDirection: 'row', gap: 16 },
  icon: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1, minWidth: 0, gap: 8 },
  title: { ...desktopTypography.sectionTitle, fontWeight: '600' },
  body: { ...desktopTypography.body, maxWidth: 720 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  button: {
    minHeight: desktopControlMetrics.standardControlHeight,
    borderRadius: desktopControlMetrics.radiusControl,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  buttonText: { ...desktopTypography.control, fontWeight: '600' },
  error: { ...desktopTypography.caption },
})
