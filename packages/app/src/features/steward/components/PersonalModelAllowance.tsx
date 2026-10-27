// @arch docs/features/builtin-personal-agent.md
// @test src/__tests__/steward-settings-behavior.test.ts
import { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../../config/auth'
import { useTheme } from '../../../hooks/useTheme'
import { personalModelClient, type PersonalModelQuota } from '../personalModelClient'

/** Account allowance does not depend on the primary computer being connected. */
export function PersonalModelAllowance({ mode }: { mode: 'official' | 'custom' }) {
  const { t } = useTranslation(), { colors } = useTheme()
  const accountId = useAuthStore(s => s.user?.id), generation = useRef(0)
  const [quota, setQuota] = useState<PersonalModelQuota>()
  const [loading, setLoading] = useState(false), [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const current = ++generation.current
    setQuota(undefined); setLoading(!!accountId)
    if (!accountId) return
    void personalModelClient.quota().then(value => {
      if (current !== generation.current || useAuthStore.getState().user?.id !== accountId) return
      const unlimited = value.unlimited === true && value.limit === null && value.remaining === null
      const limited = value.unlimited !== true && Number.isSafeInteger(value.limit) && value.limit! > 0 && Number.isSafeInteger(value.remaining) && value.remaining! >= 0 && value.remaining! <= value.limit! && Number.isFinite(Date.parse(value.resetsAt)) && Number.isFinite(value.outputWeight) && value.outputWeight > 0
      if (unlimited || limited) setQuota(value)
    }).catch(() => {}).finally(() => { if (current === generation.current) setLoading(false) })
    return () => { generation.current++ }
  }, [accountId, refresh])
  return <View testID="personal-model-quota" style={[styles.card, { borderColor: colors.border }]}>
    <Text style={{ color: colors.textSecondary }}>{t('personal_model_quota_title')}</Text>
    <Text testID="personal-model-quota-value" style={[styles.value, { color: colors.text }]}>
      {loading ? t('personal_model_quota_loading') : !quota ? t('personal_model_quota_unavailable') : quota.unlimited ? t('personal_model_quota_unlimited') : t('personal_model_quota_units', { remaining: quota.remaining.toLocaleString() })}
    </Text>
    {quota && !quota.unlimited ? <>
      <Text style={{ color: colors.textSecondary }}>{t('personal_model_quota_detail', { limit: quota.limit.toLocaleString(), date: new Date(quota.resetsAt).toLocaleDateString(undefined, { timeZone: 'Asia/Shanghai' }) })}</Text>
      <Text style={{ color: colors.textSecondary }}>{t('personal_model_quota_weight', { weight: quota.outputWeight })}</Text>
    </> : null}
    {mode === 'custom' ? <Text style={{ color: colors.textSecondary }}>{t('personal_model_quota_custom')}</Text> : null}
    <Pressable testID="personal-model-quota-refresh" accessibilityRole="button" disabled={loading || !accountId} onPress={() => setRefresh(n => n + 1)} style={styles.refresh}>
      <Text style={{ color: colors.brand }}>{t('personal_model_quota_refresh')}</Text>
    </Pressable>
  </View>
}
const styles = StyleSheet.create({ card: { borderWidth: 1, borderRadius: 12, padding: 16, gap: 8 }, value: { fontSize: 24, fontWeight: '600' }, refresh: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 8 } })
