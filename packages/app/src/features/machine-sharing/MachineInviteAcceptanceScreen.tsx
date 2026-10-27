// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @arch docs/architecture/machine-sharing.md
// @test ../../__tests__/machine-sharing-source.test.ts

import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { useMachinesStore } from '@shennian/shared'
import { useAuthStore } from '../../config/auth'
import { AppPageHeader } from '../../components/AppPageHeader'
import { useTheme } from '../../hooks/useTheme'
import { machineAccountClient } from '../machines/machineAccountClient'

type Preview = { machineName: string; ownerName: string; expiresAt: string | null }

function inviteErrorKey(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('cancelled')) return 'machine_invite_cancelled'
  if (message.includes('expired')) return 'machine_invite_expired'
  if (message.includes('used')) return 'machine_invite_used'
  if (message.includes('own_machine')) return 'machine_invite_own'
  return 'machine_invite_unavailable'
}

export default function MachineInviteScreen({ token }: { token: string }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const authenticated = useAuthStore((state) => state.isAuthenticated)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [errorKey, setErrorKey] = useState('')
  const [accepting, setAccepting] = useState(false)

  useEffect(() => {
    setErrorKey('')
    void machineAccountClient.previewGrant(token)
      .then(setPreview)
      .catch((error) => setErrorKey(inviteErrorKey(error)))
  }, [token])

  const accept = async () => {
    if (!authenticated) {
      router.navigate({
        pathname: '/(auth)/login',
        params: { redirect: `/machine-invites/${encodeURIComponent(token)}` },
      })
      return
    }
    setAccepting(true)
    setErrorKey('')
    try {
      const machineId = await machineAccountClient.redeemGrant(token)
      const machines = await machineAccountClient.listMachines()
      useMachinesStore.getState().setMachines(machines)
      router.replace({ pathname: '/(main)/machine/[machineId]', params: { machineId } })
    } catch (error) {
      setErrorKey(inviteErrorKey(error))
    } finally {
      setAccepting(false)
    }
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
      <AppPageHeader title={t('machine_invite_title')} onBack={() => router.back()} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={[styles.icon, { backgroundColor: `${colors.brand}14` }]}>
            <Ionicons name="desktop-outline" size={34} color={colors.brand} />
          </View>
          {errorKey ? (
            <>
              <Text maxFontSizeMultiplier={1.3} style={[styles.title, { color: colors.text }]}>
                {t(errorKey)}
              </Text>
              <Text
                maxFontSizeMultiplier={1.6}
                style={[styles.body, { color: colors.textSecondary }]}
              >
                {t('machine_invite_error_help')}
              </Text>
            </>
          ) : !preview ? (
            <ActivityIndicator color={colors.brand} />
          ) : (
            <>
              <Text
                maxFontSizeMultiplier={1.5}
                style={[styles.eyebrow, { color: colors.textTertiary }]}
              >
                {t('machine_invite_from', { name: preview.ownerName })}
              </Text>
              <Text maxFontSizeMultiplier={1.3} style={[styles.title, { color: colors.text }]}>
                {preview.machineName}
              </Text>
              <Text
                maxFontSizeMultiplier={1.6}
                style={[styles.body, { color: colors.textSecondary }]}
              >
                {preview.expiresAt
                  ? t('machine_share_expires_at', {
                      date: new Date(preview.expiresAt).toLocaleDateString(),
                    })
                  : t('machine_share_never_expires')}
              </Text>
              <View
                style={[
                  styles.warning,
                  { backgroundColor: `${colors.warning}12`, borderColor: `${colors.warning}40` },
                ]}
              >
                <Ionicons name="warning-outline" size={20} color={colors.warning} />
                <Text
                  maxFontSizeMultiplier={1.6}
                  style={[styles.warningText, { color: colors.textSecondary }]}
                >
                  {t('machine_share_risk')}
                </Text>
              </View>
              <Pressable
                onPress={() => void accept()}
                disabled={accepting}
                style={[
                  styles.primary,
                  { backgroundColor: colors.brand, opacity: accepting ? 0.6 : 1 },
                ]}
              >
                {accepting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text maxFontSizeMultiplier={1.4} style={styles.primaryText}>
                    {authenticated
                      ? t('machine_invite_accept')
                      : t('machine_invite_login_accept')}
                  </Text>
                )}
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  content: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  icon: {
    width: 72,
    height: 72,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  eyebrow: { fontSize: 14, fontWeight: '600' },
  title: { fontSize: 26, lineHeight: 34, fontWeight: '700', textAlign: 'center' },
  body: { fontSize: 14, lineHeight: 21, textAlign: 'center' },
  warning: {
    width: '100%',
    maxWidth: 460,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginVertical: 8,
  },
  warningText: { flex: 1, fontSize: 13, lineHeight: 19 },
  primary: {
    width: '100%',
    maxWidth: 460,
    minHeight: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  linkButton: {
    minHeight: 44,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
