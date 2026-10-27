// @arch open-source/docs/server-runtime.md
// @test open-source/deploy/self-hosted/core-boundary.test.mjs
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** TypeScript dependency resolution with private source files unavailable.
 * This is a dependency-boundary check, not a replacement for full typechecking.
 */
export function checkCoreBoundary({
  configPath = path.join(serverRoot, 'tsconfig.core.json'),
  forbiddenDirectories = [path.join(serverRoot, 'src/official'), path.resolve(serverRoot, '../../private'), path.resolve(serverRoot, '../../../private')],
} = {}) {
  const forbidden = forbiddenDirectories.map(dir => path.resolve(dir).replaceAll('\\', '/'))
  const isForbidden = file => {
    const normalized = path.resolve(file).replaceAll('\\', '/')
    return forbidden.some(dir => normalized === dir || normalized.startsWith(`${dir}/`))
  }
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath))
  if (parsed.errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(parsed.errors, diagnosticHost))
  if (parsed.fileNames.some(isForbidden)) throw new Error('core_entry_in_private_source')
  const host = ts.createCompilerHost(parsed.options)
  const readFile = host.readFile.bind(host)
  const fileExists = host.fileExists.bind(host)
  const directoryExists = host.directoryExists?.bind(host)
  host.readFile = file => isForbidden(file) ? undefined : readFile(file)
  host.fileExists = file => !isForbidden(file) && fileExists(file)
  host.directoryExists = dir => !isForbidden(dir) && Boolean(directoryExists?.(dir))
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options, host })
  const files = program.getSourceFiles().map(source => source.fileName)
  if (files.some(isForbidden)) throw new Error('core_imports_private_source')
  // Missing modules stay fatal even when the compiler could emit JS for them.
  const missingImports = [...program.getOptionsDiagnostics(), ...program.getSemanticDiagnostics()]
    .filter(item => [2307, 2792, 6053].includes(item.code))
  if (missingImports.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(missingImports, diagnosticHost))
  return { sourceFiles: files.filter(file => !file.endsWith('.d.ts')).length, forbiddenSourceFiles: 0 }
}

const diagnosticHost = {
  getCanonicalFileName: file => file,
  getCurrentDirectory: () => process.cwd(),
  getNewLine: () => '\n',
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify({ boundary: 'server-core', ...checkCoreBoundary() }))
}
