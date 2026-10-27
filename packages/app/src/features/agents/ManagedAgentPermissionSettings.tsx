// @arch docs/features/managed-agent-restricted-runtime.md
// @test src/__tests__/agent-workspace-form.test.ts

import { useRef, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type {
  ManagedAgentExternalCapabilities,
  ManagedAgentFileAccess,
  ManagedAgentPermissionPolicy,
  ManagedAgentRuntimeProtection,
} from '@shennian/wire'
import {
  DEFAULT_NATIVE_FULL_MANAGED_AGENT_PERMISSION_POLICY,
  DEFAULT_RESTRICTED_MANAGED_AGENT_PERMISSION_POLICY,
  managedAgentExecutionMode,
} from '@shennian/wire'
import { ChoiceChip } from '../../components/ChoiceChip'
import { useTheme } from '../../hooks/useTheme'
import { mobileTypography } from '../../theme/mobileTypography'
import { confirmChoice } from './confirmChoice'

export const MANAGED_AGENT_EXTERNAL_CAPABILITIES = [
  'commandNetwork',
  'webSearch',
  'browser',
  'computerUse',
  'mcp',
] as const satisfies readonly (keyof ManagedAgentExternalCapabilities)[]

const FILE_ACCESS_OPTIONS = [
  'workspace-read',
  'workspace-write',
  'host-full',
] as const satisfies readonly ManagedAgentFileAccess[]

export function managedAgentFileAccessKey(fileAccess: ManagedAgentFileAccess): string {
  switch (fileAccess) {
    case 'workspace-read':
      return 'agents_file_access_workspace_read'
    case 'workspace-write':
      return 'agents_file_access_workspace_write'
    case 'host-full':
      return 'agents_file_access_host_full'
  }
}

export function managedAgentCapabilityKey(
  capability: keyof ManagedAgentExternalCapabilities,
): string {
  switch (capability) {
    case 'commandNetwork':
      return 'agents_external_command_network'
    case 'webSearch':
      return 'agents_external_web_search'
    case 'browser':
      return 'agents_external_browser'
    case 'computerUse':
      return 'agents_external_computer_use'
    case 'mcp':
      return 'agents_external_mcp'
  }
}

export function ManagedAgentPermissionSettings({
  value,
  runtimeProtection: _runtimeProtection,
  restrictedModeAvailable = true,
  disabled = false,
  desktop = false,
  onChange,
}: {
  value: ManagedAgentPermissionPolicy
  runtimeProtection?: ManagedAgentRuntimeProtection
  restrictedModeAvailable?: boolean
  disabled?: boolean
  desktop?: boolean
  onChange: (value: ManagedAgentPermissionPolicy) => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [helpExpanded, setHelpExpanded] = useState(false)
  const [restrictedUnavailableVisible, setRestrictedUnavailableVisible] = useState(false)
  const [fileHelpExpanded, setFileHelpExpanded] = useState(false)
  const [toolHelpExpanded, setToolHelpExpanded] = useState(false)
  const mode = managedAgentExecutionMode(value)
  const restrictedValue = useRef<ManagedAgentPermissionPolicy>(
    mode === 'restricted'
      ? value
      : {
          ...DEFAULT_RESTRICTED_MANAGED_AGENT_PERMISSION_POLICY,
          version: value.version,
          externalCapabilities: {
            ...DEFAULT_RESTRICTED_MANAGED_AGENT_PERMISSION_POLICY.externalCapabilities,
          },
        },
  )

  if (mode === 'restricted') restrictedValue.current = value

  const chooseMode = (nextMode: 'native-full' | 'restricted') => {
    if (nextMode === 'restricted' && !restrictedModeAvailable) {
      setRestrictedUnavailableVisible(true)
      return
    }
    setRestrictedUnavailableVisible(false)
    if (nextMode === mode) return
    if (nextMode === 'restricted') {
      confirmRestricted(() => applyMode('restricted'))
      return
    }
    applyMode(nextMode)
  }

  // Restricted access can remove the Room send channel, so every AI asks first.
  const confirmRestricted = (proceed: () => void) => {
    confirmChoice(
      {
        title: t('agents_run_access_restricted_confirm_title'),
        message: t('agents_run_access_restricted_confirm_message'),
        confirmLabel: t('agents_run_access_restricted_confirm_action'),
        cancelLabel: t('cancel'),
      },
      proceed,
    )
  }

  const applyMode = (nextMode: 'native-full' | 'restricted') => {
    if (nextMode === 'native-full') {
      onChange({
        ...DEFAULT_NATIVE_FULL_MANAGED_AGENT_PERMISSION_POLICY,
        version: value.version,
        externalCapabilities: {
          ...DEFAULT_NATIVE_FULL_MANAGED_AGENT_PERMISSION_POLICY.externalCapabilities,
        },
      })
      return
    }
    onChange({
      ...restrictedValue.current,
      version: value.version,
      executionMode: 'restricted',
      externalCapabilities: { ...restrictedValue.current.externalCapabilities },
    })
  }

  const chooseFileAccess = (fileAccess: ManagedAgentFileAccess) => {
    onChange({ ...value, executionMode: 'restricted', fileAccess })
  }

  const toggleCapability = (capability: keyof ManagedAgentExternalCapabilities) => {
    onChange({
      ...value,
      externalCapabilities: {
        ...value.externalCapabilities,
        [capability]: !value.externalCapabilities[capability],
      },
    })
  }

  return (
    <View style={styles.section}>
      <Pressable
        style={styles.headingButton}
        hitSlop={8}
        onPress={() => setHelpExpanded((expanded) => !expanded)}
        accessibilityRole="button"
        accessibilityLabel={t(
          helpExpanded ? 'agents_run_access_help_hide' : 'agents_run_access_help_show',
        )}
        accessibilityState={{ expanded: helpExpanded }}
      >
        <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('agents_run_access')}</Text>
      </Pressable>
      {helpExpanded ? (
        <View style={styles.helpCopy}>
          <Text style={[styles.helpText, { color: colors.textSecondary }]}>
            {t('agents_run_access_restricted_description')}
          </Text>
        </View>
      ) : null}
      <View accessibilityRole="radiogroup" style={styles.modeOptions}>
        {(['native-full', 'restricted'] as const).map((executionMode) => {
          const selected = mode === executionMode
          const restrictedUnavailable = executionMode === 'restricted' && !restrictedModeAvailable
          return (
            <ChoiceChip desktop={desktop}
              key={executionMode}
              testID={`agent-execution-mode-${executionMode}`}
              label={t(
                executionMode === 'native-full'
                  ? 'agents_run_access_full'
                  : 'agents_run_access_restricted',
              )}
              selected={selected}
              disabled={disabled}
              unavailable={restrictedUnavailable}
              accessibilityHint={
                restrictedUnavailable
                  ? t('agents_run_access_restricted_unavailable_description')
                  : undefined
              }
              onPress={() => chooseMode(executionMode)}
            />
          )
        })}
      </View>
      {mode === 'restricted' ? (
        <Text
          testID="agent-restricted-mode-warning"
          style={[styles.unavailableText, { color: colors.textSecondary }]}
        >
          {t('agents_run_access_restricted_warning')}
        </Text>
      ) : null}
      {restrictedUnavailableVisible ? (
        <Text
          testID="agent-restricted-mode-unavailable"
          accessibilityRole="alert"
          style={[styles.unavailableText, { color: colors.textSecondary }]}
        >
          {t('agents_run_access_restricted_unavailable_description')}
        </Text>
      ) : null}

      {mode === 'restricted' ? (
        <View style={styles.restrictedDetails}>
          <View>
            <Pressable
              hitSlop={8}
              onPress={() => setFileHelpExpanded((expanded) => !expanded)}
              accessibilityRole="button"
              accessibilityState={{ expanded: fileHelpExpanded }}
              style={styles.headingButton}
            >
              <Text style={[styles.title, { color: colors.text }]}>{t('agents_file_access')}</Text>
            </Pressable>
            {fileHelpExpanded ? (
              <Text style={[styles.helpText, { color: colors.textSecondary }]}>
                {t('agents_file_access_help')}
              </Text>
            ) : null}
            <View accessibilityRole="radiogroup" style={styles.fileOptions}>
              {FILE_ACCESS_OPTIONS.map((fileAccess) => {
                const selected = value.fileAccess === fileAccess
                return (
                  <Pressable
                    key={fileAccess}
                    testID={`agent-file-access-${fileAccess}`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected, disabled }}
                    {...(desktop ? { 'aria-checked': selected, 'aria-disabled': disabled } : {})}
                    disabled={disabled}
                    hitSlop={6}
                    onPress={() => chooseFileAccess(fileAccess)}
                    style={[
                      styles.fileOption,
                      {
                        borderColor: desktop ? colors.border : selected ? colors.brand : colors.border,
                        backgroundColor: selected ? desktop ? colors.selectionBackground : `${colors.brand}0A` : colors.bg,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.fileOptionText,
                        {
                          color: desktop ? colors.text : selected ? colors.brand : colors.text,
                          fontWeight: desktop ? '400' : Platform.OS === 'web' ? (selected ? '600' : '500') : '400',
                        },
                      ]}
                    >
                      {t(managedAgentFileAccessKey(fileAccess))}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          </View>

          <Pressable
            hitSlop={8}
            onPress={() => setToolHelpExpanded((expanded) => !expanded)}
            accessibilityRole="button"
            accessibilityState={{ expanded: toolHelpExpanded }}
            style={styles.headingButton}
          >
            <Text style={[styles.title, { color: colors.text }]}>
              {t('agents_external_capabilities')}
            </Text>
          </Pressable>
          {toolHelpExpanded ? (
            <Text style={[styles.helpText, { color: colors.textSecondary }]}>
              {t('agents_external_capabilities_help')}
            </Text>
          ) : null}
          <View style={styles.capabilities} accessibilityRole="list">
            {MANAGED_AGENT_EXTERNAL_CAPABILITIES.map((capability) => {
              const selected = value.externalCapabilities[capability]
              const capabilityDisabled = disabled
              return (
                <Pressable
                  key={capability}
                  testID={`agent-external-${capability}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected, disabled: capabilityDisabled }}
                  {...(desktop ? { 'aria-checked': selected, 'aria-disabled': capabilityDisabled } : {})}
                  disabled={capabilityDisabled}
                  hitSlop={6}
                  onPress={() => toggleCapability(capability)}
                  style={[
                    styles.capability,
                    {
                      borderColor: desktop ? colors.border : selected ? colors.brand : colors.border,
                      backgroundColor: selected ? desktop ? colors.selectionBackground : `${colors.brand}0A` : colors.bg,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.capabilityText,
                      {
                        color: desktop ? colors.text : selected ? colors.brand : colors.text,
                        fontWeight: desktop ? '400' : Platform.OS === 'web' ? (selected ? '600' : '500') : '400',
                      },
                    ]}
                  >
                    {t(managedAgentCapabilityKey(capability))}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  sectionTitle: { fontSize: 13, lineHeight: 18, fontWeight: '600', ...(Platform.OS !== 'web' && mobileTypography.sectionTitle) },
  helpCopy: { gap: 2 },
  modeOptions: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, rowGap: 0 },
  unavailableText: { fontSize: 13, lineHeight: 19, ...(Platform.OS !== 'web' && mobileTypography.metadata) },
  restrictedDetails: { gap: 10 },
  title: { fontSize: 13, lineHeight: 18, fontWeight: '600', ...(Platform.OS !== 'web' && mobileTypography.sectionTitle) },
  headingButton: { minHeight: 28, alignSelf: 'flex-start', justifyContent: 'center' },
  helpText: { fontSize: 13, lineHeight: 19, marginBottom: 2, ...(Platform.OS !== 'web' && mobileTypography.metadata) },
  fileOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fileOption: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileOptionText: { fontSize: 13, lineHeight: 19, fontWeight: '500', ...(Platform.OS !== 'web' && mobileTypography.secondary) },
  capabilities: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  capability: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  capabilityText: { fontSize: 13, lineHeight: 19, fontWeight: '500', ...(Platform.OS !== 'web' && mobileTypography.secondary) },
})
