// @arch open-source/docs/cli-runtime.md
/* eslint-disable @typescript-eslint/no-explicit-any -- retired compatibility surface preserves legacy signatures */
import type { ExternalChannelSessionStatus } from '@shennian/wire'

export type ExternalMessageAttachment = {
  [key: string]: any
  kind?: string
  name?: string
  mimeType?: string
  size?: number
  localPath?: string
  url?: string
  dataBase64?: string
}
export type ExternalReplyAttachment = ExternalMessageAttachment
export type ExternalMessageEvent = {
  [key: string]: any
  channelId: string
  channelType: string
  conversation: { id: string; name?: string }
  sender: { id: string; name?: string }
  text: string
  attachments: ExternalMessageAttachment[]
  messageId?: string
}
export type WeChatRpaSessionContext = {
  sessionId: string
  workDir: string
  agentType?: string
  agentSessionId?: string | null
  modelId?: string | null
  externalChannel?: ExternalChannelSessionStatus | null
}
export type WeChatAutomationLane = {
  run<T>(key: string, action: () => Promise<T>): Promise<T>
}
export type ChannelRuntimeOptions = {
  createWeChatRpaProductRunner?: unknown
  weChatAutomationLane?: WeChatAutomationLane
}

const retired = async () => { throw new Error('feature_retired') }

export class RetiredChannelRuntime {
  constructor(
    _onMessage?: (managerSessionId: string, event: ExternalMessageEvent) => void,
    _createReplyTarget?: (input: any) => any,
    _options?: ChannelRuntimeOptions,
  ) {}
  async start() {}
  async stop() {}
  getManagerChannel(..._args: any[]) { return null as any }
  getManagerChannelStatus(..._args: any[]) { return null as ExternalChannelSessionStatus | null }
  getChannelStatusById(..._args: any[]) { return null as ExternalChannelSessionStatus | null }
  getChannelById(..._args: any[]) { return undefined as any }
  listManagerChannelStatuses(..._args: any[]) { return [] as Array<{ managerSessionId: string }> }
  listManagerExternalChannels(..._args: any[]) { return [] as any[] }
  listChannelIdsManagedBy(..._args: any[]) { return [] as string[] }
  getDefaultReplyTarget(..._args: any[]): Promise<any> { return retired() }
  upsertManagerChannel(..._args: any[]): Promise<any> { return retired() }
  upsertManagerWeChatRpaChannel(..._args: any[]): Promise<any> { return retired() }
  syncManagerWeChatRpaChannel(..._args: any[]): Promise<any> { return retired() }
  cancelManagerWeChatRpaOutbound(..._args: any[]): Promise<any> { return retired() }
  deleteManagerWeChatRpaChannel(..._args: any[]): Promise<any> { return retired() }
  reply(..._args: any[]): Promise<any> { return retired() }
}

export class RetiredWeChatRpaSessionBindingSync {
  constructor(..._args: unknown[]) {}
  async reconcileSession(..._args: any[]) {}
  async reconcileAll(..._args: any[]) {}
}

export function createRetiredAutomationLane(): WeChatAutomationLane {
  return { run: async () => { throw new Error('feature_retired') } }
}

export function createRetiredChannelApiClient(..._args: any[]) {
  return { listBindings: async (..._args: any[]) => ({ bindings: [] as any[] }) }
}

export function retiredDirectWeChat(..._args: any[]): Promise<any> {
  return Promise.reject(new Error('feature_retired'))
}

export function splitExternalReplyText(text: string) {
  return [text]
}

export function weChatChannelConversationId(name: string) {
  return `retired:${name}`
}
