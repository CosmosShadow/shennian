// @arch docs/architecture/app/modular-features.md#聊天-feature
// @test src/__tests__/chat-header-actions.test.ts

import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { Colors } from '../../../hooks/useTheme'
import { HeaderBackButton, HeaderIconButton } from '../../../components/AppPageHeader'
import { getChatHeaderActionIds } from '../utils/headerActions'

type Props = {
  goBack: () => void
  title: string
  hasTitle: boolean
  colors: Colors
  onOpenTop: () => void
  onOpenDetails: () => void
  onLongPressCenter?: () => void
  sessionId?: string
}

export function ChatHeader({
  goBack,
  title,
  hasTitle,
  colors,
  onOpenTop,
  onOpenDetails,
  onLongPressCenter,
  sessionId,
}: Props) {
  const { t } = useTranslation()
  const trailingActionIds = getChatHeaderActionIds(sessionId)

  return (
    <View
      style={[
        styles.header,
        { borderBottomColor: colors.separator ?? colors.border },
      ]}
    >
      <HeaderBackButton testID="chat-back-btn" onPress={goBack} />
      <Pressable
        testID="chat-header-center"
        style={styles.headerCenter}
        onPress={onOpenTop}
        onLongPress={onLongPressCenter}
      >
        <Text
          style={[styles.headerTitle, { color: hasTitle ? colors.text : colors.textSecondary }]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {title}
        </Text>
      </Pressable>
      <View style={[styles.trailingActions, styles.mobileTrailingActions]}>
        {trailingActionIds.map((actionId) => {
          return (
            <HeaderIconButton
              key={actionId}
              icon="ellipsis-horizontal"
              label={t('session_details_accessibility')}
              testID="chat-header-details-btn"
              onPress={onOpenDetails}
            />
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerCenter: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    gap: 1,
  },
  headerTitle: {
    textAlign: 'left',
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    flexShrink: 1,
    minWidth: 0,
  },
  trailingActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  mobileTrailingActions: {
    width: 48,
  },
})
