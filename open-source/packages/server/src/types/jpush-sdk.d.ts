declare module 'jpush-sdk' {
  export type PushPayload = {
    setPlatform: (...platforms: string[]) => PushPayload
    setAudience: (audience: unknown) => PushPayload
    setNotification: (...args: unknown[]) => PushPayload
    setOptions: (
      sendno?: number | null,
      timeToLive?: number | null,
      overrideMsgId?: number | null,
      apnsProduction?: boolean,
      bigPushDuration?: number | null,
    ) => PushPayload
    send: (callback: (err: Error | null, res?: unknown) => void) => void
  }

  export type JPushClient = {
    push: () => PushPayload
  }

  export type BuildClientOptions = {
    appKey: string
    masterSecret: string
    isDebug?: boolean
  }

  const JPush: {
    buildClient: (options: BuildClientOptions) => JPushClient
    registration_id: (...registrationIds: string[]) => unknown
    ios: (
      alert: string,
      sound?: string | null,
      badge?: number | null,
      contentAvailable?: boolean | null,
      extras?: Record<string, string>,
    ) => unknown
    android: (
      alert: string,
      title?: string | null,
      builderId?: number | null,
      extras?: Record<string, string>,
      priority?: number | null,
    ) => unknown
  }

  export default JPush
}
