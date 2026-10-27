#!/usr/bin/env python3
"""
Probe Codex CLI - fix TERM issue, use xterm-256color.
"""
import pexpect
import sys
import re
import os
import time

def strip_ansi(text):
    return re.sub(r'\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][A-Za-z0-9]|\r', '', text)

def main():
    print("Spawning codex with TERM=xterm-256color...")
    
    env = {**os.environ, 'TERM': 'xterm-256color', 'COLUMNS': '200', 'LINES': '80', 'NO_COLOR': '1'}
    child = pexpect.spawn('codex', [],
                         timeout=30,
                         encoding='utf-8',
                         dimensions=(80, 200),
                         cwd='/tmp',
                         env=env)
    
    all_output = ""
    
    print("Waiting for Codex to start...")
    time.sleep(6)
    
    try:
        initial = child.read_nonblocking(size=50000, timeout=3)
        all_output += initial
        clean = strip_ansi(initial)
        clean = re.sub(r'[\x00-\x09\x0b-\x1f\x7f]', ' ', clean)
        print(f"Initial ({len(clean)} chars):\n{clean[:800]}")
    except Exception as e:
        print(f"Read error: {e}")
    
    # Type /model
    print("\nTyping /model...")
    for char in '/model':
        child.send(char)
        time.sleep(0.15)
    
    time.sleep(2)
    
    try:
        after_model = child.read_nonblocking(size=50000, timeout=2)
        all_output += after_model
        clean = strip_ansi(after_model)
        clean = re.sub(r'[\x00-\x09\x0b-\x1f\x7f]', ' ', clean)
        print(f"After /model ({len(clean)} chars):\n{clean[:500]}")
    except:
        pass
    
    # Press Enter
    print("\nPressing Enter...")
    child.send('\r')
    time.sleep(6)
    
    try:
        picker = child.read_nonblocking(size=100000, timeout=3)
        all_output += picker
    except:
        pass
    
    time.sleep(3)
    try:
        more = child.read_nonblocking(size=100000, timeout=2)
        all_output += more
    except:
        pass
    
    clean = strip_ansi(all_output)
    clean = re.sub(r'[\x00-\x09\x0b-\x1f\x7f]', ' ', clean)
    
    with open('/tmp/probe-codex-v3-raw.txt', 'w') as f:
        f.write(all_output)
    with open('/tmp/probe-codex-v3-clean.txt', 'w') as f:
        f.write(clean)
    
    print(f"\n{'='*60}")
    print("ALL OUTPUT LINES:")
    print('='*60)
    for line in clean.split('\n'):
        stripped = line.strip()
        if stripped and len(stripped) > 2:
            print(f"  {stripped}")
    
    child.send('\x1b')
    time.sleep(0.5)
    child.send('\x03')
    try:
        child.close(force=True)
    except:
        pass

if __name__ == '__main__':
    main()
