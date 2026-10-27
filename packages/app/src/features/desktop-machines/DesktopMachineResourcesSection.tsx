// @arch docs/design/desktop/unified-desktop-control.md
// @test ../../__tests__/desktop-machine-detail.test.ts

import { useState, type ComponentProps, type RefObject } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import type { Machine, NianProject } from '@shennian/wire'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { getAgentLaunchLabel } from '../machines/utils/launch'
import { groupInstalledAgents } from '../machines/utils/acp-agent-presentation'
import { desktopMachineDetailStyles } from './DesktopMachineDetailLayout'
import { desktopControlMetrics, desktopTypography } from '../desktop-shell/desktopDesignTokens'
import {
  resolveDesktopMachineResourceStatus,
  type DesktopMachineResourceStatus,
} from './desktopMachinePresentation'

export function DesktopMachineResourcesSection({
  machine,
  projects,
  owner,
  relayConnected,
  machineOnline,
  onOpenTools,
  onOpenProject,
  onOpenSharing,
  sharingButtonRef,
}: {
  machine: Machine
  projects: NianProject[]
  owner: boolean
  relayConnected: boolean
  machineOnline: boolean
  onOpenTools(): void
  onOpenProject(project: NianProject): void
  onOpenSharing(): void
  sharingButtonRef?: RefObject<View | null>
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const tools = groupInstalledAgents(machine).all
  return (
    <View style={styles.stack}>
      <View
        style={[desktopMachineDetailStyles.section, styles.section, { borderColor: colors.border }]}
      >
        <SectionHeading
          icon="terminal-outline"
          title={t('desktop_machine_tools')}
          count={tools.length}
          actionLabel={t('desktop_machine_view_all')}
          onAction={onOpenTools}
        />
        <View style={[styles.resourceList, { borderColor: colors.border }]}>
          {tools.length ? (
            tools.map((tool, index) => {
              const kind = resolveDesktopMachineResourceStatus({
                relayConnected,
                machineOnline,
                info: tool.info,
              })
              return (
                <ResourceRow
                  key={tool.type}
                  icon="code-slash-outline"
                  title={tool.info?.display?.name || getAgentLaunchLabel(tool.type)}
                  detail={tool.info?.runtime?.cliVersion || tool.info?.display?.version || '—'}
                  status={kind}
                  last={index === tools.length - 1}
                />
              )
            })
          ) : (
            <EmptyRow label={t('desktop_machine_no_tools')} />
          )}
        </View>
      </View>
      <View
        style={[desktopMachineDetailStyles.section, styles.section, { borderColor: colors.border }]}
      >
        <SectionHeading
          icon="folder-outline"
          title={t('desktop_machine_projects')}
          count={projects.length}
        />
        <View style={[styles.resourceList, { borderColor: colors.border }]}>
          {projects.length ? (
            projects.map((project, index) => (
              <ResourceRow
                key={project.id}
                icon="folder-outline"
                title={project.displayName || project.workDir}
                detail={project.workDir}
                status={relayConnected ? machineOnline ? 'available' : 'unavailable' : 'unknown'}
                last={index === projects.length - 1}
                onPress={() => onOpenProject(project)}
              />
            ))
          ) : (
            <EmptyRow label={t('desktop_machine_no_projects')} />
          )}
        </View>
      </View>
      {owner ? (
        <View
          style={[
            desktopMachineDetailStyles.section,
            styles.section,
            { borderColor: colors.border },
          ]}
        >
          <View style={[styles.resourceList, { borderColor: colors.border }]}>
            <ResourceRow
              icon="people-outline"
              actionRef={sharingButtonRef}
              title={t('machine_share_page_title')}
              detail={machine.sharedCount ? t('machine_shared_to_short', { count: machine.sharedCount }) : t('machine_share_summary_private')}
              last
              onPress={onOpenSharing}
            />
          </View>
        </View>
      ) : null}
    </View>
  )
}

function SectionHeading({
  icon,
  title,
  count,
  actionLabel,
  onAction,
}: {
  icon: ComponentProps<typeof Ionicons>['name']
  title: string
  count?: number
  actionLabel?: string
  onAction?: () => void
}) {
  const { colors } = useTheme()
  const [focused, setFocused] = useState(false)
  return (
    <View style={styles.heading}>
      <Ionicons name={icon} size={17} color={colors.textSecondary} />
      <Text style={[styles.headingText, { color: colors.text }]}>
        {title}
        {typeof count === 'number' ? ` · ${count}` : ''}
      </Text>
      {onAction && actionLabel ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${actionLabel} ${title}`}
          onPress={onAction}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={({ pressed }) => [
            styles.headingAction,
            { borderColor: focused ? colors.brand : 'transparent', opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Text style={[styles.headingActionText, { color: colors.brand }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

function ResourceRow({
  actionRef,
  icon,
  title,
  detail,
  status,
  last,
  onPress,
}: {
  actionRef?: RefObject<View | null>
  icon: ComponentProps<typeof Ionicons>['name']
  title: string
  detail: string
  status?: DesktopMachineResourceStatus
  last: boolean
  onPress?(): void
}) {
  const { colors } = useTheme()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      ref={actionRef}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${detail}`}
      {...{ title: `${title}\n${detail}` }}
      onPress={onPress}
      disabled={!onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.resource,
        last && styles.resourceLast,
        {
          borderColor: focused ? colors.brand : colors.border,
          backgroundColor: focused
            ? colors.brandLight
            : hovered || pressed
              ? colors.surfaceHover
              : colors.bg,
          opacity: pressed ? 0.72 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={16} color={colors.textSecondary} />
      <View style={styles.resourceCopy}>
        <Text numberOfLines={1} style={[styles.resourceTitle, { color: colors.text }]}>
          {title}
        </Text>
        <Text numberOfLines={1} style={[styles.resourceDetail, { color: colors.textSecondary }]}>
          {detail}
        </Text>
      </View>
      {status ? <ResourceStatus status={status} /> : null}
      {onPress ? <Ionicons name="chevron-forward" size={15} color={colors.textTertiary} /> : null}
    </Pressable>
  )
}

function ResourceStatus({ status }: { status: DesktopMachineResourceStatus }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const tone =
    status === 'available'
      ? colors.success
      : status === 'auth-required' || status === 'version-mismatch' || status === 'auth-error'
        ? colors.warning
        : colors.textTertiary
  const label = t(
    status === 'available'
      ? 'machine_agent_available'
      : status === 'installed'
        ? 'machine_agent_installed'
        : status === 'auth-error'
          ? 'ai_setup_state_configuration'
          : status === 'auth-required'
            ? 'machine_agent_auth_required'
            : status === 'version-mismatch'
              ? 'machine_agent_version_mismatch_badge'
              : status === 'unavailable'
                ? 'machine_offline'
                : 'unknown',
  )
  return (
    <View style={styles.resourceStatus}>
      <View style={[styles.resourceStatusDot, { backgroundColor: tone }]} />
      <Text style={[styles.resourceStatusText, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  )
}

function EmptyRow({ label }: { label: string }) {
  const { colors } = useTheme()
  return (
    <View style={styles.empty}>
      <Text style={[styles.resourceDetail, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  stack: { width: '100%', gap: 16 },
  section: { width: '100%', paddingVertical: 8, paddingHorizontal: 0 },
  heading: {
    minHeight: desktopControlMetrics.standardControlHeight,
    paddingHorizontal: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headingText: { flex: 1, ...desktopTypography.sectionTitle },
  headingAction: {
    minHeight: desktopControlMetrics.compactControlHeight,
    minWidth: desktopControlMetrics.compactControlHeight,
    borderWidth: 1,
    borderRadius: 7,
    paddingHorizontal: 6,
    justifyContent: 'center',
  },
  headingActionText: { ...desktopTypography.control },
  resourceList: { width: '100%' },
  resource: {
    minHeight: 52,
    borderWidth: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: 0,
    paddingHorizontal: 8,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  resourceLast: { borderBottomWidth: 0 },
  resourceCopy: { minWidth: 0, flex: 1 },
  resourceTitle: { ...desktopTypography.control },
  resourceDetail: { ...desktopTypography.metadata },
  resourceStatus: {
    flexShrink: 1,
    maxWidth: '35%',
    minHeight: desktopControlMetrics.compactControlHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 7,
  },
  resourceStatusDot: { width: 7, height: 7, borderRadius: 4 },
  resourceStatusText: { ...desktopTypography.metadata, flexShrink: 1 },
  empty: { minHeight: 52, paddingHorizontal: 8, justifyContent: 'center' },
})
