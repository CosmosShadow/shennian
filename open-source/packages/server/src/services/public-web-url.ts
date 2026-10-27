// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-cli-routes.test.ts src/__tests__/self-hosted-public-url.test.ts

import { normalizeInstanceOrigin } from '@shennian/wire'
import { getDeploymentMode } from './instance-settings.js'

export type PublicRequestOrigin = { protocol: string; hostname: string }

export function publicWebAppBaseUrl(request: PublicRequestOrigin): string {
  const configured = process.env.WEB_APP_PUBLIC_BASE_URL?.trim().replace(/\/+$/, '')
  if (getDeploymentMode() === 'self-hosted') {
    // Invitations carry capabilities: never send them to the official Web app.
    const target = configured || process.env.SHENNIAN_PUBLIC_URL
    if (!target) throw new Error('self_hosted_public_url_required')
    return normalizeInstanceOrigin(target)
  }
  if (configured) return configured
  if (process.env.NODE_ENV === 'production') return 'https://app.shennian.net'
  const host = request.hostname.includes(':') ? `[${request.hostname}]` : request.hostname
  return `${request.protocol}://${host}:8081`
}

export function roomWebUrl(request: PublicRequestOrigin, roomId: string): string {
  return `${publicWebAppBaseUrl(request)}/spaces/${encodeURIComponent(roomId)}`
}

export function roomInviteUrl(
  request: PublicRequestOrigin,
  roomId: string,
  inviteToken: string,
): string {
  const url = new URL(roomWebUrl(request, roomId))
  url.searchParams.set('invite', inviteToken)
  return url.toString()
}

export function roomLaunchUrl(
  request: PublicRequestOrigin,
  roomId: string,
  handoffToken: string,
): string {
  const url = new URL(roomWebUrl(request, roomId))
  url.searchParams.set('access', handoffToken)
  return url.toString()
}

export function machineInviteUrl(request: PublicRequestOrigin, token: string): string {
  return `${publicWebAppBaseUrl(request)}/machine-invites/${encodeURIComponent(token)}`
}
