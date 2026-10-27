#!/usr/bin/env python3
"""
Robust PTY model probing for Claude, Codex, Gemini.
Goal: reliably extract the EXACT model list shown by /model command.

Strategy:
  1. Spawn CLI with fast-start flags where available
  2. Handle trust prompts
  3. Send /model
  4. Parse TUI output with robust ANSI stripping
  5. Extract structured model data
"""
import pexpect
import sys
import re
import os
import time
import json

# ═══════════════════════════════════════════════════════════════════
# Utilities
# ═══════════════════════════════════════════════════════════════════

def strip_ansi(text: str) -> str:
    """Remove all ANSI escape sequences."""
    text = re.sub(r'\x1b\[[0-9;?]*[a-zA-Z]', '', text)
    text = re.sub(r'\x1b\][^\x07]*\x07', '', text)
    text = re.sub(r'\x1b[()][A-Za-z0-9]', '', text)
    text = re.sub(r'\x1b[>=<]', '', text)
    text = re.sub(r'\x1b\[\??\w+', '', text)
    text = re.sub(r'\r', '', text)
    return text

def clean_text(text: str) -> str:
    """Strip ANSI + control chars, normalize whitespace."""
    text = strip_ansi(text)
    text = re.sub(r'[\x00-\x09\x0b-\x1f\x7f]', ' ', text)
    # Collapse multiple spaces
    text = re.sub(r' {2,}', ' ', text)
    return text

def collect_output(child, timeout=1.0):
    """Read all available output from the child process."""
    buf = ""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            chunk = child.read_nonblocking(size=65536, timeout=0.2)
            buf += chunk
        except pexpect.TIMEOUT:
            break
        except pexpect.EOF:
            break
    return buf


# ═══════════════════════════════════════════════════════════════════
# CLAUDE
# ═══════════════════════════════════════════════════════════════════

def probe_claude():
    print("=" * 60)
    print("  CLAUDE PTY PROBE")
    print("=" * 60)
    
    start = time.time()
    
    # --bare: skip heavy init (hooks, LSP, plugins, auto-memory, keychain)
    # --dangerously-skip-permissions: skip trust prompt
    child = pexpect.spawn(
        'claude', ['--bare', '--dangerously-skip-permissions'],
        timeout=15, encoding='utf-8',
        dimensions=(50, 200),  # tall + wide for model picker
        cwd='/tmp',
        env={**os.environ, 'TERM': 'xterm-256color', 'NO_COLOR': '1'}
    )
    
    all_output = ""
    
    # Phase 1: Wait for interactive prompt
    t1 = time.time()
    try:
        idx = child.expect([
            r'[>❯]',           # prompt
            r'Tips',            # tips banner
            r'What can',        # welcome text
            r'trust',           # trust prompt (shouldn't happen with flags)
        ], timeout=8)
        all_output += (child.before or "") + (child.after or "")
        
        if idx == 3:  # trust prompt
            child.sendline('')
            child.expect([r'[>❯]', r'Tips', r'What can'], timeout=5)
            all_output += (child.before or "") + (child.after or "")
        
        print(f"  Startup: {time.time()-t1:.2f}s")
    except pexpect.TIMEOUT:
        print(f"  Startup timeout: {time.time()-t1:.2f}s")
        # Continue anyway - might still work
    
    # Phase 2: Send /model command
    t2 = time.time()
    child.send('/model\r')
    
    # Phase 3: Wait for model picker to appear
    try:
        child.expect([r'Select model', r'Sonnet', r'Opus', r'Haiku', r'recommended'], timeout=8)
        all_output += (child.before or "") + (child.after or "")
        print(f"  /model response: {time.time()-t2:.2f}s")
    except pexpect.TIMEOUT:
        print(f"  /model timeout: {time.time()-t2:.2f}s")
    
    # Phase 4: Collect full TUI render
    time.sleep(1.0)
    all_output += collect_output(child, timeout=1.0)
    
    # Send down arrow a few times to reveal all items, then collect
    for _ in range(5):
        child.send('\x1b[B')  # down arrow
        time.sleep(0.15)
    time.sleep(0.5)
    all_output += collect_output(child, timeout=1.0)
    
    total = time.time() - start
    
    # Cleanup
    child.send('\x1b')  # escape
    time.sleep(0.1)
    child.send('\x03')  # ctrl-c
    try:
        child.close(force=True)
    except:
        pass
    
    # Parse
    cleaned = clean_text(all_output)
    models = parse_claude_models(cleaned, all_output)
    
    print(f"  Total: {total:.2f}s")
    print(f"  Raw output length: {len(all_output)} chars")
    print(f"  Models found: {len(models)}")
    for m in models:
        print(f"    - {m['id']} ({m.get('name', '')}) {m.get('description', '')}")
    
    return models, total


def parse_claude_models(cleaned: str, raw: str):
    """Parse Claude's model picker output.
    
    TUI output after ANSI stripping looks like (spaces lost due to cursor positioning):
      1.Default(recommended)Usethedefaultmodel(currentlySonnet4.6)·$3/$15perMtok
      ❯2.Sonnet(1Mcontext)✔Sonnet4.6forlongsessions·$3/$15perMtok
      3.Opus(1Mcontext)Opus4.6with1Mcontext·Mostcapableforcomplexwork
      4.HaikuHaiku4.5·Fastestforquickanswers·$1/$5perMtok
    
    We parse numbered entries and extract alias + version.
    The alias is what users pass to `claude --model <alias>`.
    """
    raw_clean = strip_ansi(raw)
    models = []
    
    # Pattern: numbered list items from the /model picker
    # Match: "N.AliasName" possibly followed by version/context info
    patterns = [
        # "1.Default(recommended)...currentlySonnet4.6..."
        (r'\d+\.Default\(recommended\).*?(?:Sonnet|currently\s*Sonnet)\s*([\d.]+)', 'default', 'Default (recommended)'),
        # "2.Sonnet(1Mcontext)...Sonnet4.6..."
        (r'\d+\.Sonnet.*?Sonnet\s*([\d.]+)', 'sonnet', 'Sonnet'),
        # "3.Opus(1Mcontext)...Opus4.6..."
        (r'\d+\.Opus.*?Opus\s*([\d.]+)', 'opus', 'Opus'),
        # "4.Haiku...Haiku4.5..."
        (r'\d+\.Haiku.*?Haiku\s*([\d.]+)', 'haiku', 'Haiku'),
    ]
    
    for pattern, alias, display_name in patterns:
        m = re.search(pattern, raw_clean, re.IGNORECASE)
        if m:
            version = m.group(1)
            models.append({
                'id': alias,
                'name': display_name,
                'description': f'v{version}',
            })
        else:
            # Fallback: just check if the alias name appears in numbered context
            fallback = re.search(rf'\d+\.{display_name.split()[0]}', raw_clean, re.IGNORECASE)
            if fallback:
                models.append({
                    'id': alias,
                    'name': display_name,
                    'description': '',
                })
    
    return models


# ═══════════════════════════════════════════════════════════════════
# CODEX
# ═══════════════════════════════════════════════════════════════════

def probe_codex():
    print("\n" + "=" * 60)
    print("  CODEX PTY PROBE")
    print("=" * 60)
    
    start = time.time()
    
    env = {**os.environ, 'TERM': 'xterm-256color'}
    child = pexpect.spawn(
        'codex', [],
        timeout=30, encoding='utf-8',
        dimensions=(80, 200),  # must be very tall so all models fit without scrolling
        cwd='/tmp',
        env=env,
    )
    
    all_output = ""
    
    # Phase 1: Wait for ready - Codex is slow to start
    t1 = time.time()
    try:
        idx = child.expect([
            r'trust',           # trust prompt
            r'Codex',           # banner
            r'>_',              # prompt
            r'/model to change',# ready banner text
        ], timeout=12)
        all_output += (child.before or "") + (child.after or "")
        
        if idx == 0:  # trust prompt
            child.sendline('')
            child.expect([r'Codex', r'>_'], timeout=8)
            all_output += (child.before or "") + (child.after or "")
        
        print(f"  Startup: {time.time()-t1:.2f}s")
    except pexpect.TIMEOUT:
        print(f"  Startup timeout: {time.time()-t1:.2f}s")
    
    # Wait for TUI to fully render
    time.sleep(2.0)
    all_output += collect_output(child, timeout=1.0)
    
    # Phase 2: Send /model char by char
    t2 = time.time()
    for c in '/model':
        child.send(c)
        time.sleep(0.1)
    time.sleep(0.3)
    child.send('\r')
    
    # Phase 3: Wait for model selector
    try:
        child.expect([r'Select Model', r'enter to select', r'esc to dismiss'], timeout=10)
        all_output += (child.before or "") + (child.after or "")
        print(f"  /model response: {time.time()-t2:.2f}s")
    except pexpect.TIMEOUT:
        print(f"  /model timeout: {time.time()-t2:.2f}s")
    
    # Phase 4: Collect initial render
    time.sleep(1.5)
    all_output += collect_output(child, timeout=1.0)
    
    # Scroll down one at a time, reading after each scroll
    # TUI overwrites screen, so we need to capture at each position
    for i in range(12):
        child.send('\x1b[B')  # down arrow
        time.sleep(0.3)
        try:
            all_output += child.read_nonblocking(size=65536, timeout=0.3)
        except:
            pass
    
    total = time.time() - start
    
    # Cleanup
    child.send('\x1b')
    time.sleep(0.2)
    child.send('\x03')
    try:
        child.close(force=True)
    except:
        pass
    
    # Parse
    cleaned = clean_text(all_output)
    raw_stripped = strip_ansi(all_output)
    
    models = parse_codex_models(cleaned, all_output)
    
    print(f"  Total: {total:.2f}s")
    print(f"  Raw output length: {len(all_output)} chars")
    print(f"  Models found: {len(models)}")
    for m in models:
        print(f"    - {m['id']} ({m.get('name', '')}) {m.get('description', '')}")
    
    return models, total


def parse_codex_models(cleaned: str, raw: str):
    """Parse Codex's model picker output.
    
    TUI output after ANSI stripping (spaces lost):
      › 1. gpt-5.3-codex (current)  Latest frontier agentic coding model.
      2.gpt-5.4Latest frontier agentic coding model.
      3.gpt-5.2-codexFrontier agentic coding model.
      4.gpt-5.1-codex-maxCodex-optimized flagship for deep and fast reasoning.
      5.gpt-5.2Latest frontier model with improvements...
      6.gpt-5.1-codex-miniOptimized for codex. Cheaper, faster, but less capable.
    
    We parse numbered entries: N. model-id Description
    """
    raw_clean = strip_ansi(raw)
    models = []
    seen = set()
    
    # Locate the "Select Model" section
    select_pos = raw_clean.find('Select Model')
    if select_pos < 0:
        select_pos = 0
    search_zone = raw_clean[select_pos:]
    
    # Step 1: Find all numbered entries "N.gpt-xxx" or "N. gpt-xxx"
    # Extract model ID (lowercase only) and everything after it until next entry
    entries = list(re.finditer(r'(\d+)\.\s*(gpt-[a-z0-9][a-z0-9.-]*)', search_zone))
    
    for i, match in enumerate(entries):
        mid = match.group(2)
        if mid in seen:
            continue
        seen.add(mid)
        
        # Description is between end of this model ID and start of next entry (or "Press enter")
        desc_start = match.end()
        if i + 1 < len(entries):
            desc_end = entries[i + 1].start()
        else:
            press_pos = search_zone.find('Press enter', desc_start)
            desc_end = press_pos if press_pos > 0 else desc_start + 200
        
        desc_raw = search_zone[desc_start:desc_end].strip()
        
        # Remove "(current)" and extract description text
        is_current = '(current)' in desc_raw
        desc_raw = desc_raw.replace('(current)', '').strip()
        
        desc = ""
        desc_match = re.search(r'([A-Z][a-z][^.]*\.)', desc_raw)
        if desc_match:
            desc = desc_match.group(1).strip()
        
        models.append({
            'id': mid,
            'name': mid,
            'description': desc,
            'current': is_current,
        })
    
    # Fallback: if no numbered entries, find all unique gpt-* IDs in the zone
    if not models:
        for m in re.finditer(r'(gpt-[a-z0-9][a-z0-9.-]*)', search_zone):
            mid = m.group(1)
            if mid not in seen:
                seen.add(mid)
                models.append({'id': mid, 'name': mid, 'description': '', 'current': False})
    
    return models


# ═══════════════════════════════════════════════════════════════════
# GEMINI
# ═══════════════════════════════════════════════════════════════════

def probe_gemini():
    """Gemini: parse models.js source file (found via `which gemini`).
    
    Gemini's models.js is readable (not minified) with stable export names.
    This is more reliable than PTY because:
    - No auth needed (Gemini requires Google auth for interactive mode)
    - Cross-platform: uses `which gemini` → follow symlinks → find models.js
    - Instant speed
    - Same data source the CLI itself reads from
    """
    print("\n" + "=" * 60)
    print("  GEMINI (source parse via `which gemini`)")
    print("=" * 60)
    
    start = time.time()
    import subprocess, shutil
    
    # Step 1: Find gemini binary
    gemini_bin = shutil.which('gemini')
    if not gemini_bin:
        print("  ERROR: gemini not found in PATH")
        return [], time.time() - start
    print(f"  Binary: {gemini_bin}")
    
    # Step 2: Follow symlinks to real file
    gemini_real = os.path.realpath(gemini_bin)
    print(f"  Real path: {gemini_real}")
    
    # Step 3: Find models.js relative to package root
    # gemini_real = .../node_modules/@google/gemini-cli/dist/index.js
    # models.js = .../node_modules/@google/gemini-cli/node_modules/@google/gemini-cli-core/dist/src/config/models.js
    pkg_dir = os.path.dirname(os.path.dirname(gemini_real))  # .../gemini-cli/
    models_js = os.path.join(pkg_dir, 'node_modules', '@google', 'gemini-cli-core', 'dist', 'src', 'config', 'models.js')
    
    if not os.path.exists(models_js):
        # Fallback: search in parent node_modules
        parent_nm = os.path.dirname(os.path.dirname(pkg_dir))  # .../node_modules/
        models_js = os.path.join(parent_nm, '@google', 'gemini-cli-core', 'dist', 'src', 'config', 'models.js')
    
    if not os.path.exists(models_js):
        print(f"  ERROR: models.js not found at expected paths")
        return [], time.time() - start
    
    print(f"  models.js: {models_js}")
    
    # Step 4: Parse the file
    content = open(models_js, 'r').read()
    models = parse_gemini_source(content)
    
    total = time.time() - start
    print(f"  Total: {total:.2f}s")
    print(f"  Models found: {len(models)}")
    for m in models:
        print(f"    - {m['id']} ({m.get('name', '')}) {m.get('description', '')}")
    
    return models, total


def parse_gemini_source(content: str):
    """Parse Gemini's models.js for model definitions.
    
    The file has stable exports like:
      export const PREVIEW_GEMINI_MODEL = 'gemini-3-pro-preview';
      export const GEMINI_MODEL_ALIAS_AUTO = 'auto';
      export const VALID_GEMINI_MODELS = new Set([...]);
    """
    models = []
    
    # Extract aliases (what /model picker shows)
    aliases = {}
    for match in re.finditer(r"GEMINI_MODEL_ALIAS_(\w+)\s*=\s*'([^']+)'", content):
        alias_key = match.group(1).lower()  # AUTO, PRO, FLASH, FLASH_LITE
        alias_value = match.group(2)        # auto, pro, flash, flash-lite
        aliases[alias_key] = alias_value
    
    # Extract model ID constants
    model_map = {}
    const_patterns = [
        ('PREVIEW_GEMINI_MODEL', 'preview_pro'),
        ('PREVIEW_GEMINI_3_1_MODEL', 'preview_pro_31'),
        ('PREVIEW_GEMINI_FLASH_MODEL', 'preview_flash'),
        ('PREVIEW_GEMINI_3_1_FLASH_LITE_MODEL', 'preview_flash_lite_31'),
        ('DEFAULT_GEMINI_MODEL', 'default_pro'),
        ('DEFAULT_GEMINI_FLASH_MODEL', 'default_flash'),
        ('DEFAULT_GEMINI_FLASH_LITE_MODEL', 'default_flash_lite'),
    ]
    
    for const_name, key in const_patterns:
        match = re.search(rf"export const {const_name}\s*=\s*'([^']+)'", content)
        if match:
            model_map[key] = match.group(1)
    
    # Build model list: aliases → resolved model IDs
    # The /model picker shows: Auto, Pro, Flash, Flash Lite
    alias_to_model = {
        'auto': model_map.get('preview_pro', ''),
        'pro': model_map.get('preview_pro', model_map.get('default_pro', '')),
        'flash': model_map.get('preview_flash', model_map.get('default_flash', '')),
        'flash_lite': model_map.get('preview_flash_lite_31', model_map.get('default_flash_lite', '')),
    }
    
    for alias_key, alias_name in aliases.items():
        resolved = alias_to_model.get(alias_key, '')
        display = alias_name.replace('-', ' ').title()
        models.append({
            'id': alias_name,
            'name': display,
            'description': f'→ {resolved}' if resolved else '',
        })
    
    # Also list all concrete model IDs for reference
    all_model_ids = re.findall(r"=\s*'(gemini-[^']+)'", content)
    all_model_ids = sorted(set(mid for mid in all_model_ids if 'embedding' not in mid))
    
    for mid in all_model_ids:
        # Don't duplicate models already listed via aliases
        if mid not in [m.get('description', '').replace('→ ', '') for m in models]:
            models.append({
                'id': mid,
                'name': mid,
                'description': 'concrete model ID',
            })
    
    return models


# ═══════════════════════════════════════════════════════════════════
# CURSOR (direct command, not PTY)
# ═══════════════════════════════════════════════════════════════════

def probe_cursor():
    print("\n" + "=" * 60)
    print("  CURSOR (agent --list-models)")
    print("=" * 60)
    
    import subprocess
    start = time.time()
    
    result = subprocess.run(
        ['agent', '--list-models'],
        capture_output=True, text=True, timeout=15
    )
    
    total = time.time() - start
    
    out = strip_ansi(result.stdout)
    models = []
    for line in out.strip().split('\n'):
        line = line.strip()
        if not line or line.startswith('Loading') or line.startswith('Available'):
            continue
        m = re.match(r'^(\S+)\s+-\s+(.+?)(?:\s+\((.+)\))?$', line)
        if m:
            models.append({
                'id': m.group(1),
                'name': m.group(2).strip(),
                'description': m.group(3) or '',
            })
    
    print(f"  Total: {total:.2f}s")
    print(f"  Models found: {len(models)}")
    for m in models[:10]:
        print(f"    - {m['id']} ({m.get('name', '')}) {m.get('description', '')}")
    if len(models) > 10:
        print(f"    ... +{len(models)-10} more")
    
    return models, total


# ═══════════════════════════════════════════════════════════════════
# OPENCLAW (direct command, not PTY)
# ═══════════════════════════════════════════════════════════════════

def probe_openclaw():
    print("\n" + "=" * 60)
    print("  OPENCLAW (openclaw models list --json)")
    print("=" * 60)
    
    import subprocess
    start = time.time()
    
    result = subprocess.run(
        ['openclaw', 'models', 'list', '--json'],
        capture_output=True, text=True, timeout=15
    )
    
    total = time.time() - start
    
    data = json.loads(result.stdout)
    all_models = data.get('models', [])
    available = [m for m in all_models if m.get('available', False)]
    
    models = []
    for m in available:
        models.append({
            'id': m['key'],
            'name': m.get('name', m['key']),
            'description': f"context: {m.get('contextWindow', '?')}",
            'available': True,
        })
    
    print(f"  Total: {total:.2f}s")
    print(f"  Total in registry: {len(all_models)}, Available: {len(available)}")
    for m in models:
        print(f"    - {m['id']} ({m['name']})")
    
    return models, total


# ═══════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    target = sys.argv[1] if len(sys.argv) > 1 else 'all'
    
    results = {}
    
    if target in ('claude', 'all'):
        results['claude'] = probe_claude()
    if target in ('codex', 'all'):
        results['codex'] = probe_codex()
    if target in ('gemini', 'all'):
        results['gemini'] = probe_gemini()
    if target in ('cursor', 'all'):
        results['cursor'] = probe_cursor()
    if target in ('openclaw', 'all'):
        results['openclaw'] = probe_openclaw()
    
    # Summary
    print("\n" + "=" * 60)
    print("  FINAL SUMMARY")
    print("=" * 60)
    for name, (models, elapsed) in results.items():
        status = "✅" if models else "❌"
        print(f"  {status} {name:12s} {elapsed:6.1f}s  {len(models)} models")
        for m in models[:5]:
            print(f"     {m['id']}")
        if len(models) > 5:
            print(f"     ... +{len(models)-5} more")
    
    # Output JSON for programmatic use
    print("\n--- JSON ---")
    json_out = {}
    for name, (models, elapsed) in results.items():
        json_out[name] = {
            'models': models,
            'durationSeconds': round(elapsed, 2),
        }
    print(json.dumps(json_out, indent=2, ensure_ascii=False))
