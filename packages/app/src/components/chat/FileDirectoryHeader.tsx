// @arch docs/architecture/remote-folders.md
// @test packages/app/src/__tests__/file-drawer-actions.test.ts
import { Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { AppPageHeader, HeaderIconButton } from '../AppPageHeader'
import { useTheme } from '../../hooks/useTheme'
import { canGoUpWithinRoot, getParentDirectoryPathWithinRoot } from '../../utils/directoryNavigation'
import { mobileTypography } from '../../theme/mobileTypography'

export function FileDirectoryHeader({
  title,
  path,
  onBack,
  onMore,
  rootPath = path,
  onNavigate,
}: {
  rootPath?: string
  onNavigate?: (path: string) => void
  title: string
  path: string
  onBack(): void
  onMore(): void
}) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const crumbs = [{ path, name: title }]
  let ancestor = path
  while (crumbs.length < 3 && canGoUpWithinRoot(ancestor, rootPath)) {
    ancestor = getParentDirectoryPathWithinRoot(ancestor, rootPath)
    crumbs.unshift({ path: ancestor, name: ancestor.split(/[\\/]/).filter(Boolean).pop() || ancestor })
  }
  return (
    <>
      <AppPageHeader
        title={title}
        onBack={onBack}
        trailing={
          <HeaderIconButton
            icon="ellipsis-horizontal"
            label={t('more')}
            onPress={onMore}
            testID="file-browser-more"
          />
        }
      />
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 18,
          paddingVertical: 10,
          borderBottomWidth: 0.5,
          borderBottomColor: colors.border,
        }}
      >
        {onNavigate ? crumbs.map((crumb, index) => <View key={crumb.path} style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
          {index > 0 ? <Text style={{ color: colors.textSecondary }}> › </Text> : null}
          <Pressable disabled={crumb.path === path} accessibilityRole="button"
            accessibilityLabel={crumb.path} onPress={() => onNavigate(crumb.path)}
            style={{ flexShrink: 1, minHeight: 44, justifyContent: 'center' }}>
            <Text numberOfLines={1} style={{ ...mobileTypography.metadata, color: crumb.path === path ? colors.textSecondary : colors.brand }}>{crumb.name}</Text>
          </Pressable>
        </View>) : <Text selectable numberOfLines={1} ellipsizeMode="middle"
          style={{ ...mobileTypography.metadata, color: colors.textSecondary }}>{path}</Text>}
      </View>
    </>
  )
}
