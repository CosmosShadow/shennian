// @arch docs/architecture/launch-config.md
// @test packages/app/src/__tests__/launch-model-selector.test.ts

import { useEffect, useMemo, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import type { AgentType, ModelInfo } from '@shennian/wire'
import { ChoiceChip } from '../../../components/ChoiceChip'
import { ModelSelectorSheet } from '../../../components/chat/ModelSelectorSheet'
import { useTheme } from '../../../hooks/useTheme'
import { getAgentLaunchLabel } from '../utils/launch'
import { machineStyles } from '../styles'
import { getRecentLaunchModels, recordRecentLaunchModel } from '../../../utils/launchStorage'
import {
  hasDefaultModel,
  isModelSelected,
  modelSelectionValue,
  shouldUseCollapsedModelSelector,
} from '../../../utils/models'

const IMPLICIT_DEFAULT_MODEL_ID = '__shennian_implicit_default__'

type BaseProps = {
  agentType: AgentType
  models: ModelInfo[]
  selectedModel?: string | null
  disabled?: boolean
}

type Props = BaseProps &
  (
    | {
        allowDefaultSelection: true
        defaultOptionLabel: string
        onSelectModel: (modelId: string | null) => void
      }
    | {
        allowDefaultSelection?: false
        defaultOptionLabel?: never
        onSelectModel: (modelId: string) => void
      }
  )

export function LaunchModelSelector({
  agentType,
  models,
  selectedModel,
  disabled = false,
  allowDefaultSelection = false,
  defaultOptionLabel,
  onSelectModel,
}: Props) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [open, setOpen] = useState(false)
  const [, setRecentRevision] = useState(0)
  const selectableModels = useMemo(
    () =>
      allowDefaultSelection && models.length !== 1 && !hasDefaultModel(models)
        ? [
            {
              id: IMPLICIT_DEFAULT_MODEL_ID,
              name: defaultOptionLabel ?? t('agents_default_model'),
              isDefault: true,
            },
            ...models,
          ]
        : models,
    [allowDefaultSelection, defaultOptionLabel, models, t],
  )
  const recentModelIds = getRecentLaunchModels(
    agentType,
    selectableModels.map((model) => model.id),
  )
  const selectedModelInfo = useMemo(
    () =>
      selectableModels.find((model) =>
        allowDefaultSelection ? isModelSelected(model, selectedModel) : model.id === selectedModel,
      ) ?? selectableModels[0],
    [allowDefaultSelection, selectableModels, selectedModel],
  )
  const defaultModelId =
    selectableModels.find((model) => model.isDefault)?.id ?? selectableModels[0]?.id

  useEffect(() => {
    if (selectableModels.length !== 1) return
    const onlyModel = selectableModels[0]!
    const selected = allowDefaultSelection
      ? isModelSelected(onlyModel, selectedModel)
      : selectedModel === onlyModel.id
    if (selected) return
    const value = allowDefaultSelection ? modelSelectionValue(onlyModel) : onlyModel.id
    ;(onSelectModel as (modelId: string | null) => void)(value)
  }, [allowDefaultSelection, onSelectModel, selectableModels, selectedModel])

  const selectModel = (model: ModelInfo) => {
    recordRecentLaunchModel(agentType, model.id, defaultModelId)
    const value = allowDefaultSelection ? modelSelectionValue(model) : model.id
    ;(onSelectModel as (modelId: string | null) => void)(value)
  }

  if (!shouldUseCollapsedModelSelector(selectableModels.length)) {
    return (
      <View accessibilityRole="radiogroup" style={machineStyles.modelGrid}>
        {selectableModels.map((model) => {
          const selected = allowDefaultSelection
            ? isModelSelected(model, selectedModel)
            : selectedModel === model.id
          return (
            <ChoiceChip
              key={model.id}
              label={model.name}
              selected={selected}
              disabled={disabled}
              onPress={() => selectModel(model)}
            />
          )
        })}
      </View>
    )
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('model_selector_title')}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[
          machineStyles.launchModelSelectRow,
          { backgroundColor: colors.bg, borderColor: colors.border },
        ]}
      >
        <Text
          style={[machineStyles.launchModelSelectText, { color: colors.text }]}
          numberOfLines={1}
        >
          {selectedModelInfo?.name ?? t('model')}
        </Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
      </Pressable>
      <ModelSelectorSheet
        isOpen={open}
        onClose={() => setOpen(false)}
        agentLabel={getAgentLaunchLabel(agentType)}
        models={selectableModels}
        effectiveModelId={selectedModelInfo?.id}
        selectBusy={disabled}
        searchable
        recentModelIds={recentModelIds}
        onSelectModel={(modelId) => {
          const model = selectableModels.find((item) => item.id === modelId)
          if (!model) return
          selectModel(model)
          setRecentRevision((revision) => revision + 1)
          setOpen(false)
        }}
      />
    </>
  )
}
