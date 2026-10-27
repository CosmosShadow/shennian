// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/agent-runtime-compatibility.test.ts

import fs from 'node:fs'
import os from 'node:os'
import type { AgentRuntimeSummary } from '@shennian/wire'
import type { DetectedAgent } from './detect.js'
import { getCodexDesktopCommandCandidates, getCommandVersion, type ResolvedCommandSpec } from './command-spec.js'

type RuntimeProbe = {
  platform?: NodeJS.Platform
  homeDir?: string
  exists?: (filePath: string) => boolean
  getVersion?: (spec: ResolvedCommandSpec) => string | undefined
}

function detectCodexDesktopVersion(probe: RuntimeProbe): string | undefined {
  const platform = probe.platform ?? process.platform
  if (platform !== 'darwin') return undefined
  const exists = probe.exists ?? fs.existsSync
  const getVersion = probe.getVersion ?? getCommandVersion
  for (const executable of getCodexDesktopCommandCandidates(platform, probe.homeDir ?? os.homedir())) {
    if (!exists(executable)) continue
    const version = getVersion({
      command: executable, args: [], display: 'Codex Desktop', kind: 'native', path: executable,
    })
    if (version) return version
  }
  return undefined
}

export function getAgentRuntimeSummary(
  agent: Pick<DetectedAgent, 'type' | 'version'>,
  probe: RuntimeProbe = {},
): AgentRuntimeSummary | undefined {
  const cliVersion = agent.version
  const desktopVersion = agent.type === 'codex' ? detectCodexDesktopVersion(probe) : undefined
  if (!cliVersion && !desktopVersion) return undefined

  const compatibility = cliVersion && desktopVersion
    ? cliVersion === desktopVersion ? 'compatible' as const : 'version_mismatch' as const
    : undefined

  return {
    ...(cliVersion ? { cliVersion } : {}),
    ...(desktopVersion ? { desktopVersion } : {}),
    ...(compatibility ? { compatibility } : {}),
    ...(compatibility === 'version_mismatch' ? { upgradeAction: 'manual' as const } : {}),
  }
}
