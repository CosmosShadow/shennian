#!/usr/bin/env python3
"""
Final probe: handle trust prompts properly for Codex and Gemini.
"""
import pexpect
import sys
import re
import os
import time

def strip_ansi(text):
    return re.sub(r'\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][A-Za-z0-9]|\r', '', text)

def clean_output(text):
    text = strip_ansi(text)
    text = re.sub(r'[\x00-\x09\x0b-\x1f\x7f]', ' ', text)
    return text

def probe_cli(name, cmd, args=None, cwd='/tmp'):
    print(f"\n{'='*60}")
    print(f"PROBING: {name}")
    print(f"{'='*60}")
    
    env = {**os.environ, 'TERM': 'xterm-256color', 'COLUMNS': '200', 'LINES': '80'}
    child = pexpect.spawn(cmd, args or [],
                         timeout=30,
                         encoding='utf-8',
                         dimensions=(80, 200),
                         cwd=cwd,
                         env=env)
    
    all_output = ""
    
    def read_all():
        nonlocal all_output
        try:
            data = child.read_nonblocking(size=100000, timeout=2)
            all_output += data
            return data
        except:
            return ""
    
    # Phase 1: Wait for initial load and handle trust prompts
    print("Phase 1: Waiting for startup...")
    time.sleep(5)
    read_all()
    
    clean = clean_output(all_output)
    
    # Check for trust prompt and handle it
    if 'trust' in clean.lower() or 'Trust' in clean:
        print("  Found trust prompt, confirming...")
        child.send('\r')  # Press Enter to confirm (first option is usually "Yes/Trust")
        time.sleep(3)
        read_all()
        clean = clean_output(all_output)
    
    # Check for another trust prompt (some CLIs have multiple confirmation steps)
    if 'continue' in clean.lower() and 'enter' in clean.lower():
        print("  Found continue prompt, pressing Enter...")
        child.send('\r')
        time.sleep(3)
        read_all()
    
    # Phase 2: Wait for interactive prompt
    print("Phase 2: Waiting for interactive prompt...")
    time.sleep(3)
    read_all()
    
    clean = clean_output(all_output)
    print(f"  Current output ({len(clean)} chars)")
    
    # Phase 3: Send /model command
    print("Phase 3: Typing /model...")
    for char in '/model':
        child.send(char)
        time.sleep(0.15)
    
    time.sleep(2)
    read_all()
    
    # Press Enter to execute the command
    print("Phase 4: Pressing Enter to execute...")
    child.send('\r')
    time.sleep(6)
    read_all()
    
    # Wait a bit more and read remaining
    time.sleep(3)
    read_all()
    
    # Phase 5: Parse results
    clean = clean_output(all_output)
    
    with open(f'/tmp/probe-{name.lower()}-final-raw.txt', 'w') as f:
        f.write(all_output)
    with open(f'/tmp/probe-{name.lower()}-final-clean.txt', 'w') as f:
        f.write(clean)
    
    print(f"\n{'='*40}")
    print(f"OUTPUT ({len(clean)} chars):")
    print('='*40)
    
    # Print all non-trivial lines
    for line in clean.split('\n'):
        stripped = line.strip()
        if stripped and len(stripped) > 3:
            # Filter out pure decoration lines
            if not all(c in '─│╭╮╰╯┌┐└┘═║╔╗╚╝ ' for c in stripped):
                print(f"  {stripped[:150]}")
    
    print(f"\n  Saved to /tmp/probe-{name.lower()}-final-*.txt")
    
    # Clean exit
    child.send('\x1b')
    time.sleep(0.5)
    child.send('\x03')
    time.sleep(0.5)
    child.send('\x04')
    try:
        child.close(force=True)
    except:
        pass
    
    return clean

if __name__ == '__main__':
    target = sys.argv[1] if len(sys.argv) > 1 else 'all'
    
    if target in ('codex', 'all'):
        probe_cli('Codex', 'codex')
    
    if target in ('gemini', 'all'):
        probe_cli('Gemini', 'gemini')
    
    print("\nDone!")
