// @arch open-source/docs/cli-runtime.md
// 官方 Adapter 支持列表：稳定 ID、显示名称，以及唯一详情文档的位置。
// 详情正文只写一次，维护在 open-source/docs/agent-adapters/，发布时随 Client
// 打包为只读文本资源；`adapter show` 与界面详情读取同一份正文。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type OfficialAdapterInfo = { id: string; name: string }

/** 与 `open-source/docs/agent-adapters/<id>.md` 一一对应。 */
export const OFFICIAL_ADAPTERS: OfficialAdapterInfo[] = [
  { id: 'claude', name: 'Claude Code' },
  { id: 'codex', name: 'Codex' },
  { id: 'cursor', name: 'Cursor Agent' },
  { id: 'workbuddy', name: 'WorkBuddy' },
  { id: 'opencode', name: 'OpenCode' },
  { id: 'pi-coding-agent', name: 'Pi Coding Agent' },
  { id: 'custom', name: '自定义 Node Adapter' },
]

export function findOfficialAdapter(id: string): OfficialAdapterInfo | undefined {
  return OFFICIAL_ADAPTERS.find((adapter) => adapter.id === id)
}

/**
 * Resolves the Markdown detail document for an official Adapter. Checks the
 * packaged resource location first (populated by the CLI build), then falls
 * back to the monorepo source location for local development and tests.
 */
export function readOfficialAdapterDoc(id: string): string | null {
  const packaged = path.join(bundledResourceDir(), `${id}.md`)
  if (fs.existsSync(packaged)) return fs.readFileSync(packaged, 'utf-8')
  const sourcePath = findRepoRoot()
  if (!sourcePath) return null
  const docPath = path.join(sourcePath, 'docs', 'agent-adapters', `${id}.md`)
  return fs.existsSync(docPath) ? fs.readFileSync(docPath, 'utf-8') : null
}

function bundledResourceDir(): string {
  return fileURLToPath(new URL('../../resources/agent-adapters/', import.meta.url))
}

function findRepoRoot(): string | null {
  let current = fileURLToPath(new URL('.', import.meta.url))
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) return current
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
  return null
}
