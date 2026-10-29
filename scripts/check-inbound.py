import re, pathlib, collections
root = pathlib.Path('.')
BS = chr(92)
def norm(p): return str(p).replace(BS, '/')
files = [f for f in sorted(root.rglob('*.md')) if 'node_modules' not in norm(f)]

inbound = collections.defaultdict(lambda: collections.defaultdict(set))
for f in files:
    t = f.read_text(encoding='utf-8')
    base = f.parent
    for m in re.finditer(r'\[([^\]]*)\]\(([^)\s]+)\)', t):
        link = m.group(2)
        if link.startswith('http'): continue
        path, _, frag = link.partition('#')
        if not frag: continue
        if path == '': target = norm(f)
        else:
            cands = []
            for p in (base / path, root / path, root / '.prepare' / pathlib.Path(path).name):
                if p.exists():
                    try: cands.append(norm(p.resolve().relative_to(root.resolve())))
                    except Exception: cands.append(norm(p))
            if not cands: continue
            target = cands[0]
        inbound[target][frag].add(norm(f))

for t in sorted(inbound):
    print(f"== {t}  ({len(inbound[t])} distinct inbound fragments)")
    for frag in sorted(inbound[t]):
        print(f"   #{frag}   <- {', '.join(sorted(inbound[t][frag]))}")
