// @arch docs/architecture/data-sync.md#8-app-级统一正文副本与列表发布屏障
// @test src/__tests__/desktop-visible-body-sync.test.ts
import { desktopAccountActions } from '../../desktop-control/useDesktopAccountSync'

export function syncVisiblePersonalSessionBody(sessionId: string): Promise<void> {
  return desktopAccountActions.syncVisibleSessionBody(sessionId)
}
