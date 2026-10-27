// @covers src/agents/command-spec.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'

const spawnMock = vi.fn()
const spawnSyncMock = vi.fn()

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
  spawnSync: spawnSyncMock,
}))

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

function mockPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  })
}

describe('command-spec', () => {
  it.each(['codex','claude'] as const)('rejects a desktop launcher named %s as a coding CLI', async type => {
    const mod = await import('../agents/command-spec.js')
    const spec = {command:type,args:[],display:type,kind:'native' as const,path:'/usr/local/bin/'+type}
    spawnSyncMock.mockReturnValue({status:0,stdout:'1.2.3',stderr:''})
    expect(mod.getBuiltinAgentVersion(type,spec)).toBeUndefined()
    spawnSyncMock.mockReturnValue({status:0,stdout:type === 'codex' ? 'codex-cli 0.154.0' : '2.1.76 (Claude Code)',stderr:''})
    expect(mod.getBuiltinAgentVersion(type,spec)).toBe(type === 'codex' ? '0.154.0' : '2.1.76')
  })

  beforeEach(() => {
    vi.resetModules()
    spawnMock.mockReset()
    spawnSyncMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
  })

  it('builds cmd.exe launch specs for Windows shim commands', async () => {
    const mod = await import('../agents/command-spec.js')
    const spec = mod.buildLaunchSpec({
      command: 'codex',
      args: [],
      display: 'codex',
      kind: 'cmd-shim',
      path: 'C:\\Users\\demo\\AppData\\Roaming\\npm\\codex.cmd',
    }, ['app-server', '--listen', 'stdio://'], 'C:\\work tree')

    expect(spec.command).toBe('cmd.exe')
    expect(spec.cwd).toBe('C:\\work tree')
    expect(spec.args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
    expect(spec.args[3]).toMatch(/^".+"$/)
    expect(spec.args[3]).toContain('codex.cmd')
    expect(spec.args[3]).toContain('app-server')
  })

  it('builds WSL launch specs with cwd conversion', async () => {
    const mod = await import('../agents/command-spec.js')
    const spec = mod.buildLaunchSpec({
      command: 'claude',
      args: [],
      display: 'claude',
      kind: 'wsl-bridge',
      path: 'C:\\Windows\\System32\\wsl.exe',
    }, ['--version'], 'C:\\Users\\demo\\My Repo')

    expect(spec.command).toBe('C:\\Windows\\System32\\wsl.exe')
    expect(spec.cwd).toBeUndefined()
    expect(spec.args.slice(0, 3)).toEqual(['-e', 'sh', '-lc'])
    expect(spec.args[3]).toContain("/mnt/c/Users/demo/My Repo")
    expect(spec.args[3]).toContain("'claude' '--version'")
  })

  it('throws a clear error when a Windows cwd cannot be mapped into WSL', async () => {
    const mod = await import('../agents/command-spec.js')

    expect(() => mod.buildLaunchSpec({
      command: 'claude',
      args: [],
      display: 'claude',
      kind: 'wsl-bridge',
      path: 'C:\\Windows\\System32\\wsl.exe',
    }, ['--version'], '\\\\server\\share\\repo')).toThrow('Cannot map Windows path to WSL workDir')
  })

  it('builds command-string launch specs for Windows custom-agent cmd shims', async () => {
    mockPlatform('win32')
    spawnSyncMock.mockImplementation((command: string, args: string[]) => {
      if (command === 'where' && args[0] === 'demo-agent') {
        return {
          status: 0,
          stdout: 'C:\\Users\\demo\\AppData\\Roaming\\npm\\demo-agent.cmd\r\n',
          stderr: '',
        }
      }
      return { status: 1, stdout: '', stderr: '' }
    })

    const mod = await import('../agents/command-spec.js')
    mod.resetCommandSpecCache()

    const spec = mod.buildCommandStringLaunchSpec('demo-agent --flag', ['/caps'], 'C:\\repo')
    expect(spec.command).toBe('cmd.exe')
    expect(spec.cwd).toBe('C:\\repo')
    expect(spec.args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
    expect(spec.args[3]).toMatch(/^".+"$/)
    expect(spec.args[3]).toContain('demo-agent.cmd')
    expect(spec.args[3]).toContain('--flag')
    expect(spec.args[3]).toContain('/caps')
  })

  it('detects Windows npm shims installed under nvm4w nodejs', async () => {
    mockPlatform('win32')
    const existsSpy = vi.spyOn(fs, 'existsSync')
      .mockImplementation((filePath) => String(filePath) === 'C:\\nvm4w\\nodejs\\codex.cmd')
    spawnSyncMock.mockImplementation((command: string, args: string[]) => {
      if (command === 'cmd.exe' && args.join(' ').includes('codex.cmd')) return { status: 0, stdout: 'codex-cli 0.154.0', stderr: '' }
      if (command === 'where') return { status: 1, stdout: '', stderr: '' }
      return { status: 1, stdout: '', stderr: '' }
    })

    const mod = await import('../agents/command-spec.js')
    mod.resetCommandSpecCache()

    expect(mod.resolveBuiltinCommand('codex')).toEqual(expect.objectContaining({
      command: 'codex',
      kind: 'cmd-shim',
      path: 'C:\\nvm4w\\nodejs\\codex.cmd',
    }))
    existsSpy.mockRestore()
  })

  it('prefers the macOS desktop Codex over an older PATH CLI for detection and launch', async () => {
    mockPlatform('darwin')
    const desktop = '/Applications/ChatGPT.app/Contents/Resources/codex'
    const oldCli = '/opt/homebrew/bin/codex'
    const existsSpy = vi.spyOn(fs, 'existsSync').mockImplementation((filePath) => filePath === desktop)
    spawnSyncMock.mockImplementation((command: string, args: string[]) => {
      if (command === desktop && args[0] === '--version') {
        return { status: 0, stdout: 'codex-cli 0.154.0', stderr: '' }
      }
      if (command === 'which' && args[0] === 'codex') {
        return { status: 0, stdout: `${oldCli}\n`, stderr: '' }
      }
      return { status: 1, stdout: '', stderr: '' }
    })
    const mod = await import('../agents/command-spec.js')
    const spec = mod.resolveBuiltinCommand('codex')!
    expect(spec.path).toBe(desktop)
    expect(mod.getBuiltinAgentVersion('codex', spec)).toBe('0.154.0')
    expect(mod.buildLaunchSpec(spec, ['app-server']).command).toBe(desktop)
    existsSpy.mockRestore()
  })

  it('does not mistake a Windows Desktop GUI binary for a CLI', async () => {
    mockPlatform('win32')
    const desktop = 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.908.9136.0_x64__2p2nqsd0c76g0\\app\\resources\\codex.exe'
    const cli = 'C:\\Users\\demo\\AppData\\Roaming\\npm\\codex.cmd'
    const existsSpy = vi.spyOn(fs, 'existsSync').mockImplementation((filePath) => filePath === desktop)
    spawnSyncMock.mockImplementation((command: string, args: string[]) => {
      if (command === 'where' && args[0] === 'codex') {
        return { status: 0, stdout: `${cli}\r\n`, stderr: '' }
      }
      if (command === 'cmd.exe' && args.join(' ').includes(cli)) return { status: 0, stdout: 'codex-cli 0.154.0', stderr: '' }
      return { status: 1, stdout: '', stderr: '' }
    })
    const mod = await import('../agents/command-spec.js')
    const spec = mod.resolveBuiltinCommand('codex')!
    expect(spec.kind).toBe('cmd-shim')
    expect(spec.path).toBe(cli)
    expect(mod.buildLaunchSpec(spec, ['app-server']).args[3]).toContain(cli)
    expect(spawnSyncMock).not.toHaveBeenCalledWith(desktop, expect.anything(), expect.anything())
    existsSpy.mockRestore()
  })

  it('falls back to an independent Codex CLI if a desktop binary cannot report its version', async () => {
    mockPlatform('darwin')
    const desktop = '/Applications/ChatGPT.app/Contents/Resources/codex'
    const cli = '/opt/homebrew/bin/codex'
    const existsSpy = vi.spyOn(fs, 'existsSync').mockImplementation((filePath) => filePath === desktop)
    spawnSyncMock.mockImplementation((command: string, args: string[]) => {
      if (command === 'which' && args[0] === 'codex') return { status: 0, stdout: `${cli}\n`, stderr: '' }
      return { status: 1, stdout: '', stderr: '' }
    })
    const mod = await import('../agents/command-spec.js')
    expect(mod.resolveBuiltinCommand('codex')?.path).toBe(cli)
    existsSpy.mockRestore()
  })

  it('detects Windows npm shims installed under user local npm-global', async () => {
    mockPlatform('win32')
    const existsSpy = vi.spyOn(fs, 'existsSync')
      .mockImplementation((filePath) => String(filePath) === 'C:\\Users\\demo\\AppData\\Local\\npm-global\\codex.cmd')
    spawnSyncMock.mockImplementation((command: string, args: string[]) => {
      if (command === 'cmd.exe' && args.join(' ').includes('codex.cmd')) return { status: 0, stdout: 'codex-cli 0.154.0', stderr: '' }
      if (command === 'where') return { status: 1, stdout: '', stderr: '' }
      return { status: 1, stdout: '', stderr: '' }
    })

    const oldUserProfile = process.env.USERPROFILE
    const oldLocalAppData = process.env.LOCALAPPDATA
    process.env.USERPROFILE = 'C:\\Users\\demo'
    process.env.LOCALAPPDATA = 'C:\\Users\\demo\\AppData\\Local'

    const mod = await import('../agents/command-spec.js')
    mod.resetCommandSpecCache()

    expect(mod.resolveBuiltinCommand('codex')).toEqual(expect.objectContaining({
      command: 'codex',
      kind: 'cmd-shim',
      path: 'C:\\Users\\demo\\AppData\\Local\\npm-global\\codex.cmd',
    }))
    process.env.USERPROFILE = oldUserProfile
    process.env.LOCALAPPDATA = oldLocalAppData
    existsSpy.mockRestore()
  })

  it('runs explicit Windows .js command strings through node instead of Windows Script Host', async () => {
    mockPlatform('win32')
    spawnSyncMock.mockImplementation((command: string, args: string[]) => {
      if (command === 'where' && args[0] === 'node.exe') {
        return { status: 0, stdout: 'C:\\Program Files\\nodejs\\node.exe\r\n', stderr: '' }
      }
      return { status: 1, stdout: '', stderr: '' }
    })

    const mod = await import('../agents/command-spec.js')
    mod.resetCommandSpecCache()

    const spec = mod.buildCommandStringLaunchSpec(
      'C:\\Users\\demo\\AppData\\Local\\npm-global\\node_modules\\@openai\\codex\\bin\\codex.js',
      ['--version'],
      'C:\\repo',
    )

    expect(spec).toEqual({
      command: 'C:\\Program Files\\nodejs\\node.exe',
      args: [
        'C:\\Users\\demo\\AppData\\Local\\npm-global\\node_modules\\@openai\\codex\\bin\\codex.js',
        '--version',
      ],
      cwd: 'C:\\repo',
    })
  })

  it('spawns Windows cmd shims with verbatim arguments to avoid cmd.exe re-quoting', async () => {
    mockPlatform('win32')
    spawnSyncMock.mockImplementation((command: string, args: string[]) => {
      if (command === 'where' && args[0] === 'claude') {
        return {
          status: 0,
          stdout: 'C:\\Users\\demo\\AppData\\Roaming\\npm\\claude.cmd\r\n',
          stderr: '',
        }
      }
      return { status: 1, stdout: '', stderr: '' }
    })
    spawnMock.mockReturnValue({} as any)

    const mod = await import('../agents/command-spec.js')
    mod.resetCommandSpecCache()
    const spec = mod.resolveBuiltinCommand('claude')
    expect(spec).toBeTruthy()

    mod.spawnResolvedCommand(spec!, ['-p', 'hello'], {
      cwd: 'C:\\repo',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })

    expect(spawnMock).toHaveBeenCalledWith(
      'cmd.exe',
      expect.any(Array),
      expect.objectContaining({
        cwd: 'C:\\repo',
        windowsHide: true,
        windowsVerbatimArguments: true,
      }),
    )
  })

  it('allows explicit visible Windows launches for future interactive callers', async () => {
    mockPlatform('win32')
    spawnSyncMock.mockImplementation((command: string, args: string[]) => {
      if (command === 'where' && args[0] === 'claude') {
        return {
          status: 0,
          stdout: 'C:\\Tools\\claude.exe\r\n',
          stderr: '',
        }
      }
      return { status: 1, stdout: '', stderr: '' }
    })
    spawnMock.mockReturnValue({} as any)

    const mod = await import('../agents/command-spec.js')
    mod.resetCommandSpecCache()
    const spec = mod.resolveBuiltinCommand('claude')

    mod.spawnResolvedCommand(spec!, ['--print'], {
      windowsHide: false,
      stdio: 'inherit',
    })

    expect(spawnMock).toHaveBeenCalledWith(
      'C:\\Tools\\claude.exe',
      ['--print'],
      expect.objectContaining({ windowsHide: false }),
    )
  })

  it('injects fallback PATH entries for command-string spawns on macOS/Linux', async () => {
    mockPlatform('darwin')
    spawnMock.mockReturnValue({} as any)

    const mod = await import('../agents/command-spec.js')
    mod.spawnCommandString('shennian manager', ['sessions', 'list', '--json'], {
      cwd: '/repo',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: '/usr/bin:/bin' },
    })

    expect(spawnMock).toHaveBeenCalledWith(
      'shennian',
      ['manager', 'sessions', 'list', '--json'],
      expect.objectContaining({
        cwd: '/repo',
        windowsHide: true,
        env: expect.objectContaining({
          PATH: expect.stringContaining('/.npm-global/bin'),
        }),
      }),
    )
  })

  it('detects the newest Claude Code bundled with Claude Desktop on macOS', async () => {
    mockPlatform('darwin')
    const desktopRoot = `${process.env.HOME}/Library/Application Support/Claude/claude-code`
    const bundledBinary = `${desktopRoot}/2.10.0/claude.app/Contents/MacOS/claude`
    const readdirSpy = vi.spyOn(fs, 'readdirSync').mockImplementation(((target: fs.PathLike) => {
      if (String(target) === desktopRoot) {
        return [
          { name: '2.9.0', isDirectory: () => true },
          { name: '2.10.0', isDirectory: () => true },
        ] as unknown as ReturnType<typeof fs.readdirSync>
      }
      throw new Error('missing')
    }) as unknown as typeof fs.readdirSync)
    const existsSpy = vi.spyOn(fs, 'existsSync')
      .mockImplementation((target) => String(target) === bundledBinary)
    spawnSyncMock.mockReturnValue({ status: 1, stdout: '', stderr: '' })

    const mod = await import('../agents/command-spec.js')
    mod.resetCommandSpecCache()

    expect(mod.resolveBuiltinCommand('claude')).toEqual(expect.objectContaining({
      command: 'claude',
      kind: 'native',
      path: bundledBinary,
    }))
    readdirSpy.mockRestore()
    existsSpy.mockRestore()
  })

  it('prefers native Windows binaries over cmd shims', async () => {
    mockPlatform('win32')
    spawnSyncMock.mockImplementation((command: string, args: string[]) => {
      if (command === 'where' && args[0] === 'codex') {
        return {
          status: 0,
          stdout: 'C:\\Tools\\codex.exe\r\nC:\\Users\\demo\\AppData\\Roaming\\npm\\codex.cmd\r\n',
          stderr: '',
        }
      }
      if (args[0] === '--version') return { status: 0, stdout: 'codex-cli 0.154.0', stderr: '' }
      return { status: 1, stdout: '', stderr: '' }
    })

    const mod = await import('../agents/command-spec.js')
    mod.resetCommandSpecCache()

    const spec = mod.resolveBuiltinCommand('codex')
    expect(spec).toEqual(expect.objectContaining({
      kind: 'native',
      path: 'C:\\Tools\\codex.exe',
    }))
    expect(spawnSyncMock).toHaveBeenCalledWith(
      'where',
      ['codex'],
      expect.objectContaining({ windowsHide: true }),
    )
  })

  it('falls back to WSL bridge when the command is only available inside WSL', async () => {
    mockPlatform('win32')
    spawnSyncMock.mockImplementation((command: string, args: string[]) => {
      if (command === 'where' && args[0] === 'claude') {
        return { status: 1, stdout: '', stderr: '' }
      }
      if (command === 'where' && args[0] === 'wsl.exe') {
        return { status: 0, stdout: 'C:\\Windows\\System32\\wsl.exe\r\n', stderr: '' }
      }
      if (command === 'C:\\Windows\\System32\\wsl.exe') {
        return { status: 0, stdout: '', stderr: '' }
      }
      return { status: 1, stdout: '', stderr: '' }
    })

    const mod = await import('../agents/command-spec.js')
    mod.resetCommandSpecCache()

    const spec = mod.resolveBuiltinCommand('claude')
    expect(spec).toEqual(expect.objectContaining({
      kind: 'wsl-bridge',
      path: 'C:\\Windows\\System32\\wsl.exe',
      command: 'claude',
    }))
    expect(spawnSyncMock).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\wsl.exe',
      expect.any(Array),
      expect.objectContaining({ windowsHide: true }),
    )
  })

  it('hides Windows version probes launched through spawnSync', async () => {
    mockPlatform('win32')
    spawnSyncMock.mockReturnValue({ status: 0, stdout: '1.2.3', stderr: '' })

    const mod = await import('../agents/command-spec.js')
    const version = mod.getCommandVersion({
      command: 'tool',
      args: [],
      display: 'tool',
      kind: 'native',
      path: 'C:\\Tools\\tool.exe',
    })

    expect(version).toBe('1.2.3')
    expect(spawnSyncMock).toHaveBeenCalledWith(
      'C:\\Tools\\tool.exe',
      ['--version'],
      expect.objectContaining({ windowsHide: true }),
    )
  })

  it('uses Cursor about output instead of a potentially stale --version result', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'About Cursor CLI\n\nCLI Version         2026.09.02-c22c1a3\n',
      stderr: '',
    })

    const mod = await import('../agents/command-spec.js')
    const version = mod.getBuiltinAgentVersion('cursor', {
      command: 'agent',
      args: [],
      display: 'agent',
      kind: 'native',
      path: '/usr/local/bin/agent',
    })

    expect(version).toBe('2026.09.02-c22c1a3')
    expect(spawnSyncMock).toHaveBeenCalledWith(
      '/usr/local/bin/agent',
      ['about'],
      expect.objectContaining({ windowsHide: true }),
    )
  })

  it('fails Cursor version detection closed when about output is missing', async () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: '2026.08.31-old', stderr: '' })

    const mod = await import('../agents/command-spec.js')
    expect(mod.getBuiltinAgentVersion('cursor', {
      command: 'agent',
      args: [],
      display: 'agent',
      kind: 'native',
      path: '/usr/local/bin/agent',
    })).toBeUndefined()
  })

  it('refreshes stale Windows PATH from persistent user settings and uses the same spaced CLI for launch', async () => {
    mockPlatform('win32')
    vi.stubEnv('PATH', 'C:\\Windows\\System32')
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    const cli = 'C:\\Users\\demo\\My Tools\\codex.exe'
    let installedPath = ''
    spawnSyncMock.mockImplementation((command: string, args: string[], options: any) => {
      if (command.endsWith('powershell.exe')) return { status: 0, stdout: JSON.stringify({ path: installedPath, codexRoots: [] }) }
      if (command === 'where' && args[0] === 'codex' && options.env.PATH.includes('My Tools')) return { status: 0, stdout: cli }
      if (command === cli) return { status: 0, stdout: 'codex-cli 0.155.0-alpha.9' }
      if (command === 'where' && args[0] === 'wsl.exe') return { status: 0, stdout: 'C:\\Windows\\System32\\wsl.exe' }
      return { status: 1, stdout: '' }
    })
    const mod = await import('../agents/command-spec.js')
    expect(mod.resolveBuiltinCommand('codex')).toBeNull()
    installedPath = 'C:\\Users\\demo\\My Tools'
    expect(mod.resolveBuiltinCommand('codex')).toBeNull() // cached until explicit refresh
    mod.resetCommandSpecCache()
    const spec = mod.resolveBuiltinCommand('codex')!
    expect(spec.path).toBe(cli)
    expect(mod.buildLaunchSpec(spec, ['app-server', '--listen', 'stdio://'], 'C:\\work tree')).toEqual({
      command: cli, args: ['app-server', '--listen', 'stdio://'], cwd: 'C:\\work tree',
    })
    expect(spawnSyncMock.mock.calls.some(([command]) => command.endsWith('wsl.exe'))).toBe(false)
    vi.resetModules() // replacement daemon, same persisted OS configuration
    const restarted = await import('../agents/command-spec.js')
    expect(restarted.resolveBuiltinCommand('codex')?.path).toBe(cli)
  })

  it.each([true, false])('accepts a current-user Desktop candidate only when it is a real CLI (%s)', async (isCli) => {
    mockPlatform('win32')
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    const root = 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_test'
    const cli = `${root}\\app\\resources\\codex.exe`
    spawnSyncMock.mockImplementation((command: string) => {
      if (command.endsWith('powershell.exe')) return { status: 0, stdout: JSON.stringify({ path: '', codexRoots: [root] }) }
      if (command === cli) return { status: 0, stdout: isCli ? 'codex-cli 0.155.0-alpha.9' : '26.908.1' }
      return { status: 1, stdout: '' }
    })
    const mod = await import('../agents/command-spec.js')
    expect(mod.resolveBuiltinCommand('codex')?.path ?? null).toBe(isCli ? cli : null)
  })

  it.each([true, false])('discovers the nested macOS Codex CLI with a stale daemon PATH only when callable (%s)', async (isCli) => {
    mockPlatform('darwin')
    const cli = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'
    vi.spyOn(fs, 'existsSync').mockImplementation((file) => String(file) === cli)
    spawnSyncMock.mockImplementation((command: string) => command === cli
      ? { status: 0, stdout: isCli ? 'codex-cli 0.159.2' : '26.1009.1', stderr: '' }
      : { status: 1, stdout: '', stderr: '' })
    const mod = await import('../agents/command-spec.js')
    const spec = mod.resolveBuiltinCommand('codex')
    expect(spec?.path ?? null).toBe(isCli ? cli : null)
    if (spec) expect(mod.buildLaunchSpec(spec, ['app-server', '--listen', 'stdio://'])).toMatchObject({
      command: cli, args: ['app-server', '--listen', 'stdio://'],
    })
  })

  describe('Codex Desktop per-user CLI copy', () => {
    const local = 'C:\\Users\\demo\\AppData\\Local'
    const bin = `${local}\\OpenAI\\Codex\\bin`
    const storeCli = 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_test\\app\\resources\\codex.exe'
    function arrange(runnable: string[]) {
      mockPlatform('win32')
      vi.stubEnv('LOCALAPPDATA', local)
      vi.spyOn(fs, 'existsSync').mockReturnValue(false)
      vi.spyOn(fs, 'readdirSync').mockImplementation(((dir: fs.PathLike) => String(dir) === bin
        ? [{ name: 'old', isDirectory: () => true }, { name: 'new', isDirectory: () => true }, { name: 'note.txt', isDirectory: () => false }]
        : []) as never)
      vi.spyOn(fs, 'statSync').mockImplementation(((file: fs.PathLike) => ({
        mtimeMs: String(file).endsWith('\\new') ? 2_000 : 1_000,
      })) as never)
      spawnSyncMock.mockImplementation((command: string) => {
        if (command.endsWith('powershell.exe')) return { status: 0, stdout: JSON.stringify({ path: '', codexRoots: ['C:\\Program Files\\WindowsApps\\OpenAI.Codex_test'] }) }
        if (command === storeCli) return { status: null, error: Object.assign(new Error('spawnSync EPERM'), { code: 'EPERM' }) }
        if (runnable.includes(command)) return { status: 0, stdout: 'codex-cli 0.155.0-alpha.9.2' }
        return { status: 1, stdout: '' }
      })
    }

    it('finds the runnable copy Codex Desktop provisions, preferring the newest directory', async () => {
      arrange([`${bin}\\old\\codex.exe`, `${bin}\\new\\codex.exe`])
      const mod = await import('../agents/command-spec.js')
      expect(mod.resolveBuiltinCommand('codex')).toMatchObject({ kind: 'native', path: `${bin}\\new\\codex.exe` })
    })

    it('falls back to an older provisioned copy when the newest cannot run, never to WSL', async () => {
      arrange([`${bin}\\old\\codex.exe`])
      const mod = await import('../agents/command-spec.js')
      expect(mod.resolveBuiltinCommand('codex')?.path).toBe(`${bin}\\old\\codex.exe`)
      expect(spawnSyncMock.mock.calls.some(([command]) => command.endsWith('wsl.exe'))).toBe(false)
    })

    it('treats a Store-package copy that Windows refuses to launch as unavailable without failing discovery', async () => {
      arrange([])
      const mod = await import('../agents/command-spec.js')
      expect(mod.resolveBuiltinCommand('codex')).toBeNull()
      expect(spawnSyncMock.mock.calls.some(([command]) => command === storeCli)).toBe(true)
    })
  })

  it('honors an explicit Windows CLI without falling back if that selection fails', async () => {
    mockPlatform('win32')
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    const selected = 'D:\\AI Tools\\codex.cmd'
    vi.stubEnv('SHENNIAN_CODEX_PATH', selected)
    let working = true
    spawnSyncMock.mockImplementation((command: string, args: string[]) => {
      if (command === 'where') return { status: 0, stdout: 'C:\\Other\\codex.exe' }
      if (command === 'cmd.exe' && args.join(' ').includes(selected) && working) return { status: 0, stdout: 'codex-cli 0.154.0' }
      return { status: 1, stdout: '' }
    })
    const mod = await import('../agents/command-spec.js')
    expect(mod.resolveBuiltinCommand('codex')).toMatchObject({ kind: 'cmd-shim', path: selected })
    working = false
    mod.resetCommandSpecCache()
    expect(mod.resolveBuiltinCommand('codex')).toBeNull()
    expect(spawnSyncMock.mock.calls.some(([command]) => command === 'C:\\Other\\codex.exe')).toBe(false)
  })

  it('fails closed for Codex when only WSL is available or Windows discovery times out', async () => {
    mockPlatform('win32')
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    spawnSyncMock.mockImplementation((command: string, args: string[]) => {
      if (command.endsWith('powershell.exe')) return { status: null, error: new Error('ETIMEDOUT') }
      if (command === 'where' && args[0] === 'wsl.exe') return { status: 0, stdout: 'C:\\Windows\\System32\\wsl.exe' }
      if (command.endsWith('wsl.exe')) return { status: 0, stdout: 'codex-cli 0.154.0' }
      return { status: 1, stdout: '' }
    })
    const mod = await import('../agents/command-spec.js')
    expect(mod.resolveBuiltinCommand('codex')).toBeNull()
    expect(spawnSyncMock.mock.calls.some(([command]) => command.endsWith('wsl.exe'))).toBe(false)
  })

})
