import { ActionIconButton } from '../../../components/ActionIconButton'
// @arch docs/features/network-rooms/ui.md#入群审批提醒
// @test src/__tests__/room-approval-counts.test.ts

import { type StyleProp, type ViewStyle } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../hooks/useTheme'
import { RoomApprovalDot } from './RoomApprovalDot'

export function RoomDetailsButton({
  roomId,
  canApprove,
  active,
  style,
  onBeforeOpen,
  onOpenInline,
  inline,
}: {
  roomId: string
  canApprove: boolean
  active: boolean
  style: StyleProp<ViewStyle>
  onBeforeOpen: () => void
  onOpenInline: () => void
  inline: boolean
}) {
  const router = useRouter()
  const { t } = useTranslation()
  const { colors } = useTheme()
  return (
    <ActionIconButton icon="more" color={active ? colors.brand : colors.text}
      testID="room-details-toggle"
      style={style}
      onPress={() => {
        onBeforeOpen()
        if (inline) onOpenInline()
        else router.navigate({ pathname: '/(main)/spaces/details', params: { roomId } })
      }}
      label={t('spaces_details_accessibility')}
    >

      <RoomApprovalDot roomId={roomId} canApprove={canApprove} overlay />
    </ActionIconButton>
  )
}
