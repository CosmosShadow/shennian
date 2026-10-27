#!/usr/bin/env python3
"""
Probe Claude CLI /model list - handle trust prompt first.
"""
import pexpect
import sys
import re
import os
import time

def strip_ansi(text):
    return re.sub(r'\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][A-Za-z0-9]|\r', '', text)

def main():
    print("Spawning claude from /tmp to get model list...")
    
    child = pexpect.spawn('claude', [],
                         timeout=30,
                         encoding='utf-8',
                         dimensions=(80, 200),
                         cwd='/tmp')
    
    all_output = ""
    
    def collect(text):
        nonlocal all_output
        all_output += text
    
    # Step 1: Handle trust prompt
    print("Step 1: Waiting for trust prompt or ready state...")
    idx = child.expect([
        r'trust',
        r'What can I',
        r'Tips',
        pexpect.TIMEOUT
    ], timeout=15)
    
    collect(child.before or "")
    collect(child.after or "")
    print(f"  Matched: {idx}")
    
    if idx == 0:
        # Trust prompt - send Enter to confirm
        print("  Got trust prompt, pressing Enter...")
        time.sleep(0.5)
        child.send('\r')
        
        # Now wait for the actual interactive prompt
        print("Step 2: Waiting for interactive prompt...")
        idx2 = child.expect([
            r'What can I',
            r'Tips',
            r'help',
            r'\$',
            pexpect.TIMEOUT
        ], timeout=15)
        collect(child.before or "")
        collect(child.after or "")
        print(f"  Matched: {idx2}")
    
    # Give it a moment to fully render
    time.sleep(2)
    
    # Step 3: Send /model
    print("Step 3: Sending /model...")
    child.sendline('/model')
    
    # Wait for model picker to appear
    print("Step 4: Waiting for model picker...")
    idx3 = child.expect([
        r'Select model',
        r'Switch between',
        r'Sonnet',
        r'Opus',
        r'Default',
        pexpect.TIMEOUT
    ], timeout=15)
    collect(child.before or "")
    collect(child.after or "")
    print(f"  Matched: {idx3}")
    
    # Wait for full render
    time.sleep(3)
    
    # Read remaining
    try:
        remaining = child.read_nonblocking(size=100000, timeout=2)
        collect(remaining)
    except:
        pass
    
    # Clean and output
    clean = strip_ansi(all_output)
    
    # Remove control chars
    clean = re.sub(r'[\x00-\x09\x0b-\x1f\x7f]', ' ', clean)
    # Collapse multiple spaces
    clean = re.sub(r' {2,}', ' ', clean)
    
    print(f"\n{'='*60}")
    print(f"FULL CLEANED OUTPUT ({len(clean)} chars):")
    print('='*60)
    # Print line by line
    for line in clean.split('\n'):
        stripped = line.strip()
        if stripped:
            print(f"  {stripped}")
    
    with open('/tmp/probe-claude-v3-raw.txt', 'w') as f:
        f.write(all_output)
    with open('/tmp/probe-claude-v3-clean.txt', 'w') as f:
        f.write(clean)
    
    # Exit gracefully
    child.send('\x1b')
    time.sleep(0.5)
    child.send('\x04')
    try:
        child.close(force=True)
    except:
        pass

if __name__ == '__main__':
    main()
