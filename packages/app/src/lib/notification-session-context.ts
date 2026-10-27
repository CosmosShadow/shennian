// @arch docs/architecture/app/mobile-push.md

export type NotificationSessionData = {
  sessionId?: string
  preview?: string
  previewAt?: string
  [key: string]: unknown
}
