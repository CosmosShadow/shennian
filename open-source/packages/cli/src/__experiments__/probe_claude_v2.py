#!/usr/bin/env python3
"""
Probe Claude CLI /model list using pexpect with proper expect() calls.
"""
import pexpect
import sys
import re
import os
import time

def strip_ansi(text):
    return re.sub(r'\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][A-Za-z0-9]|\r', '', text)

def main():
    print("Spawning claude --dangerously-skip-permissions ...")
    
    child = pexpect.spawn('claude', ['--dangerously-skip-permissions'],
                         timeout=30,
                         encoding='utf-8',
                         dimensions=(50, 200))
    
    # Log everything to stdout for debugging
    child.logfile_read = sys.stdout
    
    print("\n--- Waiting for Claude to be ready ---")
    
    # Claude might show various prompts
    try:
        idx = child.expect([
            r'[>❯]',           # Standard prompt
            r'Tips',           # Tips text
            r'What can I',     # "What can I help with?"
            pexpect.TIMEOUT
        ], timeout=15)
        print(f"\nMatched pattern index: {idx}")
    except Exception as e:
        print(f"\nExpect error: {e}")
        print(f"Before: {repr(child.before)}")
        print(f"After: {repr(child.after)}")
    
    time.sleep(1)
    
    print("\n--- Sending /model ---")
    child.sendline('/model')
    
    # Wait for model list to appear
    try:
        idx = child.expect([
            r'Select model',
            r'Switch between',
            r'Sonnet',
            r'Opus',
            r'Haiku',
            r'Enter to confirm',
            r'Esc',
            pexpect.TIMEOUT
        ], timeout=15)
        print(f"\nMatched pattern index: {idx}")
    except Exception as e:
        print(f"\nExpect error: {e}")
    
    # Read any remaining output
    time.sleep(2)
    try:
        remaining = child.read_nonblocking(size=50000, timeout=2)
        print(f"\nRemaining: {remaining[:2000]}")
    except:
        pass
    
    # Capture full buffer
    full_output = (child.before or "") + (child.after or "")
    clean = strip_ansi(full_output)
    
    print(f"\n\n{'='*60}")
    print("CLEANED OUTPUT:")
    print('='*60)
    print(clean[:5000])
    
    with open('/tmp/probe-claude-v2-clean.txt', 'w') as f:
        f.write(clean)
    
    # Exit
    child.send('\x1b')
    time.sleep(0.5)
    child.send('\x04')
    try:
        child.close()
    except:
        pass

if __name__ == '__main__':
    main()
