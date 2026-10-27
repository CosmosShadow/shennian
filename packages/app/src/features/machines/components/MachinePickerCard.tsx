// @arch docs/architecture/app/modular-features.md#机器-feature
// @test src/__tests__/machine-feature-utils.test.ts

import { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import type { Machine } from '@shennian/wire'
import { useProjectsStore } from '@shennian/shared'
import { DirBrowser } from '../../../components/DirBrowser'
import { accountRuntime } from '../../account-runtime/accountRuntime'
import { useTheme } from '../../../hooks/useTheme'
import { getLastLaunch } from '../../../utils/launchStorage'
import { useMachineCardActions } from '../hooks/useMachineCardActions'
import { resolveProjectDirectory } from '../utils/projectDirectory'
import { getDirLabel } from '../utils/launch'
import { machineStyles } from '../styles'
import { VersionBadge } from './VersionBadge'
import { machineAccountClient } from '../machineAccountClient'

export function MachinePickerCard({ machine, onClose }: { machine: Machine; onClose: () => void }) {
  const { t } = useTranslation()
  const { fontScale } = useWindowDimensions()
  const { colors } = useTheme()
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [workDir, setWorkDir] = useState(() => getLastLaunch(machine.id)?.workDir || '~')
  const [browseOpen, setBrowseOpen] = useState(false)
  const upsertProject = useProjectsStore((state) => state.upsertProject)
  const actions = useMachineCardActions(machine, t)
  const handleCreateProject = useCallback(async () => {
    const finalDir = workDir.trim()
    if (!finalDir || creating) return
    setCreating(true)
    setCreateError('')
    try {
      const resolvedDir = await resolveProjectDirectory(machine.id, finalDir, accountRuntime)
      const project = await machineAccountClient.createProject(machine.id, resolvedDir)
      upsertProject(project)
      await accountRuntime.persistProject(project)
      onClose()
      router.navigate({
        pathname: '/(main)/project',
        params: { machineId: project.machineId, workDir: project.workDir },
      })
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }, [creating, machine.id, onClose, router, upsertProject, workDir])

  return (
    <View
      style={[
        machineStyles.card,
        {
          borderColor: colors.border,
          borderWidth: 0,
          borderBottomWidth: 1,
          borderRadius: 0,
          shadowOpacity: 0,
          elevation: 0,
          paddingHorizontal: 0,
          backgroundColor: colors.bg,
        },
      ]}
    >
      <View style={[machineStyles.cardHeader, fontScale > 1.4 && { flexWrap: 'wrap' }]}>
        <View style={machineStyles.cardIdentity}>
          <View
            accessible
            accessibilityLabel={t('online')}
            style={[machineStyles.statusDot, { backgroundColor: colors.success }]}
          />
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
                  accessibilityLabel={`${machine.name}, ${t('rename_machine')}`}
                >
                  <Text style={[machineStyles.cardName, { color: colors.text }]} numberOfLines={1}>
                    {machine.name}
                  </Text>
                </Pressable>
              ) : (
                <Text style={[machineStyles.cardName, { color: colors.text }]} numberOfLines={1}>
                  {machine.name}
                </Text>
              )}
            </>
          )}
          <Text
            style={[
              machineStyles.cardMeta,
              { color: Platform.OS === 'web' ? colors.textTertiary : colors.textMuted },
            ]}
          >
            {machine.os}
          </Text>
        </View>
        <VersionBadge machine={machine} colors={colors} />
      </View>

      <View style={machineStyles.cardSection}>
        <View style={[machineStyles.pickerLaunchRow, fontScale > 1.4 && { flexWrap: 'wrap' }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={workDir}
            onLongPress={() => Alert.alert(machine.name, workDir)}
            onPress={() => setBrowseOpen(true)}
            style={[
              machineStyles.dirBtn,
              machineStyles.dirBtnMobile,
              { borderColor: colors.border, backgroundColor: colors.bg, minHeight: 48 },
            ]}
            disabled={creating}
          >
            <Ionicons name="folder-outline" size={14} color={colors.textSecondary} />
            <View style={machineStyles.controlTextBlock}>
              <Text
                style={[machineStyles.controlValue, { color: colors.textSecondary }]}
                numberOfLines={1}
              >
                {getDirLabel(workDir, t('home_dir'))}
              </Text>
            </View>
          </Pressable>

          <Pressable
            style={[
              machineStyles.launchBtn,
              { flex: 0, minHeight: 48, paddingHorizontal: 12, flexShrink: 0 },
              { backgroundColor: colors.brandLight },
              creating && { opacity: 0.6 },
            ]}
            onPress={() => void handleCreateProject()}
            onLongPress={() => Alert.alert(t('start_new_project'), t('start_new_project_hint'))}
            disabled={creating}
            accessibilityRole="button"
            accessibilityLabel={t('start_new_project')}
            accessibilityHint={t('start_new_project_hint')}
          >
            {creating ? (
              <ActivityIndicator size="small" color={colors.brand} />
            ) : (
              <>
                <Text style={[machineStyles.launchBtnText, { color: colors.brand }]}>
                  {t('start_new_project')}
                </Text>
              </>
            )}
          </Pressable>
        </View>
      </View>

      {createError ? (
        <Text style={[machineStyles.errorText, { color: colors.error, marginTop: 6 }]}>
          {createError}
        </Text>
      ) : null}
      {actions.renameError ? (
        <Text style={[machineStyles.errorText, { color: colors.error, marginTop: 6 }]}>
          {actions.renameError}
        </Text>
      ) : null}

      {browseOpen ? (
        <DirBrowser
          machineId={machine.id}
          initialPath={workDir}
          mode="workDirPicker"
          onSelect={(path) => {
            setWorkDir(path)
            setBrowseOpen(false)
          }}
          onClose={() => setBrowseOpen(false)}
        />
      ) : null}
    </View>
  )
}
