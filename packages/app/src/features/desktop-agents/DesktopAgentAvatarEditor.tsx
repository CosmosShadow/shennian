// @arch docs/features/agent-workspaces.md
// @arch docs/design/desktop/unified-desktop-control.md
// @test ../../__tests__/desktop-agent-avatar-controller.test.ts
import { useEffect, useMemo, useRef, useState } from 'react'
import { Image, Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { AgentWorkspace } from '@shennian/wire'
import { useAuthStore } from '../../config/auth'
import { useTheme } from '../../hooks/useTheme'
import { avatarBorderRadius } from '../../components/avatarShape'
import { RoomIdentityAvatar } from '../rooms/components/RoomIdentityAvatar'
import { DesktopMachineAction } from '../desktop-machines/DesktopMachineAction'
import { pickDesktopProfileAvatar } from '../desktop-settings/desktopProfileAvatar'
import { createDesktopAgentAvatarController } from './desktopAgentAvatarController'

export function DesktopAgentAvatarEditor(props: {
  accountId: string; agent?: AgentWorkspace; name: string; draft?: Blob | null; restoreOwnerDraft?: boolean; disabled: boolean
  onDraft(image: Blob): void; onRestoreOwnerDraft(): void; onBusy(busy: boolean): void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const user = useAuthStore(state => state.user)
  const latest = useRef(props)
  const active = useRef(false)
  latest.current = props
  const [busy, setBusy] = useState(false)
  const [focused, setFocused] = useState(false)
  const [error, setError] = useState(false)
  const [preview, setPreview] = useState<string | undefined>()
  const controller = useMemo(() => createDesktopAgentAvatarController({
    isCurrent: () => useAuthStore.getState().user?.id === props.accountId,
    pick: pickDesktopProfileAvatar,
    onSaved: () => {},
    onDraft: image => latest.current.onDraft(image),
    onError: () => setError(true),
    onBusy: value => { setBusy(value); latest.current.onBusy(value) },
  }), [props.accountId])
  useEffect(() => {
    active.current = true
    controller.start()
    const unsubscribe = useAuthStore.subscribe(state => {
      if (state.user?.id !== props.accountId) { active.current = false; controller.stop() }
    })
    return () => { active.current = false; controller.stop(); unsubscribe() }
  }, [controller, props.accountId])
  useEffect(() => {
    if (!props.draft) { setPreview(undefined); return }
    const url = URL.createObjectURL(props.draft)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [props.draft])
  const disabled = props.disabled || busy
  return <View style={{ alignItems: 'flex-start', gap: 8 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={t('agents_avatar_change')}
      accessibilityState={{ busy, disabled }} disabled={disabled}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onPress={() => { setError(false); void controller.chooseDraft() }}
      style={({ pressed }) => ({ padding: 4, borderWidth: 1, borderColor: focused ? colors.brand : colors.bg, opacity: pressed ? 0.7 : 1 })}>
      {preview ? <Image source={{ uri: preview }} style={{ width: 76, height: 76, borderRadius: avatarBorderRadius(76) }} />
        : <RoomIdentityAvatar name={props.name} avatar={props.restoreOwnerDraft ? null : props.agent?.avatar} ownerName={user?.name}
          ownerAvatar={user?.avatar} agent size={76} />}
    </Pressable>
    {props.agent?.avatar ? <DesktopMachineAction label={t('agents_avatar_use_mine')} disabled={disabled}
      onPress={() => {
        if (window.confirm(t('agents_avatar_use_mine_confirm'))) { setError(false); props.onRestoreOwnerDraft() }
      }} /> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: colors.error }}>{t('agents_avatar_save_failed')}</Text> : null}
  </View>
}
