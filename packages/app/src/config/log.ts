import { initLogReporter, reportLog } from '@shennian/shared'
import { getServerUrl } from './server'
import { Platform } from 'react-native'

function getLogBaseUrl(): string {
  const base = getServerUrl()
  if (base.startsWith('http://localhost') || base.startsWith('http://127.0.0.1')) {
    return base
  }
  return `${base}/api`
}

export function initAppLogReporter(): void {
  initLogReporter(getLogBaseUrl, {
    source: 'app',
    type: 'internal',
    metadata: { platform: Platform.OS },
  })
}

export { reportLog }
