/**
 * Debug: see raw PTY output from each CLI
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').replace(/[\x00-\x08\x0e-\x1f]/g, '')
}

async function probeWithScript(cmd: string, args: string[], label: string): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn('script', ['-q', '/dev/null', cmd, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TERM: 'dumb', COLUMNS: '200', LINES: '50', NO_COLOR: '1' },
    })

    let output = ''
    const timer = setTimeout(() => {
      console.log(`[${label}] Timeout, killing...`)
      proc.kill('SIGKILL')
    }, 12_000)

    proc.stdout.on('data', (d: Buffer) => {
      const chunk = d.toString()
      output += chunk
      process.stdout.write(`[${label} stdout] ${JSON.stringify(chunk).slice(0, 200)}\n`)
    })

    proc.stderr?.on('data', (d: Buffer) => {
      process.stdout.write(`[${label} stderr] ${d.toString().slice(0, 200)}\n`)
    })

    proc.on('close', (code) => {
      clearTimeout(timer)
      console.log(`[${label}] exited code=${code}, output length=${output.length}`)
      resolve(output)
    })

    // After 3 seconds, send /model
    setTimeout(() => {
      console.log(`[${label}] Sending /model...`)
      proc.stdin.write('/model\n')
    }, 3000)

    // After 8 seconds, send ESC + Ctrl+C
    setTimeout(() => {
      console.log(`[${label}] Sending ESC + Ctrl+C...`)
      proc.stdin.write('\x1b')
      setTimeout(() => {
        proc.stdin.write('\x03')
        proc.stdin.end()
      }, 500)
    }, 8000)
  })
}

async function main() {
  const target = process.argv[2] || 'claude'

  console.log(`=== Probing ${target} ===\n`)

  const output = await probeWithScript(target, [], target)

  console.log(`\n=== Cleaned output ===`)
  const clean = stripAnsi(output)
  console.log(clean)

  // Save raw output for inspection
  const rawPath = `/tmp/probe-${target}-raw.txt`
  const cleanPath = `/tmp/probe-${target}-clean.txt`
  fs.writeFileSync(rawPath, output)
  fs.writeFileSync(cleanPath, clean)
  console.log(`\nRaw saved to ${rawPath}`)
  console.log(`Clean saved to ${cleanPath}`)
}

main().catch(console.error)
