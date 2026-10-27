// @arch docs/features/voice-shennian.md
// @test packages/app/src/__tests__/voice-chief-url.test.ts

import { getServerUrl } from '../../config/server'
import {
  SESSION_SYNC_DATA_EPOCH,
  SESSION_SYNC_PROTOCOL_VERSION,
} from '@shennian/wire'

export function buildVoiceChiefUrl(token: string): string {
  const base = new URL(getServerUrl())
  const protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
  const isLocalhost = base.hostname === 'localhost' || base.hostname === '127.0.0.1'
  const prefix = isLocalhost ? '' : '/api'
  return `${protocol}//${base.host}${prefix}/voice-chief/ws?token=${encodeURIComponent(token)}` +
    `&syncProtocol=${SESSION_SYNC_PROTOCOL_VERSION}&dataEpoch=${SESSION_SYNC_DATA_EPOCH}`
}
