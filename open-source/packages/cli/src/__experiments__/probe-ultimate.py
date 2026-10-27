#!/usr/bin/env python3
"""
Ultimate model probe experiment.

Tests 3 strategies:
  1. Cold start PTY: spawn CLI, send /model (simulates first-time probe)
  2. Warm PTY: CLI already running, send /model (simulates in-session probe)
  3. Non-PTY: source parse / API / direct command (fastest possible)

Each strategy is timed independently.
"""
import pexpect
import subprocess
import json
import re
import os
import time
import glob

HOME = os.path.expanduser('~')

def strip_ansi(t):
    return re.sub(r'\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][A-Za-z0-9]|\r', '', t)

def clean(t):
    return re.sub(r'[\x00-\x09\x0b-\x1f\x7f]', ' ', strip_ansi(t))

def parse_model_lines(text, keywords):
    models = []
    for line in text.split('\n'):
        s = line.strip()
        if not s or len(s) < 3:
            continue
        for kw in keywords:
            if kw.lower() in s.lower():
                models.append(s[:150])
                break
    return models


# ═══════════════════════════════════════════════════════════════════
# CLAUDE
# ═══════════════════════════════════════════════════════════════════

def claude_source():
    """Parse cli.js for the /model picker data (aliases + model IDs)"""
    start = time.time()
    
    nvm_base = os.path.join(HOME, '.nvm/versions/node')
    paths = glob.glob(f'{nvm_base}/*/lib/node_modules/@anthropic-ai/claude-code/cli.js')
    if not paths:
        return {'error': 'cli.js not found'}
    
    content = open(paths[-1], 'r', errors='ignore').read()
    
    result = {}
    
    # 1) Aliases for /model picker
    m = re.search(r'rL9=\["([^"]+)"(?:,"([^"]+)")*\]', content)
    if m:
        # Get full match and extract
        full = re.search(r'rL9=\[([^\]]+)\]', content)
        if full:
            result['picker_aliases'] = re.findall(r'"([^"]+)"', full.group(1))
    
    # 2) All model aliases  
    m2 = re.search(r'rY6=\[([^\]]+)\]', content)
    if m2:
        result['all_aliases'] = re.findall(r'"([^"]+)"', m2.group(1))
    
    # 3) Model catalog (alias -> model ID per provider)
    catalog = {}
    # Find the object: {haiku35:VP1, sonnet46:SP1, ...}
    # Then find each constant: SP1={firstParty:"claude-sonnet-4-6",...}
    catalog_match = re.search(r'\{(haiku\d+:\w+.*?opus\d+:\w+)\}', content)
    if catalog_match:
        entries = re.findall(r'(\w+):(\w+)', catalog_match.group(1))
        for name, var in entries:
            # Find the variable definition: VAR={firstParty:"...", ...}
            var_match = re.search(rf'{var}=\{{firstParty:"([^"]+)"', content)
            if var_match:
                catalog[name] = var_match.group(1)
    
    result['catalog'] = catalog
    result['time'] = time.time() - start
    return result

def claude_cold_pty():
    """Cold start: spawn claude --bare, send /model"""
    start = time.time()
    child = pexpect.spawn('claude', ['--bare', '--dangerously-skip-permissions'],
                         timeout=15, encoding='utf-8', dimensions=(40, 200), cwd='/tmp')
    
    buf = ""
    startup = None
    try:
        child.expect([r'Tips', r'What can', r'[>❯]'], timeout=8)
        buf += (child.before or "") + (child.after or "")
        startup = time.time() - start
    except:
        startup = time.time() - start
    
    model_start = time.time()
    child.send('/model\r')
    
    try:
        child.expect([r'Select model', r'recommended', r'Sonnet', r'Opus'], timeout=8)
        buf += (child.before or "") + (child.after or "")
    except:
        pass
    
    time.sleep(0.8)
    try:
        buf += child.read_nonblocking(size=100000, timeout=0.5)
    except: pass
    
    model_time = time.time() - model_start
    total = time.time() - start
    
    child.send('\x1b')
    time.sleep(0.1)
    child.send('\x03')
    try: child.close(force=True)
    except: pass
    
    cleaned = clean(buf)
    return {
        'startup': startup,
        'model_cmd': model_time,
        'total': total,
        'lines': parse_model_lines(cleaned, ['Sonnet', 'Opus', 'Haiku', 'Default', 'Select', 'recommended', 'context', 'capable'])
    }

def claude_warm_pty():
    """Warm: CLI already running, measure only /model command time"""
    child = pexpect.spawn('claude', ['--bare', '--dangerously-skip-permissions'],
                         timeout=15, encoding='utf-8', dimensions=(40, 200), cwd='/tmp')
    
    # Wait for full startup
    try:
        child.expect([r'Tips', r'What can', r'[>❯]'], timeout=10)
    except:
        pass
    time.sleep(0.5)  # ensure fully ready
    
    # --- Now measure ONLY the /model command ---
    start = time.time()
    child.send('/model\r')
    
    buf = ""
    try:
        child.expect([r'Select model', r'recommended', r'Sonnet', r'Opus'], timeout=5)
        buf += (child.before or "") + (child.after or "")
    except:
        pass
    
    time.sleep(0.5)
    try:
        buf += child.read_nonblocking(size=100000, timeout=0.3)
    except: pass
    
    elapsed = time.time() - start
    
    child.send('\x1b')
    time.sleep(0.1)
    child.send('\x03')
    try: child.close(force=True)
    except: pass
    
    cleaned = clean(buf)
    return {
        'model_cmd_only': elapsed,
        'lines': parse_model_lines(cleaned, ['Sonnet', 'Opus', 'Haiku', 'Default', 'Select', 'recommended', 'context', 'capable'])
    }


# ═══════════════════════════════════════════════════════════════════
# CODEX
# ═══════════════════════════════════════════════════════════════════

def codex_api():
    """Read config + call API"""
    start = time.time()
    config = open(os.path.join(HOME, '.codex/config.toml')).read()
    auth = json.loads(open(os.path.join(HOME, '.codex/auth.json')).read())
    
    base_url_m = re.search(r'base_url\s*=\s*"([^"]+)"', config)
    base_url = base_url_m.group(1) if base_url_m else 'https://api.openai.com/v1'
    api_key = auth.get('OPENAI_API_KEY', '')
    
    res = subprocess.run(
        ['curl', '-s', '-m', '5', '-H', f'Authorization: Bearer {api_key}', f'{base_url}/models'],
        capture_output=True, text=True, timeout=10
    )
    data = json.loads(res.stdout)
    models = sorted([m['id'] for m in data.get('data', [])])
    
    return {'time': time.time() - start, 'models': models}

def codex_warm_pty():
    """Warm: Codex already running, measure /model only"""
    env = {**os.environ, 'TERM': 'xterm-256color'}
    child = pexpect.spawn('codex', [], timeout=20, encoding='utf-8',
                         dimensions=(40, 200), cwd='/private/tmp', env=env)
    
    # Wait for full startup (we know this is slow)
    time.sleep(5.0)
    # Try to read and discard startup output
    try:
        child.read_nonblocking(size=100000, timeout=1)
    except: pass
    
    # --- Now measure ONLY /model ---
    start = time.time()
    child.send('/model\r')
    
    buf = ""
    try:
        idx = child.expect([r'Select Model', r'gpt-5', r'enter'], timeout=8)
        buf += (child.before or "") + (child.after or "")
    except:
        pass
    
    time.sleep(1.0)
    try:
        buf += child.read_nonblocking(size=100000, timeout=0.5)
    except: pass
    
    elapsed = time.time() - start
    
    child.send('\x1b')
    time.sleep(0.1)
    child.sendline('\x03')
    try: child.close(force=True)
    except: pass
    
    cleaned = clean(buf)
    return {
        'model_cmd_only': elapsed,
        'lines': parse_model_lines(cleaned, ['gpt-5', 'codex', 'frontier', 'agentic', 'Select'])
    }


# ═══════════════════════════════════════════════════════════════════
# GEMINI
# ═══════════════════════════════════════════════════════════════════

def gemini_source():
    """Parse models.js"""
    start = time.time()
    
    nvm_base = os.path.join(HOME, '.nvm/versions/node')
    paths = glob.glob(f'{nvm_base}/*/lib/node_modules/@google/gemini-cli/node_modules/@google/gemini-cli-core/dist/src/config/models.js')
    if not paths:
        return {'error': 'models.js not found'}
    
    content = open(paths[-1], 'r').read()
    
    # Models defined as export const ... = 'model-id'
    model_ids = re.findall(r"=\s*'(gemini-[^']+)'", content)
    
    # Aliases
    aliases = re.findall(r"GEMINI_MODEL_ALIAS_\w+\s*=\s*'([^']+)'", content)
    
    # Valid models set
    valid_members = re.findall(r'VALID_GEMINI_MODELS.*?(?=\];)', content, re.DOTALL)
    
    return {
        'time': time.time() - start,
        'model_ids': sorted(set(model_ids)),
        'aliases': aliases,
    }

def gemini_warm_pty():
    """Warm: Gemini already running, measure /model only"""
    env = {**os.environ, 'TERM': 'xterm-256color'}
    child = pexpect.spawn('gemini', [], timeout=20, encoding='utf-8',
                         dimensions=(40, 200), cwd='/tmp', env=env)
    
    # Handle trust prompt
    buf = ""
    try:
        idx = child.expect([r'[Tt]rust', r'[>❯✦]', r'Gemini'], timeout=10)
        buf += (child.before or "") + (child.after or "")
        if idx == 0:
            child.send('Y')
            time.sleep(0.3)
            child.send('\r')
            try:
                child.expect([r'[>❯✦]', r'Gemini'], timeout=8)
                buf += (child.before or "") + (child.after or "")
            except:
                pass
    except:
        pass
    
    time.sleep(1.0)  # ensure ready
    try:
        child.read_nonblocking(size=100000, timeout=0.5)
    except: pass
    
    # --- Now measure /model ---
    start = time.time()
    child.send('/model\r')
    
    mbuf = ""
    try:
        child.expect([r'Select', r'Auto', r'Gemini', r'Flash', r'Pro'], timeout=5)
        mbuf += (child.before or "") + (child.after or "")
    except:
        pass
    
    time.sleep(0.8)
    try:
        mbuf += child.read_nonblocking(size=100000, timeout=0.5)
    except: pass
    
    elapsed = time.time() - start
    
    child.send('\x1b')
    time.sleep(0.1)
    child.send('\x03')
    try: child.close(force=True)
    except: pass
    
    cleaned = clean(buf + mbuf)
    return {
        'model_cmd_only': elapsed,
        'lines': parse_model_lines(cleaned, ['Gemini', 'Flash', 'Pro', 'Auto', 'Select', 'model'])
    }


# ═══════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════

def pp(label, result):
    print(f"\n  {'─'*50}")
    print(f"  {label}")
    print(f"  {'─'*50}")
    for k, v in result.items():
        if isinstance(v, list):
            print(f"    {k}: ({len(v)} items)")
            for item in v[:10]:
                print(f"      - {item}")
            if len(v) > 10:
                print(f"      ... +{len(v)-10} more")
        elif isinstance(v, dict):
            print(f"    {k}:")
            for dk, dv in list(v.items())[:10]:
                print(f"      {dk}: {dv}")
        else:
            print(f"    {k}: {v}")

import sys
target = sys.argv[1] if len(sys.argv) > 1 else 'all'

if target in ('claude', 'all'):
    print("\n" + "═"*60)
    print("  CLAUDE")
    print("═"*60)
    pp("Source parse (instant)", claude_source())
    pp("Cold PTY (spawn + /model)", claude_cold_pty())
    pp("Warm PTY (/model only)", claude_warm_pty())

if target in ('codex', 'all'):
    print("\n" + "═"*60)
    print("  CODEX")
    print("═"*60)
    pp("Config + API", codex_api())
    pp("Warm PTY (/model only)", codex_warm_pty())

if target in ('gemini', 'all'):
    print("\n" + "═"*60)
    print("  GEMINI")
    print("═"*60)
    pp("Source parse (instant)", gemini_source())
    pp("Warm PTY (/model only)", gemini_warm_pty())
