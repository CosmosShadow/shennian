// @arch open-source/docs/cli-runtime.md

import type { ReqFrame } from '@shennian/wire'

const trustedManagerEvent = Symbol('trustedManagerEvent')
type TrustedReq = ReqFrame & { [trustedManagerEvent]?: true }

export function markTrustedManagerEvent(req: ReqFrame): ReqFrame {
  // Enumerable so internal object-spread routing (for recovery freeze) keeps
  // the marker; Symbols are still omitted by JSON/Wire serialization.
  Object.defineProperty(req, trustedManagerEvent, { value: true, enumerable: true })
  return req
}

export function isTrustedManagerEvent(req: ReqFrame): boolean {
  return (req as TrustedReq)[trustedManagerEvent] === true
}
