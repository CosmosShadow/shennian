// @arch docs/features/desktop-local-first-client.md#项目展开偏好
// @test ../../__tests__/desktop-shell-window-state.test.ts
import { isDesktopWorkspaceRoot } from '../../utils/desktopCrashRecovery'

/** Reveal on navigation, not startup/route restoration or live projection updates. */
export class DesktopSidebarProjectReveal {
  private accountId: string | null = null
  private pathname = ''
  private projectKey: string | null = null
  private pending = false

  take(accountId: string, pathname: string, projectKey: string | null, ready: boolean): boolean {
    if (accountId !== this.accountId) {
      this.accountId = accountId
      this.pathname = pathname
      this.projectKey = projectKey
      this.pending = false
    } else if (pathname !== this.pathname) {
      this.pending = !isDesktopWorkspaceRoot(this.pathname)
      this.pathname = pathname
      this.projectKey = projectKey
    } else if (projectKey) {
      if (this.projectKey && projectKey !== this.projectKey) this.pending = true
      this.projectKey = projectKey
    }
    if (!projectKey || !ready || !this.pending) return false
    this.pending = false
    return true
  }
}
