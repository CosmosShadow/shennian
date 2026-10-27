// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/macos-file-sandbox.test.ts

import fs from 'node:fs'
import path from 'node:path'

/**
 * A host-level (macOS Seatbelt) filesystem confinement, independent of any
 * Adapter's own tool allowlist. It denies read/write anywhere under
 * `confinedRoots` (typically the user's home directory) except the explicit
 * `scopes` reopened below, so a model exploit or Adapter tool-layer bug that
 * bypasses the Adapter's declared tools still cannot reach a sibling
 * visitor's directory or a credential file elsewhere under the same root.
 *
 * The profile denies `file-read-data`/`file-write*` (not the broader
 * `file-read*`, which also covers metadata) and otherwise `(allow
 * default)`, unlike a deny-by-default profile that also has to re-permit
 * every syscall a process needs just to start (mach lookups, sysctl,
 * posix_spawn, ...). That broader shape was tried and measurably crashes
 * trivial commands (`/bin/echo` exits 134/SIGABRT under `(deny default)`)
 * on the current macOS version; this narrower shape does not: it was
 * verified directly with `sandbox-exec` against a real command, a real
 * Adapter's normal reply, absolute-path reads, and symlink escapes, plus
 * the write path, all under a confined root, and none of network,
 * subprocess spawn, or plain execution broke.
 *
 * Leaving `file-read-metadata` (stat/exists/realpath — not directory
 * listing or file contents, both verified still denied) allowed everywhere
 * matters in practice: shell-script launchers common among installed CLIs
 * (e.g. Cursor's `cursor-agent` wrapper) call `realpath "$0"`, which needs
 * to stat every ancestor directory component on the way to the reopened
 * leaf — denying metadata on those ancestors broke that resolution even
 * though none of them were ever going to be read for content.
 *
 * It does not restrict network: the wrapped process still needs outbound
 * access for its own model-provider API call, which cannot be told apart
 * from a tool-initiated call at the OS level. It also does not restrict
 * process spawn or IPC — only file paths.
 */
export type MacosFileSandboxScope = { path: string; write: boolean }

export type MacosFileSandboxSpec = {
  confinedRoots: string[]
  scopes: MacosFileSandboxScope[]
}

export function isMacosFileSandboxSupported(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'darwin'
}

/**
 * Seatbelt evaluates the canonical path a syscall actually resolves to, not
 * the literal string a caller passed in (`/tmp` is itself a symlink to
 * `/private/tmp`). A rule written against the un-resolved spelling silently
 * never matches. Missing leaves (a workDir not yet created) fall back to the
 * nearest existing ancestor's real path, joined with the missing suffix.
 */
function resolveRealish(value: string): string {
  const normalized = path.resolve(value)
  try {
    return fs.realpathSync.native(normalized)
  } catch {
    const parent = path.dirname(normalized)
    if (parent === normalized) return normalized
    return path.join(resolveRealish(parent), path.basename(normalized))
  }
}

function quoteSbplString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function buildMacosFileSandboxProfile(spec: MacosFileSandboxSpec): string {
  const confinedRoots = [...new Set(spec.confinedRoots.map(resolveRealish))]
  if (!confinedRoots.length) throw new Error('macos_file_sandbox_confined_root_required')
  const scopes = spec.scopes.map((scope) => ({ path: resolveRealish(scope.path), write: scope.write }))
  const lines = ['(version 1)', '(allow default)']
  for (const root of confinedRoots) {
    lines.push(`(deny file-read-data file-write* (subpath ${quoteSbplString(root)}))`)
  }
  for (const scope of scopes) {
    // Must match the deny rule's operation literals exactly (`file-read-data`,
    // not the `file-read*` wildcard): mixing a literal deny with a wildcard
    // allow for the same underlying operation did not resolve by path
    // specificity as expected (verified directly — the wildcard allow lost
    // to the literal deny even for a strictly more specific subpath), while
    // literal-vs-literal correctly lets the more specific subpath win.
    const ops = scope.write ? 'file-read-data file-write*' : 'file-read-data'
    lines.push(`(allow ${ops} (subpath ${quoteSbplString(scope.path)}))`)
  }
  return `${lines.join('\n')}\n`
}

/**
 * Many installed CLI binaries (nvm/npm global installs in particular) are a
 * symlink under the confined root pointing at their real file elsewhere
 * under the same root (e.g. `~/.nvm/.../bin/opencode` -> `~/.nvm/.../lib/
 * node_modules/opencode-ai/bin/opencode.exe`). Exec'ing the *symlink path*
 * under this profile is denied (verified: `sandbox-exec: ... execvp() of
 * '<symlink>' failed: Operation not permitted`), while exec'ing its already-
 * resolved target succeeds — the kernel's exec path read for the initial
 * target binary is allowed, but resolving a denied-subpath symlink to get
 * there is not. Resolving here, once, keeps every caller from having to
 * know this.
 */
function resolveExecutableRealish(command: string): string {
  if (!path.isAbsolute(command)) return command
  try {
    return fs.realpathSync.native(command)
  } catch {
    return command
  }
}

/** Wrap a resolved launch with `sandbox-exec`; callers must not invoke this on a platform where it is unsupported. */
export function wrapCommandWithMacosFileSandbox(
  command: string,
  args: string[],
  spec: MacosFileSandboxSpec,
): { command: string; args: string[] } {
  if (!isMacosFileSandboxSupported()) {
    throw new Error('macos_file_sandbox_unsupported_platform')
  }
  const profile = buildMacosFileSandboxProfile(spec)
  return { command: 'sandbox-exec', args: ['-p', profile, '--', resolveExecutableRealish(command), ...args] }
}
