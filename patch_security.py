import re
import os

def patch_file(filepath):
    print(f"Patching {filepath}...")
    with open(filepath, 'r') as f:
        content = f.read()

    # 1. Neutralize debugger statements
    content = content.replace('debugger;', '')

    # 2. Force the performance timing check to always be false
    # Pattern: performance[...]() - ... > 0x64
    # We'll just replace the whole comparison with 'false'
    # It usually looks like: performance[_0xXXXX(0xXXXX)]() - _0xXXXX > 0x64
    # Since the variables change, let's use a regex.

    # Replacement for script_streaming.js
    content = re.sub(r'performance\[_0x[0-9a-f]+\(0x[0-9a-f]+\)\]\(\)\s*-\s*_0x[0-9a-f]+\s*>\s*0x64', 'false', content)

    # Replacement for script_iptv.js (might have different spacing/vars)
    # Re-running same regex should work if it's consistent.

    # 3. Ensure we don't accidentally break something else by making the regex too greedy
    # If the above fails, let's try a more specific one for each file based on my observations.

    if "script_streaming.js" in filepath:
        content = content.replace('performance[_0x360dd4(0x18e)]()', 'performance.now()')
    elif "script_iptv.js" in filepath:
        content = content.replace('performance[_0x533fae(0x2e5)]()', 'performance.now()')

    with open(filepath, 'w') as f:
        f.write(content)
    print(f"Finished patching {filepath}")

patch_file('fond_heberge_huggingface/public/script_streaming.js')
patch_file('fond_heberge_huggingface/public/script_iptv.js')
