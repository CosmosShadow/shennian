// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/pair-browser.test.ts

import crypto from 'node:crypto'
import type { JsonValue } from '../daemon-ipc/json.js'

export function hashActionPayload(value: JsonValue): string {
  return crypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

export function hashPendingDeviceSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret, 'utf8').digest('hex')
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Pair authorization payload numbers must be finite.')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('Pair authorization payload must be plain JSON.')
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`)
    .join(',')}}`
}
