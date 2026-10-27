// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/pi-managed-extension.test.ts

import fs from 'node:fs'
import path from 'node:path'
import type { CompiledManagedAgentPolicy } from '../security/managed-agent-policy.js'

/** Generate a dependency-light Pi extension inside the private runtime dir.
 * The extension replaces Pi's built-ins: every file path is resolved beneath
 * the verified workspace and Bash is reduced to the capability-scoped
 * `shennian room|manager` CLI. This is defense in depth, not an OS sandbox. */
export function writePiManagedExtension(input: {
  outputPath: string
  policy: CompiledManagedAgentPolicy
  allowRoomControl: boolean
  allowManagerControl: boolean
  allowHostShell: boolean
}): string {
  // Canonicalize once before serializing the root. On macOS, for example,
  // os.tmpdir() may be spelled through /var while realpath resolves /private/var;
  // comparing a canonical candidate against a lexical root would reject safe files.
  const root = fs.realpathSync(path.resolve(input.policy.adapterPolicy.workDir))
  const writable = input.policy.adapterPolicy.fileAccess !== 'workspace-read'
  const allowRoom = input.allowRoomControl
  const allowManager = input.allowManagerControl
  const allowHostShell = input.allowHostShell
  const source = `
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Type } from 'typebox';

const ROOT = ${JSON.stringify(root)};
const WRITABLE = ${JSON.stringify(writable)};
const ALLOW_ROOM = ${JSON.stringify(allowRoom)};
const ALLOW_MANAGER = ${JSON.stringify(allowManager)};
const ALLOW_HOST_SHELL = ${JSON.stringify(allowHostShell)};
const MAX_READ = 1024 * 1024;
const MAX_WRITE = 4 * 1024 * 1024;
const SENSITIVE_NAMES = new Set(['.ssh', '.aws', '.config', '.shennian']);
function sensitive(candidate) {
  const parts = String(candidate).split(/[\\\\/]+/).filter(Boolean).map(part => part.toLowerCase());
  if (parts.some(part => part === '.env' || part.startsWith('.env.') || SENSITIVE_NAMES.has(part))) return true;
  const joined = '/' + parts.join('/') + '/';
  return joined.includes('/library/keychains/') || joined.includes('/appdata/roaming/microsoft/credentials/');
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
function rejectSensitive(candidate) {
  if (sensitive(candidate)) throw new Error('managed_path_sensitive');
}
function resolveExisting(raw) {
  const candidate = path.resolve(ROOT, String(raw || '.'));
  rejectSensitive(candidate);
  const real = fs.realpathSync(candidate);
  if (!inside(ROOT, real)) throw new Error('managed_path_outside_workspace');
  const stat = fs.lstatSync(real);
  if (stat.isFile() && stat.nlink > 1) throw new Error('managed_path_link_rejected');
  return real;
}
function resolveWrite(raw) {
  if (!WRITABLE) throw new Error('managed_workspace_read_only');
  const candidate = path.resolve(ROOT, String(raw || ''));
  rejectSensitive(candidate);
  const parent = fs.realpathSync(path.dirname(candidate));
  if (!inside(ROOT, parent)) throw new Error('managed_path_outside_workspace');
  if (fs.existsSync(candidate)) {
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1)) throw new Error('managed_path_link_rejected');
    const real = fs.realpathSync(candidate);
    if (!inside(ROOT, real)) throw new Error('managed_path_outside_workspace');
  }
  return candidate;
}
function textResult(text) { return { content: [{ type: 'text', text }], details: {} }; }
function tokenize(command) {
  const result = []; let current = ''; let quote = '';
  for (const ch of String(command || '')) {
    if (quote) { if (ch === quote) quote = ''; else current += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (/\\s/.test(ch)) { if (current) { result.push(current); current = ''; } continue; }
    if (';&|><$()\\n\\r'.includes(ch) || ch.charCodeAt(0) === 96) throw new Error('managed_shell_syntax_rejected');
    current += ch;
  }
  if (quote) throw new Error('managed_shell_quote_unterminated');
  if (current) result.push(current);
  return result;
}
function commandAllowed(argv) {
  if (argv[0] !== 'shennian') return false;
  if (ALLOW_ROOM && argv[1] === 'room') {
    return ['status', 'read', 'send', 'pause', 'schedule'].includes(argv[2]) ||
      (argv[2] === 'attachment' && argv[3] === 'get');
  }
  if (ALLOW_MANAGER && argv[1] === 'manager') {
    if (argv[2] === 'memory') return argv[3] === 'path';
    if (argv[2] !== 'sessions') return false;
    if (['list', 'start', 'send', 'stop', 'read'].includes(argv[3])) return true;
    return argv[3] === 'queue' && ['list', 'edit', 'delete'].includes(argv[4]);
  }
  return false;
}

export default function (pi) {
  pi.registerTool({ name: 'read', label: 'Read', description: 'Read a file inside the authorized workspace.', parameters: Type.Object({ path: Type.String(), offset: Type.Optional(Type.Number()), limit: Type.Optional(Type.Number()) }), async execute(_id, p) {
    const file = resolveExisting(p.path); const stat = fs.statSync(file); if (!stat.isFile() || stat.size > MAX_READ) throw new Error('managed_read_size_rejected');
    const lines = fs.readFileSync(file, 'utf8').split(/\\r?\\n/); const offset = Math.max(1, Math.floor(p.offset || 1)); const limit = Math.min(2000, Math.max(1, Math.floor(p.limit || 2000)));
    return textResult(lines.slice(offset - 1, offset - 1 + limit).join('\\n'));
  }});
  pi.registerTool({ name: 'ls', label: 'List', description: 'List a directory inside the authorized workspace.', parameters: Type.Object({ path: Type.Optional(Type.String()) }), async execute(_id, p) {
    const dir = resolveExisting(p.path || '.'); return textResult(fs.readdirSync(dir, { withFileTypes: true }).filter(e => !sensitive(path.join(dir, e.name))).slice(0, 1000).map(e => e.name + (e.isDirectory() ? '/' : '')).join('\\n'));
  }});
  pi.registerTool({ name: 'find', label: 'Find', description: 'Find file names inside the authorized workspace.', parameters: Type.Object({ pattern: Type.String(), path: Type.Optional(Type.String()) }), async execute(_id, p) {
    const base = resolveExisting(p.path || '.'); const needle = String(p.pattern).toLowerCase(); const out = []; const queue = [base];
    while (queue.length && out.length < 1000) { const dir = queue.shift(); for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, e.name); if (sensitive(full) || e.isSymbolicLink()) continue; const stat = fs.lstatSync(full); if (stat.isFile() && stat.nlink > 1) continue; if (e.name.toLowerCase().includes(needle)) out.push(path.relative(ROOT, full)); if (e.isDirectory()) queue.push(full); } }
    return textResult(out.join('\\n'));
  }});
  pi.registerTool({ name: 'grep', label: 'Grep', description: 'Search text files inside the authorized workspace.', parameters: Type.Object({ pattern: Type.String(), path: Type.Optional(Type.String()) }), async execute(_id, p) {
    const base = resolveExisting(p.path || '.'); const regex = new RegExp(String(p.pattern), 'i'); const out = []; const queue = [base];
    while (queue.length && out.length < 1000) { const next = queue.shift(); const stat = fs.statSync(next); if (stat.isDirectory()) { for (const e of fs.readdirSync(next, { withFileTypes: true })) { const full = path.join(next, e.name); if (!sensitive(full) && !e.isSymbolicLink()) queue.push(full); } continue; } if (!stat.isFile() || stat.nlink > 1 || stat.size > MAX_READ) continue; const lines = fs.readFileSync(next, 'utf8').split(/\\r?\\n/); lines.forEach((line, i) => { if (out.length < 1000 && regex.test(line)) out.push(path.relative(ROOT, next) + ':' + (i + 1) + ':' + line); }); }
    return textResult(out.join('\\n'));
  }});
  pi.registerTool({ name: 'write', label: 'Write', description: 'Write a file inside the authorized workspace.', parameters: Type.Object({ path: Type.String(), content: Type.String() }), async execute(_id, p) {
    if (Buffer.byteLength(p.content, 'utf8') > MAX_WRITE) throw new Error('managed_write_size_rejected'); const file = resolveWrite(p.path); fs.writeFileSync(file, p.content, { encoding: 'utf8', flag: 'w' }); return textResult('Wrote ' + path.relative(ROOT, file));
  }});
  pi.registerTool({ name: 'edit', label: 'Edit', description: 'Replace exact text inside an authorized workspace file.', parameters: Type.Object({ path: Type.String(), oldText: Type.String(), newText: Type.String() }), async execute(_id, p) {
    const file = resolveWrite(p.path); const current = fs.readFileSync(file, 'utf8'); if (!p.oldText || !current.includes(p.oldText)) throw new Error('managed_edit_target_not_found'); const next = current.replace(p.oldText, p.newText); if (Buffer.byteLength(next, 'utf8') > MAX_WRITE) throw new Error('managed_write_size_rejected'); fs.writeFileSync(file, next, { encoding: 'utf8', flag: 'w' }); return textResult('Edited ' + path.relative(ROOT, file));
  }});
  pi.registerTool({ name: 'bash', label: 'Shennian control', description: 'Run only capability-scoped shennian room or manager commands. General shell commands are unavailable.', parameters: Type.Object({ command: Type.String() }), async execute(_id, p, signal) {
    const argv = tokenize(p.command); if (!ALLOW_HOST_SHELL && !commandAllowed(argv)) throw new Error('managed_shell_command_rejected');
    return await new Promise((resolve, reject) => { const child = ALLOW_HOST_SHELL ? spawn(String(p.command), [], { cwd: ROOT, shell: true, env: process.env, windowsHide: true }) : spawn('shennian', argv.slice(1), { cwd: ROOT, shell: false, env: process.env, windowsHide: true }); let output = ''; const add = c => { output = (output + String(c)).slice(0, 256 * 1024); }; child.stdout.on('data', add); child.stderr.on('data', add); signal?.addEventListener('abort', () => child.kill('SIGTERM'), { once: true }); child.once('error', reject); child.once('close', code => resolve(textResult(output + '\\n[exit ' + code + ']'))); });
  }});
}
`.trimStart()
  fs.mkdirSync(path.dirname(input.outputPath), { recursive: true, mode: 0o700 })
  fs.writeFileSync(input.outputPath, source, { encoding: 'utf8', mode: 0o600 })
  if (process.platform !== 'win32') fs.chmodSync(input.outputPath, 0o600)
  return input.outputPath
}
