import { normalizeModelInfos } from '../../utils/models'
import { normalizeDisplayText } from '../headEllipsis'
import { useEffect, useMemo, useState } from 'react'
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native'
import { useTranslation } from 'react-i18next'
import Ionicons from '@expo/vector-icons/Ionicons'
import BottomSheet from '../BottomSheet'
import { useTheme } from '../../hooks/useTheme'
import type { ModelInfo } from '@shennian/wire'

export type ModelSelectorSheetProps = {
  isOpen: boolean
  onClose: () => void
  agentLabel: string
  models: ModelInfo[]
  effectiveModelId?: string
  selectBusy: boolean
  onSelectModel: (modelId: string) => void
  followsAgentModel?: boolean
  followAgentDescription?: string
  onFollowAgentModel?: () => void
  onRefreshModels?: () => void | Promise<void>
  refreshBusy?: boolean
  preferDialogOnWeb?: boolean
  searchable?: boolean
  recentModelIds?: string[]
}

export function ModelSelectorSheet({
  isOpen,
  onClose,
  agentLabel,
  models: incomingModels,
  effectiveModelId,
  selectBusy,
  onSelectModel,
  followsAgentModel = false,
  followAgentDescription,
  onFollowAgentModel,
  onRefreshModels,
  refreshBusy = false,
  preferDialogOnWeb = false,
  searchable = false,
  recentModelIds = [],
}: ModelSelectorSheetProps) {
  const models = useMemo(() => normalizeModelInfos(incomingModels), [incomingModels])
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!isOpen) setQuery('')
  }, [isOpen])

  const defaultModel = models.find((model) => model.isDefault) ?? models[0]
  const recentModels = useMemo(() => {
    const recent = new Set(recentModelIds)
    return recentModelIds
      .map((id) => models.find((model) => model.id === id))
      .filter((model): model is ModelInfo =>
        Boolean(model && model.id !== defaultModel?.id && recent.has(model.id)),
      )
  }, [defaultModel?.id, models, recentModelIds])
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const searchedModels = normalizedQuery
    ? models.filter((model) =>
        `${model.name} ${model.description ?? ''}`.toLocaleLowerCase().includes(normalizedQuery),
      )
    : []
  const recentIds = new Set(recentModels.map((model) => model.id))
  const allModels = models.filter(
    (model) => model.id !== defaultModel?.id && !recentIds.has(model.id),
  )

  const renderModel = (model: ModelInfo) => {
    const selected = !followsAgentModel && effectiveModelId === model.id
    return (
      <Pressable
        key={model.id}
        style={[
          styles.item,
          {
            borderColor: selected ? colors.brand + '28' : colors.border,
            backgroundColor: selected ? colors.brand + '08' : colors.bg,
          },
        ]}
        onPress={() => void onSelectModel(model.id)}
        disabled={selectBusy}
      >
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={[styles.itemTitle, { color: selected ? colors.brand : colors.text }]}>
            {model.name}
          </Text>
          {model.description ? (
            <Text style={[styles.itemDesc, { color: colors.textSecondary }]}>
              {model.description}
            </Text>
          ) : null}
        </View>
      </Pressable>
    )
  }

  const headerRight = onRefreshModels ? (
    <Pressable
      onPress={() => {
        void onRefreshModels()
      }}
      disabled={selectBusy || refreshBusy}
      style={({ pressed }) => [styles.refreshBtn, { opacity: pressed ? 0.7 : 1 }]}
      accessibilityLabel={t('model_selector_refresh')}
    >
      {refreshBusy ? (
        <ActivityIndicator size="small" color={colors.brand} />
      ) : (
        <Ionicons name="refresh-outline" size={22} color={colors.text} />
      )}
    </Pressable>
  ) : null

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={() => {
        if (!selectBusy) onClose()
      }}
      title={t('model_selector_title')}
      headerRight={headerRight}
      preferDialogOnWeb={preferDialogOnWeb}
      avoidKeyboard={false}
    >
      {models.length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.agentLabel, { color: colors.textTertiary }]}>{normalizeDisplayText(agentLabel)}</Text>
          {searchable ? (
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('model_selector_search')}
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel={t('model_selector_search')}
              style={[
                styles.searchInput,
                { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            />
          ) : null}
          <View style={styles.list}>
            {onFollowAgentModel ? (
              <Pressable
                style={[
                  styles.item,
                  {
                    borderColor: followsAgentModel ? colors.brand + '28' : colors.border,
                    backgroundColor: followsAgentModel ? colors.brand + '08' : colors.bg,
                  },
                ]}
                onPress={onFollowAgentModel}
                disabled={selectBusy}
              >
                <View style={{ flex: 1, gap: 3 }}>
                  <Text
                    style={[
                      styles.itemTitle,
                      { color: followsAgentModel ? colors.brand : colors.text },
                    ]}
                  >
                    {t('model_follow_agent')}
                  </Text>
                  {followAgentDescription ? (
                    <Text style={[styles.itemDesc, { color: colors.textSecondary }]}>
                      {normalizeDisplayText(followAgentDescription)}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            ) : null}
            {normalizedQuery ? (
              searchedModels.length ? (
                searchedModels.map(renderModel)
              ) : (
                <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
                  {t('model_selector_no_results')}
                </Text>
              )
            ) : searchable ? (
              <>
                {defaultModel ? renderModel(defaultModel) : null}
                {recentModels.length ? (
                  <>
                    <Text style={[styles.groupLabel, { color: colors.textTertiary }]}>
                      {t('model_selector_recent')}
                    </Text>
                    {recentModels.map(renderModel)}
                  </>
                ) : null}
                {allModels.length ? (
                  <>
                    <Text style={[styles.groupLabel, { color: colors.textTertiary }]}>
                      {t('model_selector_all')}
                    </Text>
                    {allModels.map(renderModel)}
                  </>
                ) : null}
              </>
            ) : (
              models.map(renderModel)
            )}
          </View>
        </View>
      ) : (
        <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
          {t('model_list_empty')}
        </Text>
      )}
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  refreshBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    gap: 8,
    marginBottom: 16,
  },
  agentLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  list: {
    gap: 6,
  },
  searchInput: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  groupLabel: {
    marginTop: 8,
    marginBottom: 2,
    fontSize: 11,
    fontWeight: '600',
  },
  item: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  itemDesc: {
    fontSize: 12,
    lineHeight: 16,
  },
  emptyText: {
    fontSize: 13,
    lineHeight: 20,
    paddingVertical: 8,
  },
})
