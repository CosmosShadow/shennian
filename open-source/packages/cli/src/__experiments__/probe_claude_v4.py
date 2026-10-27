#!/usr/bin/env python3
"""
Probe Claude CLI /model - enter command properly and capture model picker.
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
    child.expect([r'trust', pexpect.TIMEOUT], timeout=15)
    collect()
    child.send('\r')
    
    # Wait for interactive UI
    child.expect([r'Tips|Welcome|Recent', pexpect.TIMEOUT], timeout=15)
    collect()
    time.sleep(2)
    
    # Type /model and press Enter
    print("Sending /model + Enter...")
    child.sendline('/model')
    time.sleep(1)
    
    # The /model might show autocomplete - press Enter to confirm the command
    child.send('\r')
    time.sleep(1)
    
    # Wait for model picker to appear
    print("Waiting for model picker...")
    try:
        idx = child.expect([
            r'Select model',
            r'Default.*recommended',
            r'Sonnet.*4',
            r'Opus',
            r'balanced|capable|efficient',
            pexpect.TIMEOUT
        ], timeout=15)
        collect()
        print(f"  Matched pattern: {idx}")
    except Exception as e:
        collect()
        print(f"  Exception: {e}")
    
    # Wait for full render
    time.sleep(3)
    
    # Read remaining output
    try:
        remaining = child.read_nonblocking(size=100000, timeout=2)
        all_output += remaining
    except:
        pass
    
    # Clean and output
    clean = strip_ansi(all_output)
    clean = re.sub(r'[\x00-\x09\x0b-\x1f\x7f]', ' ', clean)
    
    with open('/tmp/probe-claude-v4-raw.txt', 'w') as f:
        f.write(all_output)
    with open('/tmp/probe-claude-v4-clean.txt', 'w') as f:
        f.write(clean)
    
    print(f"\n{'='*60}")
    print("MODEL PICKER OUTPUT:")
    print('='*60)
    
    # Try to extract model-related lines
    for line in clean.split('\n'):
        stripped = line.strip()
        if any(kw in stripped.lower() for kw in ['model', 'sonnet', 'opus', 'haiku', 'default', 'select', 'recommend', 'capable', 'balanced', 'efficient', 'fast', 'effort']):
            print(f"  {stripped}")
    
    print(f"\nFull clean output saved to /tmp/probe-claude-v4-clean.txt")
    
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
