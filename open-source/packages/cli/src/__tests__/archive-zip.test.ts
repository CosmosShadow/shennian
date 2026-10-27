// @covers src/session/archive-zip.ts

import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createZipArchive } from '../session/archive-zip.js'

const tempRoots: string[] = []

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-zip-test-'))
  tempRoots.push(root)
  return root
}

function readCentralDirectoryNames(zipPath: string): string[] {
  const buffer = fs.readFileSync(zipPath)
  const eocdOffset = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  expect(eocdOffset).toBeGreaterThanOrEqual(0)
  const entryCount = buffer.readUInt16LE(eocdOffset + 10)
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16)
  const names: string[] = []
  let offset = centralOffset
  for (let index = 0; index < entryCount; index += 1) {
    expect(buffer.readUInt32LE(offset)).toBe(0x02014b50)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    names.push(buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'))
    offset += 46 + nameLength + extraLength + commentLength
  }
  return names
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('createZipArchive', () => {
  it('creates a UTF-8 ZIP archive for a directory tree', () => {
    const root = makeTempRoot()
    const source = path.join(root, '订单系统')
    fs.mkdirSync(path.join(source, 'docs'), { recursive: true })
    fs.writeFileSync(path.join(source, 'README.md'), '# Order\n', 'utf8')
    fs.writeFileSync(path.join(source, 'docs', '接口.txt'), 'api', 'utf8')

    const outputPath = path.join(root, '订单系统.zip')
    const result = createZipArchive(source, outputPath)

    expect(result).toMatchObject({ outputPath, fileCount: 2, totalSize: 11 })
    expect(fs.existsSync(outputPath)).toBe(true)
    expect(readCentralDirectoryNames(outputPath).sort()).toEqual([
      '订单系统/',
      '订单系统/README.md',
      '订单系统/docs/',
      '订单系统/docs/接口.txt',
    ])
  })

  it('rejects non-directory sources and oversized folders', () => {
    const root = makeTempRoot()
    const source = path.join(root, 'folder')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'a.txt'), 'abc', 'utf8')

    expect(() => createZipArchive(path.join(source, 'a.txt'), path.join(root, 'bad.zip'))).toThrow(
      'Not a directory',
    )
    expect(() =>
      createZipArchive(source, path.join(root, 'too-large.zip'), { maxTotalSize: 2 }),
    ).toThrow('Folder too large')
  })
})
