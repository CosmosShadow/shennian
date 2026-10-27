#!/usr/bin/env python3
"""
Probe Claude CLI /model - proper TUI interaction.
The key issue: Claude uses a TUI that intercepts input character by character.
/model triggers autocomplete → Enter selects it → model picker opens.
"""
import pexpect
import sys
import re
import os
import time

def strip_ansi(text):
    return re.sub(r'\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][A-Za-z0-9]|\r', '', text)

def main():
    print("Spawning claude from /tmp...")
    
    child = pexpect.spawn('claude', [],
                         timeout=30,
                         encoding='utf-8',
                         dimensions=(80, 200),
                         cwd='/tmp')
    
    all_output = ""
    
    def collect():
        nonlocal all_output
        if isinstance(child.before, str):
            all_output += child.before
        if isinstance(child.after, str):
            all_output += child.after
    
    # Handle trust prompt
    print("Handling trust prompt...")
    child.expect([r'trust', pexpect.TIMEOUT], timeout=15)
    collect()
    child.send('\r')
    
    # Wait for interactive UI to be ready
    print("Waiting for UI ready...")
    child.expect([r'Tips|Welcome|Recent', pexpect.TIMEOUT], timeout=15)
    collect()
    time.sleep(3)  # Extra wait for full render
    
    # Type /model character by character (TUI needs this)
    print("Typing /model...")
    for char in '/model':
        child.send(char)
        time.sleep(0.1)
    
    time.sleep(1)
    
    # Read what's showing (should be autocomplete)
    try:
        autocomplete = child.read_nonblocking(size=50000, timeout=1)
        all_output += autocomplete
        clean_auto = strip_ansi(autocomplete)
        print(f"After typing /model: {clean_auto[:300]}")
    except:
        pass
    
    # Press Enter to execute the /model command
    print("Pressing Enter to execute /model...")
    child.send('\r')
    
    # Wait for model picker
    print("Waiting for model picker...")
    time.sleep(5)
    
    # Read output
    try:
        picker = child.read_nonblocking(size=100000, timeout=3)
        all_output += picker
    except:
        pass
    
    # Also try matching specific patterns
    try:
        idx = child.expect([
            r'Select model',
            r'recommended',
            r'Balanced',
            r'capable',
            pexpect.TIMEOUT
        ], timeout=10)
        collect()
        print(f"  Matched: {idx}")
    except:
        pass
    
    # Final read
    time.sleep(2)
    try:
        remaining = child.read_nonblocking(size=100000, timeout=2)
        all_output += remaining
    except:
        pass
    
    # Clean and output
    clean = strip_ansi(all_output)
    clean = re.sub(r'[\x00-\x09\x0b-\x1f\x7f]', ' ', clean)
    
    with open('/tmp/probe-claude-v5-raw.txt', 'w') as f:
        f.write(all_output)
    with open('/tmp/probe-claude-v5-clean.txt', 'w') as f:
        f.write(clean)
    
    print(f"\n{'='*60}")
    print("ALL MODEL-RELATED OUTPUT:")
    print('='*60)
    for line in clean.split('\n'):
        stripped = line.strip()
        if stripped and any(kw in stripped.lower() for kw in ['model', 'sonnet', 'opus', 'haiku', 'default', 'select', 'recommend', 'capable', 'balanced', 'efficient', 'fast', 'effort', '1m context', 'per mtok']):
            print(f"  {stripped}")
    
    print(f"\n  Full clean output ({len(clean)} chars) saved to /tmp/probe-claude-v5-clean.txt")
    
    # Exit
    child.send('\x1b')
    time.sleep(0.5)
    child.send('\x04')
    try:
        child.close(force=True)
    except:
        pass

if __name__ == '__main__':
    main()
