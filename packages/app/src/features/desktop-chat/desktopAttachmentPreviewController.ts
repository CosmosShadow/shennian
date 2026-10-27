// @arch docs/design/desktop/unified-desktop-control.md#组件复用清单
// @test ../../__tests__/desktop-attachment-preview-route.test.ts

import type { NianSession } from '@shennian/wire'

export type DesktopAttachmentPreviewParams = {
  sessionId?: string
  path?: string
  name?: string
  kind?: string
  line?: string
  endLine?: string
}

export type DesktopAttachmentPreviewRequest = {
  id: number
  path: string
  name: string
  kind?: 'folder'
  line?: number
  endLine?: number
}

export function resolveDesktopAttachmentPreview(
  params: DesktopAttachmentPreviewParams,
  sessions: NianSession[],
): { session: NianSession; request: DesktopAttachmentPreviewRequest } | null {
  const sessionId = validText(params.sessionId, 191)
  const path = validText(params.path, 4096)
  if (!sessionId || !path) return null
  const session = sessions.find((candidate) => candidate.id === sessionId)
  if (!session?.machineId || !session.workDir) return null
  const name = validText(params.name, 512) ?? path.split(/[\\/]/).pop() ?? path
  const line = positiveLine(params.line)
  const endLine = positiveLine(params.endLine)
  return {
    session,
    request: {
      id: stableRequestId(sessionId, path, line, endLine),
      path,
      name,
      ...(params.kind === 'folder' ? { kind: 'folder' as const } : {}),
      ...(line ? { line } : {}),
      ...(endLine ? { endLine } : {}),
    },
  }
}

function validText(value: string | undefined, maxLength: number): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) return null
  return /[\u0000-\u001f\u007f]/.test(value) ? null : value
}

function positiveLine(value: string | undefined): number | undefined {
  if (!value || !/^[1-9]\d{0,8}$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

function stableRequestId(sessionId: string, path: string, line?: number, endLine?: number): number {
  const input = `${sessionId}\u0000${path}\u0000${line ?? ''}\u0000${endLine ?? ''}`
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}
