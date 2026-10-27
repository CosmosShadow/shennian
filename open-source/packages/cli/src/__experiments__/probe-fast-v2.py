#!/usr/bin/env python3
"""
Fast /model probing v2 - all three approaches compared:
  A) PTY /model (event-driven, minimal waits)
  B) Source code parsing (instant, no process spawn)
  C) Config + API call
"""
import pexpect
import subprocess
import json
import sys
import re
import os
import time
import glob

def strip_ansi(text):
    return re.sub(r'\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][A-Za-z0-9]|\r', '', text)

def clean(text):
    return re.sub(r'[\x00-\x09\x0b-\x1f\x7f]', ' ', strip_ansi(text))

HOME = os.path.expanduser('~')

# ═══════════════════════════════════════════════════════════════════════
# CLAUDE
# ═══════════════════════════════════════════════════════════════════════

def claude_pty():
    """Method A: PTY with --bare --dangerously-skip-permissions"""
    start = time.time()
    child = pexpect.spawn('claude', ['--bare', '--dangerously-skip-permissions'],
                         timeout=15, encoding='utf-8', dimensions=(40, 200), cwd='/tmp')
    
    buf = ""
    try:
        # Wait for prompt
        child.expect([r'Tips', r'What can', r'[>❯]'], timeout=8)
        buf += (child.before or "") + (child.after or "")
        
        # Send /model as one string then enter
        child.send('/model\r')
        
        # Wait for model picker
        child.expect([r'Select model', r'recommended', r'Sonnet', r'Opus'], timeout=8)
        buf += (child.before or "") + (child.after or "")
        
        # Let TUI render completely
        time.sleep(0.8)
        try:
            buf += child.read_nonblocking(size=100000, timeout=1)
        except: pass
    except Exception as e:
        buf += f"\nERROR: {e}"
    finally:
        child.sendline('\x03')
        try: child.close(force=True)
        except: pass
    
    elapsed = time.time() - start
    cleaned = clean(buf)
    
    # Parse model lines
    models = []
    for line in cleaned.split('\n'):
        s = line.strip()
        if not s: continue
        for kw in ['Default', 'Sonnet', 'Opus', 'Haiku']:
            if kw in s and ('(' in s or 'recommended' in s.lower() or 'capable' in s.lower() or 'context' in s.lower()):
                models.append(s[:150])
                break
    
    return {'method': 'PTY /model', 'time': elapsed, 'models': models, 'raw_len': len(cleaned)}

def claude_source_parse():
    """Method B: Parse cli.js for model definitions"""
    start = time.time()
    
    # Find cli.js
    nvm_base = os.path.join(HOME, '.nvm/versions/node')
    cli_paths = glob.glob(f'{nvm_base}/*/lib/node_modules/@anthropic-ai/claude-code/cli.js')
    if not cli_paths:
        return {'method': 'Source parse cli.js', 'time': time.time()-start, 'models': [], 'error': 'cli.js not found'}
    
    cli_js = cli_paths[-1]  # latest version
    content = open(cli_js, 'r', encoding='utf-8', errors='ignore').read()
    
    # Pattern 1: model alias objects like {name: "sonnet", ...}
    models = []
    
    # Find model-related patterns
    # Claude CLI uses patterns like: {alias: "sonnet", model: "claude-sonnet-4-6", ...}
    # or selectableModels array
    
    # Try to find the model picker data
    # Look for patterns like: "sonnet-4-6" or "opus-4" or "haiku"
    model_pattern = re.compile(r'claude-(?:sonnet|opus|haiku)-[\w.-]+')
    found = set(model_pattern.findall(content))
    
    # Also look for alias definitions
    alias_pattern = re.compile(r'"(sonnet|opus|haiku|default)"')
    aliases = set(alias_pattern.findall(content))
    
    # Look for selectableModels or similar array
    selectable_pattern = re.compile(r'(?:selectableModels|modelChoices|modelOptions)\s*[=:]\s*\[([^\]]{10,500})\]')
    selectable_matches = selectable_pattern.findall(content)
    
    for m in sorted(found):
        models.append(m)
    
    elapsed = time.time() - start
    return {'method': 'Source parse cli.js', 'time': elapsed, 'models': models, 'aliases': sorted(aliases)}

def claude_source_deep():
    """Method B2: Deeper source parse - find the actual model picker entries"""
    start = time.time()
    
    nvm_base = os.path.join(HOME, '.nvm/versions/node')
    cli_paths = glob.glob(f'{nvm_base}/*/lib/node_modules/@anthropic-ai/claude-code/cli.js')
    if not cli_paths:
        return {'method': 'Source deep parse', 'time': time.time()-start, 'models': [], 'error': 'cli.js not found'}
    
    cli_js = cli_paths[-1]
    
    # Use grep to find relevant sections quickly
    result = subprocess.run(
        ['grep', '-n', '-o', '.\\{0,80\\}selectableModel.\\{0,80\\}', cli_js],
        capture_output=True, text=True, timeout=5
    )
    selectable = result.stdout.strip()
    
    result2 = subprocess.run(
        ['grep', '-n', '-o', '.\\{0,80\\}modelPicker.\\{0,80\\}', cli_js],
        capture_output=True, text=True, timeout=5
    )
    picker = result2.stdout.strip()
    
    result3 = subprocess.run(
        ['grep', '-n', '-o', '.\\{0,80\\}model.*sonnet.\\{0,80\\}', cli_js],
        capture_output=True, text=True, timeout=5
    )
    sonnet_ctx = result3.stdout.strip()[:2000]
    
    result4 = subprocess.run(
        ['grep', '-c', 'claude-sonnet', cli_js],
        capture_output=True, text=True, timeout=5
    )
    
    elapsed = time.time() - start
    return {
        'method': 'Source deep grep',
        'time': elapsed,
        'selectable_hits': len(selectable.split('\n')) if selectable else 0,
        'picker_hits': len(picker.split('\n')) if picker else 0,
        'sonnet_count': result4.stdout.strip(),
        'sample_selectable': selectable[:500] if selectable else 'none',
        'sample_picker': picker[:500] if picker else 'none',
        'sample_sonnet': sonnet_ctx[:500] if sonnet_ctx else 'none',
    }

# ═══════════════════════════════════════════════════════════════════════
# CODEX
# ═══════════════════════════════════════════════════════════════════════

def codex_pty():
    """Method A: PTY /model"""
    start = time.time()
    env = {**os.environ, 'TERM': 'xterm-256color'}
    child = pexpect.spawn('codex', [], timeout=15, encoding='utf-8',
                         dimensions=(40, 200), cwd='/tmp', env=env)
    
    buf = ""
    try:
        child.expect([r'trust', r'/model', r'>'], timeout=8)
        buf += (child.before or "") + (child.after or "")
        
        if 'trust' in buf.lower():
            child.send('\r')
            child.expect([r'/model', r'>'], timeout=5)
            buf += (child.before or "") + (child.after or "")
        
        child.send('/model\r')
        
        child.expect([r'Select Model', r'gpt-5', r'codex', r'Press enter'], timeout=8)
        buf += (child.before or "") + (child.after or "")
        
        time.sleep(0.8)
        try:
            buf += child.read_nonblocking(size=100000, timeout=1)
        except: pass
    except Exception as e:
        buf += f"\nERROR: {e}"
    finally:
        child.sendline('\x03')
        try: child.close(force=True)
        except: pass
    
    elapsed = time.time() - start
    cleaned = clean(buf)
    
    models = []
    for line in cleaned.split('\n'):
        s = line.strip()
        if not s: continue
        if re.search(r'gpt-5|codex|frontier|agentic', s, re.I):
            models.append(s[:150])
    
    return {'method': 'PTY /model', 'time': elapsed, 'models': models, 'raw_len': len(cleaned)}

def codex_config_api():
    """Method C: Read config + call API"""
    start = time.time()
    
    config_path = os.path.join(HOME, '.codex/config.toml')
    auth_path = os.path.join(HOME, '.codex/auth.json')
    
    if not os.path.exists(config_path) or not os.path.exists(auth_path):
        return {'method': 'Config+API', 'time': time.time()-start, 'models': [], 'error': 'Config not found'}
    
    config = open(config_path).read()
    auth = json.loads(open(auth_path).read())
    
    base_url_match = re.search(r'base_url\s*=\s*"([^"]+)"', config)
    base_url = base_url_match.group(1) if base_url_match else 'https://api.openai.com/v1'
    api_key = auth.get('OPENAI_API_KEY', '')
    
    if not api_key:
        return {'method': 'Config+API', 'time': time.time()-start, 'models': [], 'error': 'No API key'}
    
    result = subprocess.run(
        ['curl', '-s', '-H', f'Authorization: Bearer {api_key}', f'{base_url}/models'],
        capture_output=True, text=True, timeout=10
    )
    
    data = json.loads(result.stdout)
    models = [m['id'] for m in data.get('data', [])]
    
    elapsed = time.time() - start
    return {'method': 'Config+API', 'time': elapsed, 'models': sorted(models)}

def codex_binary_help():
    """Method D: Check if codex has a model list flag"""
    start = time.time()
    result = subprocess.run(['codex', '--help'], capture_output=True, text=True, timeout=5)
    elapsed = time.time() - start
    
    model_lines = [l for l in result.stdout.split('\n') if 'model' in l.lower()]
    return {'method': 'codex --help', 'time': elapsed, 'model_related': model_lines}

# ═══════════════════════════════════════════════════════════════════════
# GEMINI
# ═══════════════════════════════════════════════════════════════════════

def gemini_pty():
    """Method A: PTY /model"""
    start = time.time()
    env = {**os.environ, 'TERM': 'xterm-256color'}
    child = pexpect.spawn('gemini', [], timeout=15, encoding='utf-8',
                         dimensions=(40, 200), cwd='/tmp', env=env)
    
    buf = ""
    try:
        idx = child.expect([r'[Tt]rust', r'[>❯]'], timeout=10)
        buf += (child.before or "") + (child.after or "")
        
        if idx == 0:
            child.send('\r')
            child.expect([r'[>❯]'], timeout=8)
            buf += (child.before or "") + (child.after or "")
        
        child.send('/model\r')
        
        child.expect([r'Select Model', r'Auto', r'Gemini', r'Flash', r'Pro'], timeout=8)
        buf += (child.before or "") + (child.after or "")
        
        time.sleep(0.8)
        try:
            buf += child.read_nonblocking(size=100000, timeout=1)
        except: pass
    except Exception as e:
        buf += f"\nERROR: {e}"
    finally:
        child.sendline('\x03')
        try: child.close(force=True)
        except: pass
    
    elapsed = time.time() - start
    cleaned = clean(buf)
    
    models = []
    for line in cleaned.split('\n'):
        s = line.strip()
        if not s: continue
        if re.search(r'gemini|flash|pro|auto|model', s, re.I) and len(s) > 5:
            models.append(s[:150])
    
    return {'method': 'PTY /model', 'time': elapsed, 'models': models, 'raw_len': len(cleaned)}

def gemini_source_parse():
    """Method B: Parse models.js"""
    start = time.time()
    
    nvm_base = os.path.join(HOME, '.nvm/versions/node')
    model_paths = glob.glob(f'{nvm_base}/*/lib/node_modules/@google/gemini-cli/node_modules/@google/gemini-cli-core/dist/src/config/models.js')
    if not model_paths:
        return {'method': 'Source parse models.js', 'time': time.time()-start, 'models': [], 'error': 'models.js not found'}
    
    content = open(model_paths[-1], 'r').read()
    
    # Extract model IDs
    model_pattern = re.compile(r'"(gemini-[\w.-]+)"')
    models = sorted(set(model_pattern.findall(content)))
    
    elapsed = time.time() - start
    return {'method': 'Source parse models.js', 'time': elapsed, 'models': models}


def pp(label, result):
    print(f"\n{'─'*60}")
    print(f"  {label}")
    print(f"{'─'*60}")
    for k, v in result.items():
        if k == 'models' and isinstance(v, list):
            print(f"  {k}: ({len(v)} items)")
            for m in v[:15]:
                print(f"    - {m}")
            if len(v) > 15:
                print(f"    ... +{len(v)-15} more")
        else:
            val = str(v)
            if len(val) > 200: val = val[:200] + '...'
            print(f"  {k}: {val}")


if __name__ == '__main__':
    target = sys.argv[1] if len(sys.argv) > 1 else 'all'

    if target in ('claude', 'all'):
        print("\n" + "="*60)
        print("  CLAUDE PROBING")
        print("="*60)
        pp("B) Source parse cli.js (instant)", claude_source_parse())
        pp("B2) Source deep grep", claude_source_deep())
        pp("A) PTY /model (--bare)", claude_pty())

    if target in ('codex', 'all'):
        print("\n" + "="*60)
        print("  CODEX PROBING")
        print("="*60)
        pp("D) codex --help", codex_binary_help())
        pp("C) Config + API", codex_config_api())
        pp("A) PTY /model", codex_pty())

    if target in ('gemini', 'all'):
        print("\n" + "="*60)
        print("  GEMINI PROBING")
        print("="*60)
        pp("B) Source parse models.js (instant)", gemini_source_parse())
        pp("A) PTY /model", gemini_pty())
