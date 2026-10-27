#!/usr/bin/env python3
"""
Experimental PTY-based model list probing for Claude, Codex, and Gemini CLIs.
Uses pexpect to interact with interactive TUIs.
"""

import pexpect
import sys
import re
import json
import os
import time

def strip_ansi(text):
    """Remove ANSI escape sequences from text."""
    ansi_escape = re.compile(r'\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][A-Za-z0-9]|\x1b\[[\?]?[0-9;]*[a-zA-Z]|\r')
    return ansi_escape.sub('', text)

def clean_text(text):
    """Clean up text by removing ANSI codes, control chars, and normalizing whitespace."""
    text = strip_ansi(text)
    # Remove remaining control characters except newline
    text = re.sub(r'[\x00-\x09\x0b-\x1f\x7f]', '', text)
    return text

# ─── Claude ──────────────────────────────────────────────────────────────────

def probe_claude():
    """Probe Claude CLI for model list using /model command."""
    print("\n" + "=" * 60)
    print("PROBING: Claude CLI")
    print("=" * 60)
    
    try:
        # Use a temp directory to avoid "trust this folder" prompt, or use --dangerously-skip-permissions
        child = pexpect.spawn('claude', ['--dangerously-skip-permissions'], 
                            timeout=30, 
                            encoding='utf-8',
                            env={**os.environ, 'TERM': 'dumb', 'COLUMNS': '200', 'LINES': '50', 'NO_COLOR': '1'})
        
        # Wait for initial prompt
        time.sleep(3)
        
        # Read everything available
        try:
            child.read_nonblocking(size=10000, timeout=2)
        except:
            pass
        
        # Send /model command
        child.sendline('/model')
        
        # Wait for model list to render
        time.sleep(3)
        
        # Read output
        try:
            output = child.read_nonblocking(size=50000, timeout=3)
        except:
            output = ""
        
        # Also try to get buffer content
        before = child.before or ""
        after = child.after or ""
        
        full_output = str(before) + str(output) + str(after)
        
        # Save raw output
        with open('/tmp/probe-claude-pty-raw.txt', 'w') as f:
            f.write(full_output)
        
        clean = clean_text(full_output)
        
        # Save clean output
        with open('/tmp/probe-claude-pty-clean.txt', 'w') as f:
            f.write(clean)
        
        print(f"Raw output length: {len(full_output)}")
        print(f"\n--- Cleaned output ---")
        print(clean[:3000])
        
        # Try to exit
        child.send('\x1b')  # ESC
        time.sleep(0.5)
        child.send('\x04')  # Ctrl+D
        child.close()
        
        return clean
        
    except Exception as e:
        print(f"Error: {e}")
        return ""

# ─── Codex ──────────────────────────────────────────────────────────────────

def probe_codex():
    """Probe Codex CLI for model list using /model command."""
    print("\n" + "=" * 60)
    print("PROBING: Codex CLI")
    print("=" * 60)
    
    try:
        child = pexpect.spawn('codex', [],
                            timeout=30,
                            encoding='utf-8',
                            env={**os.environ, 'TERM': 'dumb', 'COLUMNS': '200', 'LINES': '80', 'NO_COLOR': '1'})
        
        # Wait for initial prompt
        time.sleep(5)
        
        # Read everything available
        try:
            initial = child.read_nonblocking(size=10000, timeout=2)
            print(f"Initial output ({len(initial)} chars):")
            print(clean_text(initial)[:500])
        except:
            initial = ""
        
        # Send /model command
        child.sendline('/model')
        
        # Wait for model list
        time.sleep(5)
        
        # Read output
        try:
            output = child.read_nonblocking(size=50000, timeout=3)
        except:
            output = ""
        
        full_output = str(initial) + str(output)
        
        with open('/tmp/probe-codex-pty-raw.txt', 'w') as f:
            f.write(full_output)
        
        clean = clean_text(full_output)
        
        with open('/tmp/probe-codex-pty-clean.txt', 'w') as f:
            f.write(clean)
        
        print(f"\n--- Cleaned output ({len(clean)} chars) ---")
        print(clean[:3000])
        
        # Exit
        child.send('\x1b')
        time.sleep(0.5)
        child.send('\x04')
        child.close()
        
        return clean
        
    except Exception as e:
        print(f"Error: {e}")
        return ""

# ─── Gemini ──────────────────────────────────────────────────────────────────

def probe_gemini():
    """Probe Gemini CLI for model list using /model command."""
    print("\n" + "=" * 60)
    print("PROBING: Gemini CLI")
    print("=" * 60)
    
    try:
        child = pexpect.spawn('gemini', [],
                            timeout=30,
                            encoding='utf-8',
                            env={**os.environ, 'TERM': 'dumb', 'COLUMNS': '200', 'LINES': '50', 'NO_COLOR': '1'})
        
        # Wait for initial prompt
        time.sleep(3)
        
        try:
            initial = child.read_nonblocking(size=10000, timeout=2)
            print(f"Initial output ({len(initial)} chars):")
            print(clean_text(initial)[:500])
        except:
            initial = ""
        
        # Send /model command
        child.sendline('/model')
        
        # Wait for model list
        time.sleep(3)
        
        try:
            output = child.read_nonblocking(size=50000, timeout=3)
        except:
            output = ""
        
        full_output = str(initial) + str(output)
        
        with open('/tmp/probe-gemini-pty-raw.txt', 'w') as f:
            f.write(full_output)
        
        clean = clean_text(full_output)
        
        with open('/tmp/probe-gemini-pty-clean.txt', 'w') as f:
            f.write(clean)
        
        print(f"\n--- Cleaned output ({len(clean)} chars) ---")
        print(clean[:3000])
        
        child.send('\x1b')
        time.sleep(0.5)
        child.send('\x04')
        child.close()
        
        return clean
        
    except Exception as e:
        print(f"Error: {e}")
        return ""

# ─── Main ────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    target = sys.argv[1] if len(sys.argv) > 1 else 'all'
    
    if target in ('claude', 'all'):
        probe_claude()
    if target in ('codex', 'all'):
        probe_codex()
    if target in ('gemini', 'all'):
        probe_gemini()
    
    print("\n\nDone. Raw outputs saved to /tmp/probe-*-pty-*.txt")
