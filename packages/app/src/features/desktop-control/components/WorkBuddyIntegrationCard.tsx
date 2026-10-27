// @arch docs/architecture/compatibility.md
// @test packages/app/src/__tests__/workbuddy-integration-ui.test.ts

import Ionicons from '@expo/vector-icons/Ionicons'
import { useCallback, useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../../hooks/useTheme'
import type {
  DesktopBridge,
  DesktopWorkBuddyIntegrationStatus,
} from '../types'

type Props = {
  bridge: DesktopBridge | null
  cliVersion?: string
}

type ButtonProps = {
  label: string
  icon: keyof typeof Ionicons.glyphMap
  variant?: 'primary' | 'secondary' | 'danger'
  disabled?: boolean
  onPress: () => void
}

function Button({ label, icon, variant = 'secondary', disabled, onPress }: ButtonProps) {
  const { colors } = useTheme()
  const emphasized = variant === 'primary' || variant === 'danger'
  const backgroundColor = variant === 'primary'
    ? colors.brand
    : variant === 'danger' ? colors.error : colors.surfaceHover
  const foregroundColor = emphasized ? '#ffffff' : colors.text
  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        { backgroundColor, opacity: disabled ? 0.45 : pressed ? 0.82 : 1 },
      ]}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Ionicons name={icon} size={16} color={foregroundColor} />
      <Text style={[styles.buttonText, { color: foregroundColor }]}>{label}</Text>
    </Pressable>
  )
}

export function WorkBuddyIntegrationCard({ bridge, cliVersion }: Props) {
  const { colors } = useTheme()
  const [status, setStatus] = useState<DesktopWorkBuddyIntegrationStatus | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!bridge?.getWorkBuddyIntegration) return
    setPending(true)
    try {
      const result = await bridge.getWorkBuddyIntegration()
      if (!result.ok || !result.status) throw new Error(result.errorCode ?? 'integration_status_failed')
      setStatus(result.status)
      setError(null)
    } catch {
      setError('暂时无法读取 WorkBuddy 连接状态')
    } finally {
      setPending(false)
    }
  }, [bridge])

  useEffect(() => {
    void refresh()
  }, [cliVersion, refresh])

  return (
    <View testID="workbuddy-integration-card" style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.header}>
        <View style={[styles.icon, { backgroundColor: colors.brandLight }]}>
          <Ionicons name="git-network-outline" size={20} color={colors.brand} />
        </View>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.text }]}>连接 WorkBuddy</Text>
          <Text style={[styles.subtitle, { color: colors.textTertiary }]}>让当前 WorkBuddy 对话安全关联到神念群聊</Text>
        </View>
        <Text style={[styles.state, { color: status?.state === 'enabled' ? colors.success : colors.textTertiary }]}>
          {pending
            ? '检测中'
            : status?.state === 'enabled'
              ? '已连接'
              : status?.state === 'disabled'
                ? '已暂停'
                : status?.state === 'conflict'
                  ? '需要处理'
                  : status?.state === 'unavailable'
                    ? '未安装 WorkBuddy'
                    : '未连接'}
        </Text>
      </View>

      <Text style={[styles.description, { color: colors.textSecondary }]}>
        {status?.state === 'enabled'
          ? '神念只在本机接收会话标识和运行状态，不读取提示词、回复正文、凭据或完整历史。'
          : status?.state === 'disabled'
            ? '连接组件仍在本机，但不会接收新的 WorkBuddy 会话事件。'
            : status?.state === 'conflict'
              ? '检测到同名但来源不同的插件。为避免覆盖未知代码，神念已停止自动处理。'
              : status?.state === 'unavailable'
                ? '安装 WorkBuddy 后可按其官方指引连接；神念 Desktop 只检测状态，不会代为安装第三方 Agent。'
                : '请在 WorkBuddy 的官方界面管理连接。神念 Desktop 不安装、升级、登录或修改第三方 Agent 配置。'}
      </Text>

      {status?.installedVersion ? (
        <Text style={[styles.version, { color: colors.textTertiary }]}>版本 {status.installedVersion}</Text>
      ) : null}
      {status?.restartRequired ? (
        <Text style={[styles.notice, { color: colors.warning }]}>请新开或重启 WorkBuddy 对话使更改生效。</Text>
      ) : null}
      {error ? <Text style={[styles.notice, { color: colors.error }]}>{error}</Text> : null}

      <View style={styles.actions}>
        <Button label="刷新" icon="refresh-outline" disabled={pending} onPress={() => void refresh()} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, fontWeight: '800' },
  subtitle: { fontSize: 12, lineHeight: 18, marginTop: 3 },
  state: { fontSize: 12, fontWeight: '800' },
  description: { fontSize: 13, lineHeight: 20 },
  version: { marginTop: 8, fontSize: 12, fontWeight: '700' },
  notice: { marginTop: 8, fontSize: 12, lineHeight: 18, fontWeight: '700' },
  actions: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: {
    minHeight: 40,
    borderRadius: 12,
    paddingHorizontal: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  buttonText: { fontSize: 14, fontWeight: '800' },
})
