// @arch docs/features/agent-workspaces.md#四信息架构
// @arch docs/design/desktop/unified-desktop-control.md
// @test ../../__tests__/desktop-agent-detail-screen.test.ts

import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import {
  getAgentDisplayName,
  getProjectDirName,
  useMachinesStore,
} from '@shennian/shared'
import type { AgentWorkspace } from '@shennian/wire'
import { useAuthStore } from '../../config/auth'
import { useTheme } from '../../hooks/useTheme'
import { getMachineAgentModels, getModelDisplayName } from '../../utils/models'
import { RoomIdentityAvatar } from '../rooms/components/RoomIdentityAvatar'

/** Desktop-owned identity and private configuration summary. It never exposes the private prompt. */
export function DesktopAgentOverview({ agent, onEdit }: {
  agent: AgentWorkspace
  onEdit?: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const owner = useAuthStore((state) => state.user)
  const machine = useMachinesStore((state) => state.machines.find((item) => item.id === agent.machineId))
  const runtime = agent.runtimeAdapter ? getAgentDisplayName(agent.runtimeAdapter) : t('agents_unconfigured')
  const model = agent.runtimeAdapter
    ? (getModelDisplayName(getMachineAgentModels(machine, agent.runtimeAdapter), agent.modelId) ??
      agent.modelId ?? t('agents_default_model'))
    : t('agents_default_model')
  const summary = [agent.machineName || machine?.name, getProjectDirName(agent.workDir), runtime, model].filter(Boolean).join(' · ')

  return <View testID="desktop-agent-overview" style={styles.root}>
    <View style={[styles.publicSection, { borderBottomColor: colors.border }]}>
      <Pressable testID="desktop-agent-overview-edit" accessibilityRole={onEdit ? 'button' : undefined}
        accessibilityLabel={onEdit ? t('agents_edit') : undefined} disabled={!onEdit} onPress={onEdit}
        style={({ pressed }) => [styles.identity, pressed && { backgroundColor: colors.surfaceHover }]}>
        <RoomIdentityAvatar name={agent.displayName} avatar={agent.avatar} agent
          ownerName={owner?.name} ownerAvatar={owner?.avatar} size={36} />
        <View style={styles.identityCopy}>
          <Text numberOfLines={1} {...{title: agent.displayName}} style={[styles.name, { color: colors.text }]}>{agent.displayName}</Text>
          {agent.description ? <Text numberOfLines={2} style={[styles.description, { color: colors.textSecondary }]}>
            {agent.description}
          </Text> : null}
        </View>
        {onEdit ? <View style={styles.editAccessory}>
          <Text style={[styles.editText, { color: colors.brand }]}>{t('edit')}</Text>
        </View> : null}
      </Pressable>
    </View>
    <Text selectable numberOfLines={2} {...{title: summary}} style={[styles.summary, { color: colors.textSecondary }]}>{summary}</Text>
  </View>
}

const styles = StyleSheet.create({
  root: { width: '100%', paddingVertical: 16, gap: 10 },
  publicSection: {},
  identity: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 },
  identityCopy: { flex: 1, minWidth: 0 },
  name: { fontSize: 17, lineHeight: 24, fontWeight: '600' },
  description: { marginTop: 3, fontSize: 14, lineHeight: 20 },
  editAccessory: { width: 44, height: 36, alignItems: 'flex-end', justifyContent: 'center' },
  editText: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  summary: { fontSize: 13, lineHeight: 20 },
})
