import re
import os

def patch_file(path):
    print(f"Patching {path}")
    with open(path, 'r') as f:
        content = f.read()

    # Remove the anti-devtools setInterval loop
    # Pattern: setInterval(function(){ ... performance ... }, 0x7d0)
    # We'll look for the whole block from setInterval to its closing );

    # This regex looks for setInterval followed by function, some content including performance, and ends with 0x7d0);}
    content = re.sub(r'setInterval\(function\(\)\{.*?performance.*?\},0x7d0\);', '/* Anti-F12 Disabled */', content, flags=re.DOTALL)

    # Also catch variant with different timing or spacing
    content = re.sub(r'setInterval\(function\(\)\{.*?debugger.*?\},.*?\);', '/* Anti-F12 Variant Disabled */', content, flags=re.DOTALL)

    # Ensure no lingering debugger statements
    content = content.replace('debugger;', '')

    with open(path, 'w') as f:
        f.write(content)

patch_file('fond_heberge_huggingface/public/script_streaming.js')
patch_file('fond_heberge_huggingface/public/script_iptv.js')
