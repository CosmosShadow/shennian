#!/usr/bin/env python3
"""
Fast /model probing - event-driven, minimal waits.
Goal: get model list as fast as possible from each CLI.
"""
import pexpect
import sys
import re
import os
import time

def strip_ansi(text):
    return re.sub(r'\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][A-Za-z0-9]|\r', '', text)

def clean(text):
    text = strip_ansi(text)
    return re.sub(r'[\x00-\x09\x0b-\x1f\x7f]', ' ', text)

# ─── Claude: --bare + --dangerously-skip-permissions ─────────────────────

def probe_claude_fast():
    start = time.time()
    print("Claude: spawning with --bare --dangerously-skip-permissions ...")
    
    child = pexpect.spawn('claude', ['--bare', '--dangerously-skip-permissions'],
                         timeout=15, encoding='utf-8', dimensions=(80, 200), cwd='/tmp')
    
    all_out = ""
    
    # Phase 1: Wait for ready (trust prompt or input prompt)
    t1 = time.time()
    try:
        idx = child.expect([r'trust', r'Tips', r'What can', r'[>❯]', pexpect.TIMEOUT], timeout=8)
        if isinstance(child.before, str): all_out += child.before
        if isinstance(child.after, str): all_out += child.after
        print(f"  Phase 1 ready: {time.time()-t1:.1f}s (match={idx})")
        
        if idx == 0:  # trust prompt
            child.send('\r')
            child.expect([r'Tips', r'What can', r'[>❯]', pexpect.TIMEOUT], timeout=5)
            if isinstance(child.before, str): all_out += child.before
            if isinstance(child.after, str): all_out += child.after
            print(f"  Trust handled: {time.time()-t1:.1f}s")
    except:
        print(f"  Phase 1 timeout: {time.time()-t1:.1f}s")
    
    # Phase 2: Type /model and execute
    t2 = time.time()
    for c in '/model':
        child.send(c)
        time.sleep(0.05)
    time.sleep(0.3)
    child.send('\r')
    print(f"  /model sent: {time.time()-t2:.1f}s")
    
    # Phase 3: Wait for model picker
    t3 = time.time()
    try:
        child.expect([r'Select model', r'Default.*recommended', pexpect.TIMEOUT], timeout=8)
        if isinstance(child.before, str): all_out += child.before
        if isinstance(child.after, str): all_out += child.after
        print(f"  Model picker appeared: {time.time()-t3:.1f}s")
    except:
        print(f"  Model picker timeout: {time.time()-t3:.1f}s")
    
    # Phase 4: Read the full list
    time.sleep(0.5)  # just 0.5s for rendering
    try:
        remaining = child.read_nonblocking(size=100000, timeout=1)
        all_out += remaining
    except:
        pass
    
    total = time.time() - start
    
    # Parse
    cleaned = clean(all_out)
    
    # Extract model entries
    print(f"\n  TOTAL: {total:.1f}s")
    print(f"  Model-related lines:")
    for line in cleaned.split('\n'):
        s = line.strip()
        if s and any(kw in s.lower() for kw in ['default', 'sonnet', 'opus', 'haiku', 'select model', 'per mtok', 'capable', 'balanced']):
            print(f"    {s[:120]}")
    
    child.send('\x1b')
    time.sleep(0.2)
    child.send('\x04')
    try: child.close(force=True)
    except: pass
    
    return total

# ─── Codex: TERM=xterm-256color, fast probe ─────────────────────────────

def probe_codex_fast():
    start = time.time()
    print("\nCodex: spawning ...")
    
    env = {**os.environ, 'TERM': 'xterm-256color', 'NO_COLOR': '1'}
    child = pexpect.spawn('codex', [], timeout=15, encoding='utf-8',
                         dimensions=(80, 200), cwd='/tmp', env=env)
    
    all_out = ""
    
    # Phase 1: Wait for ready
    t1 = time.time()
    try:
        idx = child.expect([r'trust', r'/model to change', r'>_', pexpect.TIMEOUT], timeout=8)
        if isinstance(child.before, str): all_out += child.before
        if isinstance(child.after, str): all_out += child.after
        print(f"  Phase 1: {time.time()-t1:.1f}s (match={idx})")
        
        if idx == 0:  # trust
            child.send('\r')
            child.expect([r'/model to change', r'>_', pexpect.TIMEOUT], timeout=5)
            if isinstance(child.before, str): all_out += child.before
            if isinstance(child.after, str): all_out += child.after
            print(f"  Trust handled: {time.time()-t1:.1f}s")
    except:
        print(f"  Phase 1 timeout: {time.time()-t1:.1f}s")
    
    # Phase 2: Type /model
    t2 = time.time()
    for c in '/model':
        child.send(c)
        time.sleep(0.05)
    time.sleep(0.2)
    child.send('\r')
    print(f"  /model sent: {time.time()-t2:.1f}s")
    
    # Phase 3: Wait for model list
    t3 = time.time()
    try:
        child.expect([r'Select Model', r'Press enter to select', r'esc to dismiss', pexpect.TIMEOUT], timeout=8)
        if isinstance(child.before, str): all_out += child.before
        if isinstance(child.after, str): all_out += child.after
        print(f"  Model list appeared: {time.time()-t3:.1f}s")
    except:
        print(f"  Model list timeout: {time.time()-t3:.1f}s")
    
    time.sleep(0.5)
    try:
        remaining = child.read_nonblocking(size=100000, timeout=1)
        all_out += remaining
    except:
        pass
    
    total = time.time() - start
    
    cleaned = clean(all_out)
    print(f"\n  TOTAL: {total:.1f}s")
    print(f"  Model-related lines:")
    for line in cleaned.split('\n'):
        s = line.strip()
        if s and any(kw in s.lower() for kw in ['gpt-5', 'codex', 'select model', 'current', 'frontier', 'agentic']):
            print(f"    {s[:120]}")
    
    child.send('\x1b')
    time.sleep(0.2)
    child.send('\x03')
    try: child.close(force=True)
    except: pass
    
    return total

# ─── Gemini: fast probe ─────────────────────────────────────────────────

def probe_gemini_fast():
    start = time.time()
    print("\nGemini: spawning ...")
    
    env = {**os.environ, 'TERM': 'xterm-256color'}
    child = pexpect.spawn('gemini', [], timeout=15, encoding='utf-8',
                         dimensions=(80, 200), cwd='/tmp', env=env)
    
    all_out = ""
    
    # Phase 1: Wait for trust or ready
    t1 = time.time()
    try:
        idx = child.expect([r'[Tt]rust', r'[>❯]', pexpect.TIMEOUT], timeout=10)
        if isinstance(child.before, str): all_out += child.before
        if isinstance(child.after, str): all_out += child.after
        print(f"  Phase 1: {time.time()-t1:.1f}s (match={idx})")
        
        if idx == 0:
            child.send('\r')
            child.expect([r'[>❯]', pexpect.TIMEOUT], timeout=8)
            if isinstance(child.before, str): all_out += child.before
            if isinstance(child.after, str): all_out += child.after
            print(f"  Trust handled: {time.time()-t1:.1f}s")
    except:
        print(f"  Phase 1 timeout: {time.time()-t1:.1f}s")
    
    # Phase 2: /model
    t2 = time.time()
    for c in '/model':
        child.send(c)
        time.sleep(0.05)
    time.sleep(0.2)
    child.send('\r')
    print(f"  /model sent: {time.time()-t2:.1f}s")
    
    # Phase 3: Model dialog
    t3 = time.time()
    try:
        child.expect([r'Select Model', r'Auto.*Gemini', r'Manual', pexpect.TIMEOUT], timeout=8)
        if isinstance(child.before, str): all_out += child.before
        if isinstance(child.after, str): all_out += child.after
        print(f"  Model dialog appeared: {time.time()-t3:.1f}s")
    except:
        print(f"  Model dialog timeout: {time.time()-t3:.1f}s")
    
    time.sleep(0.5)
    try:
        remaining = child.read_nonblocking(size=100000, timeout=1)
        all_out += remaining
    except:
        pass
    
    total = time.time() - start
    
    cleaned = clean(all_out)
    print(f"\n  TOTAL: {total:.1f}s")
    print(f"  Model-related lines:")
    for line in cleaned.split('\n'):
        s = line.strip()
        if s and any(kw in s.lower() for kw in ['gemini', 'flash', 'pro', 'auto', 'select model', 'manual']):
            print(f"    {s[:120]}")
    
    child.send('\x1b')
    time.sleep(0.2)
    child.send('\x04')
    try: child.close(force=True)
    except: pass
    
    return total

if __name__ == '__main__':
    target = sys.argv[1] if len(sys.argv) > 1 else 'all'
    
    results = {}
    if target in ('claude', 'all'):
        results['claude'] = probe_claude_fast()
    if target in ('codex', 'all'):
        results['codex'] = probe_codex_fast()
    if target in ('gemini', 'all'):
        results['gemini'] = probe_gemini_fast()
    
    print(f"\n{'='*50}")
    print("TIMING SUMMARY:")
    for name, t in results.items():
        print(f"  {name}: {t:.1f}s")
