// @arch docs/architecture/mobile-navigation.md
// @test src/__tests__/steward-inspiration.test.ts

import { useEffect, useRef, useState } from 'react'
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { mobileTypography } from '../../theme/mobileTypography'
import { StewardInspirationSheet } from './components/StewardInspirationSheet'
import { inspirationSendBlock, readInspirationVisible, writeInspirationVisible } from './inspirationPreferences'

type Options = {
  enabled: boolean; accountId: string; input: string; attachments: number; sending: boolean
  uploading: boolean; editing: boolean; voicePhase: string; ready: boolean
  closeMenu: () => void
  send: (options: { textOverride: string }) => Promise<boolean>
  showError: (message: string) => void
}

export function useStewardInspiration(options: Options) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [open, setOpen] = useState(false)
  const [preference, setPreference] = useState<{ accountId: string; visible: boolean } | null>(null)
  const [saving, setSaving] = useState(false)
  const writing = useRef(false)
  const mounted = useRef(true)
  const latest = useRef(options)
  latest.current = options
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    let active = true
    setOpen(false)
    if (options.enabled) void readInspirationVisible(AsyncStorage, options.accountId).then(visible => {
      if (active) setPreference({ accountId: options.accountId, visible })
    })
    return () => { active = false }
  }, [options.accountId, options.enabled])
  // Do not flash the shortcut before this account's stored preference is known.
  const preferenceReady = preference?.accountId === options.accountId
  const visible = preferenceReady && preference.visible
  const openInspiration = () => {
    if (!options.enabled) return
    Keyboard.dismiss()
    options.closeMenu()
    setOpen(true)
  }
  const toggle = async () => {
    if (writing.current) return
    const accountId = options.accountId
    const next = !visible
    writing.current = true
    setSaving(true)
    try {
      await writeInspirationVisible(AsyncStorage, accountId, next)
      if (mounted.current && latest.current.accountId === accountId) setPreference({ accountId, visible: next })
    } catch (error) {
      if (mounted.current && latest.current.accountId === accountId) options.showError(t('inspiration_save_failed'))
      throw error
    } finally {
      writing.current = false
      if (mounted.current) setSaving(false)
    }
  }
  const block = inspirationSendBlock(options)
  const ui = !options.enabled || !preferenceReady ? null : (
    <>
      {visible ? <View style={styles.row}>
        <Pressable testID="steward-inspiration-open" accessibilityRole="button" accessibilityLabel={t('inspiration_title')}
          onPress={openInspiration} style={({ pressed }) => [styles.button, { backgroundColor: colors.bg, borderColor: colors.separator, opacity: pressed ? 0.7 : 1 }]}>
          <Text style={[styles.label, { color: colors.text }]}>{t('inspiration_title')}</Text>
        </Pressable>
      </View> : null}
      <StewardInspirationSheet isOpen={open} onClose={() => setOpen(false)} shortcutVisible={Boolean(visible)}
        onToggleShortcut={toggle} savingVisibility={saving} disabled={Boolean(block)} disabledReason={block ? t(block) : undefined}
        onSelect={async prompt => {
          // Recheck the latest draft at tap time: never consume unrelated text or attachments.
          const current = latest.current
          if (inspirationSendBlock(current)) return false
          return current.send({ textOverride: prompt })
        }} />
    </>
  )
  return { openInspiration, inspirationUi: ui }
}

const styles = StyleSheet.create({
  row: { position: 'absolute', right: 16, bottom: '100%', paddingBottom: 8, zIndex: 10 },
  button: { minHeight: 44, borderRadius: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.07, shadowRadius: 10, elevation: 3, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 },
  label: { ...mobileTypography.compactAction },
})
