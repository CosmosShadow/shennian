// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/archive-zip.test.ts

import fs from 'node:fs'
import path from 'node:path'

export type ZipArchiveOptions = {
  maxFiles?: number
  maxTotalSize?: number
}

export type ZipArchiveResult = {
  outputPath: string
  fileCount: number
  totalSize: number
}

type ZipEntry = {
  name: string
  sourcePath: string | null
  crc32: number
  size: number
  offset: number
  isDir: boolean
  mtimeMs: number
}

const DEFAULT_MAX_FILES = 5000
const DEFAULT_MAX_TOTAL_SIZE = 1024 * 1024 * 1024
const ZIP_VERSION_NEEDED = 20
const ZIP_UTF8_FLAG = 0x0800
const ZIP_STORE_METHOD = 0
const CHUNK_SIZE = 1024 * 1024

const crcTable = new Uint32Array(256)
for (let index = 0; index < 256; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  crcTable[index] = value >>> 0
}

function updateCrc32(crc: number, buffer: Buffer): number {
  let next = crc
  for (let index = 0; index < buffer.length; index += 1) {
    next = crcTable[(next ^ buffer[index]) & 0xff] ^ (next >>> 8)
  }
  return next >>> 0
}

function dosDateTime(mtimeMs: number): { date: number; time: number } {
  const date = new Date(mtimeMs || Date.now())
  const year = Math.max(1980, Math.min(2107, date.getFullYear()))
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  }
}

function writeUInt32(buffer: Buffer, value: number, offset: number): void {
  buffer.writeUInt32LE(value >>> 0, offset)
}

function writeLocalHeader(fd: number, entry: ZipEntry): void {
  const name = Buffer.from(entry.name, 'utf8')
  const { date, time } = dosDateTime(entry.mtimeMs)
  const header = Buffer.alloc(30)
  writeUInt32(header, 0x04034b50, 0)
  header.writeUInt16LE(ZIP_VERSION_NEEDED, 4)
  header.writeUInt16LE(ZIP_UTF8_FLAG, 6)
  header.writeUInt16LE(ZIP_STORE_METHOD, 8)
  header.writeUInt16LE(time, 10)
  header.writeUInt16LE(date, 12)
  writeUInt32(header, entry.crc32, 14)
  writeUInt32(header, entry.size, 18)
  writeUInt32(header, entry.size, 22)
  header.writeUInt16LE(name.length, 26)
  header.writeUInt16LE(0, 28)
  fs.writeSync(fd, header)
  fs.writeSync(fd, name)
}

function writeCentralDirectoryHeader(fd: number, entry: ZipEntry): void {
  const name = Buffer.from(entry.name, 'utf8')
  const { date, time } = dosDateTime(entry.mtimeMs)
  const header = Buffer.alloc(46)
  writeUInt32(header, 0x02014b50, 0)
  header.writeUInt16LE(0x031e, 4)
  header.writeUInt16LE(ZIP_VERSION_NEEDED, 6)
  header.writeUInt16LE(ZIP_UTF8_FLAG, 8)
  header.writeUInt16LE(ZIP_STORE_METHOD, 10)
  header.writeUInt16LE(time, 12)
  header.writeUInt16LE(date, 14)
  writeUInt32(header, entry.crc32, 16)
  writeUInt32(header, entry.size, 20)
  writeUInt32(header, entry.size, 24)
  header.writeUInt16LE(name.length, 28)
  header.writeUInt16LE(0, 30)
  header.writeUInt16LE(0, 32)
  header.writeUInt16LE(0, 34)
  header.writeUInt16LE(0, 36)
  writeUInt32(header, entry.isDir ? 0x10 : 0, 38)
  writeUInt32(header, entry.offset, 42)
  fs.writeSync(fd, header)
  fs.writeSync(fd, name)
}

function writeEndOfCentralDirectory(
  fd: number,
  entryCount: number,
  centralSize: number,
  centralOffset: number,
): void {
  const header = Buffer.alloc(22)
  writeUInt32(header, 0x06054b50, 0)
  header.writeUInt16LE(0, 4)
  header.writeUInt16LE(0, 6)
  header.writeUInt16LE(entryCount, 8)
  header.writeUInt16LE(entryCount, 10)
  writeUInt32(header, centralSize, 12)
  writeUInt32(header, centralOffset, 16)
  header.writeUInt16LE(0, 20)
  fs.writeSync(fd, header)
}

function normalizeZipName(relativePath: string, isDir: boolean): string {
  const normalized = relativePath.split(path.sep).join('/')
  return isDir && !normalized.endsWith('/') ? `${normalized}/` : normalized
}

function collectEntries(
  sourceDir: string,
  options: Required<ZipArchiveOptions>,
): Array<Omit<ZipEntry, 'offset'>> {
  const sourceStat = fs.statSync(sourceDir)
  const rootName = normalizeZipName(path.basename(sourceDir) || 'folder', true)
  const entries: Array<Omit<ZipEntry, 'offset'>> = [{
    name: rootName,
    sourcePath: null,
    crc32: 0,
    size: 0,
    isDir: true,
    mtimeMs: sourceStat.mtimeMs,
  }]
  let fileCount = 0
  let totalSize = 0

  const visit = (dirPath: string) => {
    const raw = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const dirent of raw) {
      const fullPath = path.join(dirPath, dirent.name)
      const relative = path.relative(sourceDir, fullPath)
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue

      const stat = fs.lstatSync(fullPath)
      if (stat.isSymbolicLink()) continue

      if (stat.isDirectory()) {
        entries.push({
          name: path.posix.join(rootName, normalizeZipName(relative, true)),
          sourcePath: null,
          crc32: 0,
          size: 0,
          isDir: true,
          mtimeMs: stat.mtimeMs,
        })
        visit(fullPath)
        continue
      }

      if (!stat.isFile()) continue
      fileCount += 1
      if (fileCount > options.maxFiles) throw new Error(`Too many files: ${fileCount}`)
      totalSize += stat.size
      if (totalSize > options.maxTotalSize) {
        throw new Error(`Folder too large: ${totalSize} bytes`)
      }

      entries.push({
        name: path.posix.join(rootName, normalizeZipName(relative, false)),
        sourcePath: fullPath,
        crc32: computeFileCrc32(fullPath),
        size: stat.size,
        isDir: false,
        mtimeMs: stat.mtimeMs,
      })
    }
  }

  visit(sourceDir)
  return entries
}

function computeFileCrc32(filePath: string): number {
  const fd = fs.openSync(filePath, 'r')
  const buffer = Buffer.alloc(CHUNK_SIZE)
  let crc = 0xffffffff
  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)
      if (bytesRead <= 0) break
      crc = updateCrc32(crc, buffer.subarray(0, bytesRead))
    }
  } finally {
    fs.closeSync(fd)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function writeFileData(fd: number, filePath: string): void {
  const sourceFd = fs.openSync(filePath, 'r')
  const buffer = Buffer.alloc(CHUNK_SIZE)
  try {
    while (true) {
      const bytesRead = fs.readSync(sourceFd, buffer, 0, buffer.length, null)
      if (bytesRead <= 0) break
      fs.writeSync(fd, buffer.subarray(0, bytesRead))
    }
  } finally {
    fs.closeSync(sourceFd)
  }
}

export function createZipArchive(
  sourceDir: string,
  outputPath: string,
  options: ZipArchiveOptions = {},
): ZipArchiveResult {
  const sourceStat = fs.statSync(sourceDir)
  if (!sourceStat.isDirectory()) throw new Error('Not a directory')

  const limits = {
    maxFiles: options.maxFiles ?? DEFAULT_MAX_FILES,
    maxTotalSize: options.maxTotalSize ?? DEFAULT_MAX_TOTAL_SIZE,
  }
  const scanned = collectEntries(sourceDir, limits)
  const zipEntries: ZipEntry[] = []
  let fileCount = 0
  let totalSize = 0

  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const fd = fs.openSync(outputPath, 'w')
  try {
    for (const entry of scanned) {
      const offset = fs.fstatSync(fd).size
      const nextEntry: ZipEntry = { ...entry, offset }
      writeLocalHeader(fd, nextEntry)
      if (nextEntry.sourcePath) {
        writeFileData(fd, nextEntry.sourcePath)
        fileCount += 1
        totalSize += nextEntry.size
      }
      zipEntries.push(nextEntry)
    }

    const centralOffset = fs.fstatSync(fd).size
    for (const entry of zipEntries) writeCentralDirectoryHeader(fd, entry)
    const centralSize = fs.fstatSync(fd).size - centralOffset
    writeEndOfCentralDirectory(fd, zipEntries.length, centralSize, centralOffset)
  } finally {
    fs.closeSync(fd)
  }

  return { outputPath, fileCount, totalSize }
}
