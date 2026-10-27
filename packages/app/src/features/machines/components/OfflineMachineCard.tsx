// @arch docs/architecture/app/modular-features.md#机器-feature
// @test src/__tests__/machine-feature-utils.test.ts

import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import Ionicons from '@expo/vector-icons/Ionicons'
import { getAgentDisplayName } from '@shennian/shared'
import { filterAvailableAgentTypes, type AgentType, type Machine } from '@shennian/wire'
import { useTheme } from '../../../hooks/useTheme'
import { machineStyles } from '../styles'
import { useMachineCardActions } from '../hooks/useMachineCardActions'

export function OfflineMachineCard({ machine }: { machine: Machine }) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const actions = useMachineCardActions(machine, t)
  const offlineAgentList = filterAvailableAgentTypes(machine.agentList) as AgentType[]

  return (
    <View style={[machineStyles.card, machineStyles.offlineCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={machineStyles.cardHeader}>
        <View style={machineStyles.cardIdentity}>
          <View style={[machineStyles.statusDot, { backgroundColor: colors.border }]} />
          {actions.editing ? (
            <>
              <TextInput
                ref={actions.inputRef}
                value={actions.nameInput}
                onChangeText={actions.setNameInput}
                placeholder={t('rename_machine_placeholder')}
                placeholderTextColor={colors.textTertiary}
                style={[
                  machineStyles.cardNameInput,
                  { borderColor: colors.brand, color: colors.text, backgroundColor: colors.bg },
                ]}
                editable={!actions.saving}
                onSubmitEditing={() => void actions.confirmRename()}
                returnKeyType="done"
                autoCorrect={false}
              />
              {actions.saving ? (
                <ActivityIndicator size="small" color={colors.brand} />
              ) : (
                <>
                  <Pressable
                    onPress={actions.cancelEdit}
                    style={machineStyles.nameActionIconBtn}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={t('cancel')}
                  >
                    <Ionicons name="close" size={16} color={colors.textTertiary} />
                  </Pressable>
                  <Pressable
                    onPress={() => void actions.confirmRename()}
                    style={machineStyles.nameActionIconBtn}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={t('confirm')}
                  >
                    <Ionicons name="checkmark" size={16} color={colors.brand} />
                  </Pressable>
                </>
              )}
            </>
          ) : (
            <>
              {actions.isOwner ? (
                <Pressable
                  onPress={actions.startEdit}
                  style={machineStyles.cardNamePressable}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t('rename_machine')}
                >
                  <Text style={[machineStyles.cardName, { color: colors.textTertiary }]} numberOfLines={1}>
                    {machine.name}
                  </Text>
                </Pressable>
              ) : (
                <Text style={[machineStyles.cardName, { color: colors.textTertiary }]} numberOfLines={1}>
                  {machine.name}
                </Text>
              )}
            </>
          )}
        </View>
        <View style={[machineStyles.offlineBadge, { backgroundColor: colors.border + '40' }]}>
          <Text style={[machineStyles.offlineBadgeText, { color: colors.textTertiary }]}>{t('machine_offline')}</Text>
        </View>
      </View>
      {actions.renameError ? (
        <Text style={[machineStyles.errorText, { color: colors.error, marginTop: 8 }]}>{actions.renameError}</Text>
      ) : null}

      <View style={[machineStyles.badgeRow, { marginTop: 10, opacity: 0.35 }]}>
        {offlineAgentList.map((agent) => (
          <View key={agent} style={[machineStyles.agentBadge, { backgroundColor: colors.border + '60', borderColor: 'transparent' }]}>
            <Text style={[machineStyles.agentBadgeText, { color: colors.textTertiary }]}>
              {getAgentDisplayName(agent)}
            </Text>
          </View>
        ))}
      </View>

      <Text style={[machineStyles.offlineHint, { color: colors.textTertiary }]}>
        {t('machine_offline_restart_hint')}
      </Text>
    </View>
  )
}
