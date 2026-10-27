// @arch docs/architecture/app/modular-features.md#机器-feature
// @test src/__tests__/machine-avatar.test.ts
// @test src/__tests__/machine-feature-utils.test.ts
// @test src/__tests__/machine-primary-shortcut.test.ts

import { ActivityIndicator, Platform, Pressable, Text, TextInput, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { Machine } from '@shennian/wire'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTheme } from '../../../hooks/useTheme'
import type { MachineCardActions } from '../hooks/useMachineCardActions'
import { machineStyles } from '../styles'
import { getMachineOsLabel } from '../utils/launch'
import { MachineAvatar } from './MachineAvatar'
import { mobileTypography } from '../../../theme/mobileTypography'
import { VersionBadge } from './VersionBadge'

const PERMISSION_COLORS_LIGHT: Record<string, { bg: string; text: string }> = {
  view: { bg: '#f3f4f6', text: '#6b7280' },
  use: { bg: '#eff6ff', text: '#2563eb' },
  full: { bg: '#f0fdf4', text: '#16a34a' },
  admin: { bg: '#faf5ff', text: '#7c3aed' },
}

const PERMISSION_COLORS_DARK: Record<string, { bg: string; text: string }> = {
  view: { bg: '#1f2937', text: '#9ca3af' },
  use: { bg: '#172554', text: '#60a5fa' },
  full: { bg: '#052e16', text: '#4ade80' },
  admin: { bg: '#3b0764', text: '#c084fc' },
}

export function MachineNameRow({
  machine,
  actions,
  compact = false,
  agentCount,
  primary = false,
  onPrimaryPress,
}: {
  machine: Machine
  actions: MachineCardActions
  compact?: boolean
  agentCount?: number
  primary?: boolean
  onPrimaryPress?: () => void
}) {
  const { t } = useTranslation()
  const { colors, isDark } = useTheme()
  const secondaryText = Platform.OS === 'web' && !isDark ? '#4b4b4b' : colors.textSecondary
  const tertiaryText = Platform.OS === 'web' && !isDark ? '#6b6b6b' : colors.textTertiary
  const permissionColors = isDark ? PERMISSION_COLORS_DARK : PERMISSION_COLORS_LIGHT
  const statusColor = machine.online ? colors.success : colors.textTertiary
  const osLabel = getMachineOsLabel(machine.os)

  if (compact && !actions.editing) {
    return (
      <View style={machineStyles.compactMachineIdentity}>
        <MachineAvatar machine={machine} />
        <View style={machineStyles.compactMachineCopy}>
          <Text style={[machineStyles.compactMachineName, { flex: 0, color: machine.online ? colors.text : colors.textSecondary }]} numberOfLines={1}>
            {machine.name}
          </Text>
          <View style={machineStyles.compactMachineMetadataRow}>
            {typeof agentCount === 'number' ? (
              <>
                <Text
                  style={[machineStyles.compactMachineMetadata, { color: secondaryText }]}
                  numberOfLines={1}
                >
                  {t('machine_agents_count_short', { count: agentCount })}
                </Text>
                <Text style={[machineStyles.compactMachineSeparator, { color: colors.textTertiary }]}>·</Text>
              </>
            ) : null}
            <VersionBadge
              machine={machine}
              colors={colors}
              inline
              canUpgrade={!compact && actions.isOwner && machine.online}
            />
          </View>
        </View>
        {primary ? (
          <Pressable
            accessibilityRole={onPrimaryPress ? 'button' : undefined}
            accessibilityLabel={t('personal_primary_manage')}
            onPress={event => { event.stopPropagation(); onPrimaryPress?.() }}
            disabled={!onPrimaryPress}
            style={{ minHeight: 48, justifyContent: 'center', flexShrink: 0 }}
          >
            <Text style={[mobileTypography.secondary, { color: colors.textSecondary, backgroundColor: colors.surfaceHover, borderRadius: 5, paddingHorizontal: 8, paddingVertical: 3 }]}>
              {t('personal_primary_settings')}
            </Text>
          </Pressable>
        ) : null}
        <Ionicons
          name="chevron-forward"
          size={20}
          color={colors.textTertiary}
        />
      </View>
    )
  }

  return (
    <View>
      <View style={machineStyles.machineHeader}>
        <View style={machineStyles.machineHeaderLeft}>
          <View style={[machineStyles.statusDot, { backgroundColor: statusColor }]} />
          {actions.editing ? (
            <TextInput
              ref={actions.inputRef}
              value={actions.nameInput}
              onChangeText={actions.setNameInput}
              placeholder={t('rename_machine_placeholder')}
              placeholderTextColor={colors.textTertiary}
              style={[
                machineStyles.nameInput,
                { borderColor: colors.brand, color: colors.text, backgroundColor: colors.bg },
              ]}
              editable={!actions.saving}
              onSubmitEditing={() => void actions.confirmRename()}
              returnKeyType="done"
              autoCorrect={false}
            />
          ) : (
            <>
              {actions.isOwner && !compact ? (
                <Pressable
                  onPress={actions.startEdit}
                  style={machineStyles.machineNamePressable}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t('rename_machine')}
                >
                  <Text style={[machineStyles.machineName, { color: colors.text }]} numberOfLines={1}>
                    {machine.name}
                  </Text>
                </Pressable>
              ) : (
                <Text style={[machineStyles.machineName, { color: colors.text }]} numberOfLines={1}>
                  {machine.name}
                </Text>
              )}
            </>
          )}

          <View style={[machineStyles.osBadge, { backgroundColor: colors.surfaceHover, borderColor: colors.border }]}>
            <Text style={[machineStyles.osBadgeText, { color: tertiaryText }]}>{osLabel}</Text>
          </View>

          {typeof agentCount === 'number' ? (
            <View style={[machineStyles.agentCountBadge, { backgroundColor: colors.surfaceHover, borderColor: colors.border }]}>
              <Text style={[machineStyles.agentCountBadgeText, { color: secondaryText }]} numberOfLines={1}>
                {t('machine_agents_count_short', { count: agentCount })}
              </Text>
            </View>
          ) : null}

          {!compact && machine.role === 'granted' && machine.permission ? (
            <View
              style={[
                machineStyles.permBadge,
                {
                  backgroundColor:
                    (permissionColors[machine.permission] ?? permissionColors.view).bg,
                },
              ]}
            >
              <Text
                style={[
                  machineStyles.permBadgeText,
                  {
                    color: (permissionColors[machine.permission] ?? permissionColors.view).text,
                  },
                ]}
              >
                {t(`perm_badge_${machine.permission}`)}
              </Text>
            </View>
          ) : null}

          {machine.role === 'granted' ? (
            <View style={[machineStyles.sharedSourceBadge, { backgroundColor: colors.surfaceHover, borderColor: colors.border }]}>
              <Text style={[machineStyles.sharedSourceText, { color: secondaryText }]} numberOfLines={1}>
                {compact ? t('machine_shared_compact_badge') : t('machine_shared_badge')}
              </Text>
            </View>
          ) : null}

        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {!actions.editing && !compact ? <VersionBadge machine={machine} colors={colors} /> : null}
          {actions.editing ? (
            actions.saving ? (
              <ActivityIndicator size="small" color={colors.brand} />
            ) : (
              <>
                <Pressable onPress={actions.cancelEdit} style={machineStyles.headerBtn}>
                  <Text style={[machineStyles.headerBtnText, { color: colors.textTertiary }]}>{t('cancel')}</Text>
                </Pressable>
                <Pressable onPress={() => void actions.confirmRename()} style={machineStyles.headerBtn}>
                  <Text style={[machineStyles.headerBtnText, { color: colors.brand }]}>{t('confirm')}</Text>
                </Pressable>
              </>
            )
          ) : compact ? null : (
            <Pressable
              onPress={() => {
                actions.setActionsOpen((value) => !value)
                actions.setConfirmingUnbind(false)
              }}
              style={[
                machineStyles.moreBtn,
                { backgroundColor: actions.actionsOpen ? colors.border : (colors.surfaceHover ?? colors.border + '40') },
              ]}
            >
              <Text style={[machineStyles.moreBtnText, { color: colors.textTertiary }]}>···</Text>
            </Pressable>
          )}
        </View>
      </View>

    </View>
  )
}
