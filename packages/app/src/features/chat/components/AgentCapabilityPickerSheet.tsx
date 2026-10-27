import { ActionIcon } from '../../../components/ActionIcon'
// @arch docs/features/agent-native-capabilities.md
// @test src/__tests__/agent-capabilities-source.test.ts

import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import Feather from '@expo/vector-icons/Feather'
import { useTranslation } from 'react-i18next'
import type { AgentNativeCapability } from '@shennian/wire'
import BottomSheet from '../../../components/BottomSheet'
import type { Colors } from '../../../hooks/useTheme'

type Props = {
  visible: boolean
  colors: Colors
  agentLabel: string
  capabilities: AgentNativeCapability[]
  loading: boolean
  onClose: () => void
  onRefresh: () => void
  onSelect: (capability: AgentNativeCapability) => void
}

export function AgentCapabilityPickerSheet(props: Props) {
  const { t } = useTranslation()
  return (
    <BottomSheet
      isOpen={props.visible}
      onClose={props.onClose}
      title={t('agent_capabilities_title', { agent: props.agentLabel })}
      preferDialogOnWeb
      headerRight={
        <Pressable
          style={[styles.iconButton, { backgroundColor: props.colors.surfaceHover }]}
          onPress={props.onRefresh}
          disabled={props.loading}
          accessibilityLabel={t('refresh')}
        >
          <Feather name="refresh-cw" size={15} color={props.colors.textSecondary} />
        </Pressable>
      }
    >
      {props.loading && props.capabilities.length === 0 ? (
        <View style={styles.loading}><ActivityIndicator color={props.colors.brand} /></View>
      ) : props.capabilities.length === 0 ? (
        <View style={styles.empty}>
          <Feather name="package" size={24} color={props.colors.textTertiary} />
          <Text style={[styles.emptyTitle, { color: props.colors.text }]}>{t('agent_capabilities_empty')}</Text>
          <Text style={[styles.emptyDescription, { color: props.colors.textSecondary }]}>
            {t('agent_capabilities_empty_desc', { agent: props.agentLabel })}
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {props.capabilities.map((capability) => (
            <Pressable
              key={capability.id}
              style={({ pressed }) => [
                styles.row,
                { borderColor: props.colors.border, backgroundColor: pressed ? props.colors.surfaceHover : props.colors.surface },
              ]}
              onPress={() => props.onSelect(capability)}
              accessibilityLabel={`${capability.name} ${capability.invocation}`}
            >
              <View style={[styles.icon, { backgroundColor: `${props.colors.brand}12` }]}>
                <Feather name={capability.kind === 'plugin_skill' ? 'package' : 'zap'} size={16} color={props.colors.brand} />
              </View>
              <View style={styles.body}>
                <View style={styles.titleRow}>
                  <Text style={[styles.name, { color: props.colors.text }]} numberOfLines={1}>{capability.name}</Text>
                  <Text style={[styles.invocation, { color: props.colors.brand, backgroundColor: `${props.colors.brand}10` }]}>
                    {capability.invocation}
                  </Text>
                </View>
                {capability.description ? (
                  <Text style={[styles.description, { color: props.colors.textSecondary }]} numberOfLines={2}>{capability.description}</Text>
                ) : null}
                <Text style={[styles.source, { color: props.colors.textTertiary }]}>{t(`agent_capability_source_${capability.source}`)}</Text>
              </View>
              <ActionIcon name="add" color={props.colors.textTertiary} />
            </Pressable>
          ))}
        </View>
      )}
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  iconButton: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  loading: { minHeight: 160, alignItems: 'center', justifyContent: 'center' },
  empty: { minHeight: 180, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '700' },
  emptyDescription: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
  list: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 11, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12 },
  icon: { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '700' },
  invocation: { overflow: 'hidden', borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3, fontSize: 11, fontWeight: '700' },
  description: { fontSize: 13, lineHeight: 18 },
  source: { fontSize: 11 },
})
