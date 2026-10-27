#!/usr/bin/env python3
"""
Probe Codex and Gemini CLIs for model lists.
"""
import pexpect
import sys
import re
import os
import time

def strip_ansi(text):
    return re.sub(r'\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][A-Za-z0-9]|\r', '', text)

def probe_codex():
    print("\n" + "=" * 60)
    print("PROBING: Codex CLI")
    print("=" * 60)
    
    child = pexpect.spawn('codex', [],
                         timeout=30,
                         encoding='utf-8',
                         dimensions=(80, 200),
                         cwd='/tmp')
    
    all_output = ""
    
    # Wait for Codex to start
    print("Waiting for Codex to start...")
    time.sleep(5)
    
    try:
        initial = child.read_nonblocking(size=50000, timeout=3)
        all_output += initial
        clean = strip_ansi(initial)
        print(f"Initial ({len(clean)} chars): {clean[:500]}")
    except:
        pass
    
    # Type /model
    print("\nTyping /model...")
    for char in '/model':
        child.send(char)
        time.sleep(0.1)
    
    time.sleep(2)
    
    try:
        after_model = child.read_nonblocking(size=50000, timeout=2)
        all_output += after_model
        clean = strip_ansi(after_model)
        print(f"After /model ({len(clean)} chars): {clean[:500]}")
    except:
        pass
    
    # Press Enter
    print("\nPressing Enter...")
    child.send('\r')
    time.sleep(5)
    
    try:
        picker = child.read_nonblocking(size=100000, timeout=3)
        all_output += picker
    except:
        pass
    
    # Wait and read more
    time.sleep(3)
    try:
        more = child.read_nonblocking(size=100000, timeout=2)
        all_output += more
    except:
        pass
    
    clean = strip_ansi(all_output)
    clean = re.sub(r'[\x00-\x09\x0b-\x1f\x7f]', ' ', clean)
    
    with open('/tmp/probe-codex-v2-raw.txt', 'w') as f:
        f.write(all_output)
    with open('/tmp/probe-codex-v2-clean.txt', 'w') as f:
        f.write(clean)
    
    print(f"\n{'='*40}")
    print("MODEL-RELATED OUTPUT:")
    print('='*40)
    for line in clean.split('\n'):
        stripped = line.strip()
        if stripped and len(stripped) > 3:
            if any(kw in stripped.lower() for kw in ['model', 'gpt', 'o3', 'o4', 'codex', 'select', 'switch', 'current']):
                print(f"  {stripped}")
    
    print(f"\nFull output ({len(clean)} chars) saved to /tmp/probe-codex-v2-clean.txt")
    
    child.send('\x1b')
    time.sleep(0.5)
    child.send('\x04')
    try:
        child.close(force=True)
    except:
        pass

def probe_gemini():
    print("\n" + "=" * 60)
    print("PROBING: Gemini CLI")
    print("=" * 60)
    
    child = pexpect.spawn('gemini', [],
                         timeout=30,
                         encoding='utf-8',
                         dimensions=(80, 200),
                         cwd='/tmp')
    
    all_output = ""
    
    print("Waiting for Gemini to start...")
    time.sleep(5)
    
    try:
        initial = child.read_nonblocking(size=50000, timeout=3)
        all_output += initial
        clean = strip_ansi(initial)
        print(f"Initial ({len(clean)} chars): {clean[:500]}")
    except:
        pass
    
    # Type /model
    print("\nTyping /model...")
    for char in '/model':
        child.send(char)
        time.sleep(0.1)
    
    time.sleep(2)
    
    try:
        after_model = child.read_nonblocking(size=50000, timeout=2)
        all_output += after_model
        clean = strip_ansi(after_model)
        print(f"After /model ({len(clean)} chars): {clean[:500]}")
    except:
        pass
    
    # Press Enter
    print("\nPressing Enter...")
    child.send('\r')
    time.sleep(5)
    
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
    
    with open('/tmp/probe-gemini-v2-raw.txt', 'w') as f:
        f.write(all_output)
    with open('/tmp/probe-gemini-v2-clean.txt', 'w') as f:
        f.write(clean)
    
    print(f"\n{'='*40}")
    print("MODEL-RELATED OUTPUT:")
    print('='*40)
    for line in clean.split('\n'):
        stripped = line.strip()
        if stripped and len(stripped) > 3:
            if any(kw in stripped.lower() for kw in ['model', 'gemini', 'flash', 'pro', 'select', 'switch', 'current', 'thinking']):
                print(f"  {stripped}")
    
    print(f"\nFull output ({len(clean)} chars) saved to /tmp/probe-gemini-v2-clean.txt")
    
    child.send('\x1b')
    time.sleep(0.5)
    child.send('\x04')
    try:
        child.close(force=True)
    except:
        pass

if __name__ == '__main__':
    target = sys.argv[1] if len(sys.argv) > 1 else 'all'
    if target in ('codex', 'all'):
        probe_codex()
    if target in ('gemini', 'all'):
        probe_gemini()
