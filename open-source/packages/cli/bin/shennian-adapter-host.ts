#!/usr/bin/env node
// 神念 Adapter 协议 V1 的 Client 内置 Adapter Runtime 入口。
// daemon 不直接 import 用户的 adapter.mjs；它总是通过这个独立子进程加载。

import path from 'node:path'
import { runAdapterRuntimeHost } from '../src/adapter-kit/host.js'

const entryPath = process.argv[2]
const workDirIndex = process.argv.indexOf('--workdir')
const workDir = workDirIndex >= 0 ? process.argv[workDirIndex + 1] : process.cwd()

if (!entryPath) {
  process.stderr.write('Usage: shennian-adapter-host <adapter.mjs> [--workdir <path>]\n')
  process.exit(1)
}

runAdapterRuntimeHost({
  entryPath: path.resolve(entryPath),
  workDir,
}).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
