import os

def patch_streaming():
    path = 'fond_heberge_huggingface/public/script_streaming.js'
    if not os.path.exists(path): return
    with open(path, 'r') as f:
        content = f.read()

    # Target the anti-devtools check
    target = 'var _0x2a85e6=performance[_0x360dd4(0x18e)]();debugger;performance[_0x360dd4(0x18e)]()-_0x2a85e6>0x64&&++_0x4607d9>0x2&&(document[_0x360dd4(0x279)][_0x360dd4(0x26a)]=_0x360dd4(0x132));'
    if target in content:
        print("Found target in streaming script")
        content = content.replace(target, '/* Security Check Disabled */')
    else:
        # Try a more generic match if exact fails due to previous partial replacements
        import re
        content = re.sub(r'var _0x2a85e6=performance\[.*?\]\(\);debugger;performance\[.*?\]\(\)-_0x2a85e6>0x64&&.*?&&\(document\[.*?\]\[.*?\]=.*?\);', '/* Generic Security Check Disabled */', content)
        # Also clean up any lingering 'debugger;'
        content = content.replace('debugger;', '')

    with open(path, 'w') as f:
        f.write(content)

def patch_iptv():
    path = 'fond_heberge_huggingface/public/script_iptv.js'
    if not os.path.exists(path): return
    with open(path, 'r') as f:
        content = f.read()

    target = 'var _0x55b69f=performance[_0x533fae(0x2e5)]();debugger;performance[_0x533fae(0x2e5)]()-_0x55b69f>0x64&&++_0x4c5a80>0x2&&(document[_0x533fae(0x366)][_0x533fae(0x1b2)]=_0x533fae(0x228));'
    if target in content:
        print("Found target in IPTV script")
        content = content.replace(target, '/* Security Check Disabled */')
    else:
        import re
        content = re.sub(r'var _0x55b69f=performance\[.*?\]\(\);debugger;performance\[.*?\]\(\)-_0x55b69f>0x64&&.*?&&\(document\[.*?\]\[.*?\]=.*?\);', '/* Generic Security Check Disabled */', content)
        content = content.replace('debugger;', '')

    with open(path, 'w') as f:
        f.write(content)

patch_streaming()
patch_iptv()
