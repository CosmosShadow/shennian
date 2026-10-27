// @arch docs/architecture/app/chat-attachments-preview.md
// @test src/__tests__/file-preview-language.test.ts

import hljs from 'highlight.js'

export type FilePreviewType =
  | 'image'
  | 'svg'
  | 'html'
  | 'markdown'
  | 'pdf'
  | 'audio'
  | 'video'
  | 'csv'
  | 'code'
  | 'unknown'

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico'])
const AUDIO_EXTS = new Set(['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'flac', 'opus'])
const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'm4v', 'avi'])
const HTML_EXTS = new Set(['html', 'htm'])
const MARKDOWN_EXTS = new Set(['md', 'mdx'])

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  mts: 'typescript',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  css: 'css',
  scss: 'scss',
  less: 'less',
  json: 'json',
  jsonc: 'jsonc',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'shellscript',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  sol: 'solidity',
  vue: 'xml',
  svelte: 'xml',
  txt: 'plaintext',
  log: 'plaintext',
  env: 'plaintext',
  gitignore: 'plaintext',
  ini: 'ini',
  conf: 'ini',
  cfg: 'ini',
  r: 'r',
  lua: 'lua',
  pl: 'perl',
  perl: 'perl',
  dart: 'dart',
}

const BASENAME_TO_LANG: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  '.gitignore': 'plaintext',
  '.env': 'plaintext',
}

let solidityRegistered = false

export function getPreviewFileExt(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : ''
}

export function getPreviewLanguage(filename: string): string {
  const basename = filename.split(/[\\/]/).pop()?.toLowerCase() ?? filename.toLowerCase()
  if (BASENAME_TO_LANG[basename]) return BASENAME_TO_LANG[basename]
  return EXT_TO_LANG[getPreviewFileExt(filename)] ?? 'plaintext'
}

export function getPreviewFileType(filename: string): FilePreviewType {
  const ext = getPreviewFileExt(filename)
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (ext === 'svg') return 'svg'
  if (HTML_EXTS.has(ext)) return 'html'
  if (MARKDOWN_EXTS.has(ext)) return 'markdown'
  if (ext === 'pdf') return 'pdf'
  if (AUDIO_EXTS.has(ext)) return 'audio'
  if (VIDEO_EXTS.has(ext)) return 'video'
  if (ext === 'csv') return 'csv'
  if (EXT_TO_LANG[ext]) return 'code'
  const basename = filename.split(/[\\/]/).pop()?.toLowerCase() ?? filename.toLowerCase()
  if (BASENAME_TO_LANG[basename]) return 'code'
  return 'unknown'
}

function ensureSolidityLanguage() {
  if (solidityRegistered || hljs.getLanguage('solidity')) return
  hljs.registerLanguage('solidity', () => ({
    name: 'Solidity',
    aliases: ['sol'],
    keywords: {
      keyword:
        'abstract after alias anonymous as assembly break catch constructor continue contract delete do emit enum error event external fallback for from function if import indexed interface internal is library mapping memory modifier new override payable pragma private public pure receive return returns storage struct try type unchecked using view virtual while',
      literal: 'true false wei gwei ether seconds minutes hours days weeks',
      built_in:
        'address bool bytes bytes1 bytes2 bytes3 bytes4 bytes5 bytes6 bytes7 bytes8 bytes9 bytes10 bytes11 bytes12 bytes13 bytes14 bytes15 bytes16 bytes17 bytes18 bytes19 bytes20 bytes21 bytes22 bytes23 bytes24 bytes25 bytes26 bytes27 bytes28 bytes29 bytes30 bytes31 bytes32 int int8 int16 int24 int32 int40 int48 int56 int64 int72 int80 int88 int96 int104 int112 int120 int128 int136 int144 int152 int160 int168 int176 int184 int192 int200 int208 int216 int224 int232 int240 int248 int256 string uint uint8 uint16 uint24 uint32 uint40 uint48 uint56 uint64 uint72 uint80 uint88 uint96 uint104 uint112 uint120 uint128 uint136 uint144 uint152 uint160 uint168 uint176 uint184 uint192 uint200 uint208 uint216 uint224 uint232 uint240 uint248 uint256',
    },
    contains: [
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      hljs.QUOTE_STRING_MODE,
      hljs.APOS_STRING_MODE,
      hljs.C_NUMBER_MODE,
    ],
  }))
  solidityRegistered = true
}

export function highlightPreviewCode(code: string, language: string): string {
  ensureSolidityLanguage()
  const normalizedLanguage = hljs.getLanguage(language) ? language : 'plaintext'
  return hljs.highlight(code, { language: normalizedLanguage, ignoreIllegals: true }).value
}

export type CodePreviewLine = {
  number: number
  text: string
  html: string
}

export function buildCodePreviewLines(code: string, language: string): CodePreviewLine[] {
  const sourceLines = code.split('\n')
  const lines = sourceLines.length > 0 ? sourceLines : ['']

  return lines.map((text, index) => ({
    number: index + 1,
    text,
    html: highlightPreviewCode(text || ' ', language),
  }))
}
