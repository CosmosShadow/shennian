// @arch docs/architecture/session-organization.md
// @test packages/app/src/__tests__/project-list-performance.test.ts
import { memo, useCallback } from 'react'
import { useRouter } from 'expo-router'
import { hasSessionUnread, isSessionPinned, useSessionsStore } from '@shennian/shared'
import type { NianSession } from '@shennian/wire'
import { accountRuntime } from '../../account-runtime/accountRuntime'
import { MobileHomeSessionItem } from '../../session-list/components/MobileHomeSessionItem'

/** Keep row subscriptions and actions local: one preview must not repaint the list. */
export const ProjectSessionListItem = memo(function ProjectSessionListItem({
  session, coordinationStatus, onDelete,
}: {
  session: NianSession
  coordinationStatus?: string
  onDelete: (id: string) => void
}) {
  const router = useRouter()
  const preview = useSessionsStore(state => state.previews[session.id])
  const onPress = useCallback(() => router.navigate(`/(main)/chat/${session.id}`), [router, session.id])
  const onTogglePin = useCallback((item: NianSession) => {
    void accountRuntime.updateSessionUserState(item.id, { pinned: !isSessionPinned(item) }).catch(() => {})
  }, [])
  const onToggleUnread = useCallback((item: NianSession) => {
    if (hasSessionUnread(item)) {
      void accountRuntime.markSessionRead(item.id, new Date().toISOString()).catch(() => {})
    } else {
      void accountRuntime.updateSessionUserState(item.id, { manualUnread: true }).catch(() => {})
    }
  }, [])
  return <MobileHomeSessionItem session={session} preview={preview}
    coordinationStatus={coordinationStatus} hideMachineName onPress={onPress}
    onDelete={onDelete} onTogglePin={onTogglePin} onToggleUnread={onToggleUnread} />
})
