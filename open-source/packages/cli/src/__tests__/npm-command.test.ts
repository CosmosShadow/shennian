// @covers src/upgrade/npm-command.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isPrivateNode, resolveNpmCommand } from '../upgrade/npm-command.js'

const roots: string[] = []
function privateRuntime(files: string[]): string {
  const base = path.join(os.tmpdir(), 'shennian-tests', 'unit')
  fs.mkdirSync(base, { recursive: true })
  const root = fs.mkdtempSync(path.join(base, 'npm-command-'))
  roots.push(root)
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), '')
  }
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('npm command for the running Node', () => {
  it('keeps the historical PATH lookup for any Node outside the private runtime', () => {
    const root = privateRuntime([])
    expect(resolveNpmCommand('/opt/homebrew/bin/node', 'darwin', root)).toBe('npm')
    expect(resolveNpmCommand('C:\\Program Files\\nodejs\\node.exe', 'win32', root)).toBe('npm.cmd')
    expect(isPrivateNode(path.join(root, '..', 'node', 'bin', 'node'), root)).toBe(false)
  })

  it('uses the installer wrapper beside the private Node on macOS and Linux', () => {
    const root = privateRuntime(['bin/node', 'bin/shennian-npm'])
    expect(resolveNpmCommand(path.join(root, 'bin', 'node'), 'linux', root)).toBe(path.join(root, 'bin', 'shennian-npm'))
  })

  it('quotes npm.cmd beside the private Node on Windows', () => {
    const root = privateRuntime(['node.exe', 'npm.cmd'])
    expect(resolveNpmCommand(path.join(root, 'node.exe'), 'win32', root)).toBe(`"${path.join(root, 'npm.cmd')}"`)
  })

  it('falls back to PATH when the private runtime lacks its npm launcher', () => {
    const root = privateRuntime(['bin/node'])
    expect(resolveNpmCommand(path.join(root, 'bin', 'node'), 'darwin', root)).toBe('npm')
  })
})
