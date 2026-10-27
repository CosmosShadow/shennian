// @arch open-source/docs/wire.md
// @test open-source/packages/cli/src/__tests__/adapter-command.test.ts
// @test open-source/packages/server/src/__tests__/adapter-submissions.test.ts

export const ADAPTER_SUBMISSION_FILENAME = 'adapter.mjs'
export const ADAPTER_SUBMISSION_CONTENT_TYPE = 'text/javascript; charset=utf-8'
export const ADAPTER_SUBMISSION_MAX_BYTES = 256 * 1024

export type AdapterSubmissionPrivacyIssue =
  | 'binary_content'
  | 'credential_material'
  | 'environment_value'
  | 'absolute_path'
  | 'private_content'

export type AdapterSubmissionScanResult = {
  ok: boolean
  byteSize: number
  issues: AdapterSubmissionPrivacyIssue[]
}

const CREDENTIAL_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b(?:sk|rk|pk)-(?:live|test|proj)-[A-Za-z0-9_-]{12,}\b/,
  /\bgh[opusr]_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/i,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)\b\s*[:=]\s*["'\x60][^"'\x60\r\n]{8,}["'\x60]/i,
]

const ENVIRONMENT_VALUE_PATTERNS = [
  /\bprocess\.env(?:\.[A-Za-z_][A-Za-z0-9_]*|\[['"][A-Za-z_][A-Za-z0-9_]*['"]\])\s*=\s*["'\x60][^"'\x60\r\n]+["'\x60]/,
  /\b(?:env|environment)\s*:\s*\{[^}]*\b[A-Z][A-Z0-9_]{2,}\s*:\s*["'\x60][^"'\x60\r\n]{4,}["'\x60]/s,
]

const ABSOLUTE_PATH_PATTERNS = [
  /["'\x60]\/(?!\/)[^"'\x60\r\n]+["'\x60]/,
  /["'\x60][A-Za-z]:[\\/][^"'\x60\r\n]+["'\x60]/,
  /["'\x60]\\\\[^\\\s"'\x60]+\\[^"'\x60\r\n]+["'\x60]/,
]

const PRIVATE_CONTENT_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/,
  /\b[A-Za-z0-9.-]+\.(?:internal|corp|lan)\b/i,
  /(?:仅限内部|公司机密|客户机密|confidential|proprietary business logic)/i,
]

export function scanAdapterSubmissionSource(source: string): AdapterSubmissionScanResult {
  const byteSize = new TextEncoder().encode(source).byteLength
  const issues = new Set<AdapterSubmissionPrivacyIssue>()
  if (source.includes('\0') || /[\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(source)) {
    issues.add('binary_content')
  }
  if (CREDENTIAL_PATTERNS.some((pattern) => pattern.test(source))) {
    issues.add('credential_material')
  }
  if (ENVIRONMENT_VALUE_PATTERNS.some((pattern) => pattern.test(source))) {
    issues.add('environment_value')
  }
  if (ABSOLUTE_PATH_PATTERNS.some((pattern) => pattern.test(source))) {
    issues.add('absolute_path')
  }
  if (PRIVATE_CONTENT_PATTERNS.some((pattern) => pattern.test(source))) {
    issues.add('private_content')
  }
  return { ok: issues.size === 0, byteSize, issues: [...issues] }
}
