import re, pathlib, sys
root = pathlib.Path('.')
BS = chr(92)
def norm(p): return str(p).replace(BS, '/')
def slug(h):
    s = h.strip().lower()
    s = re.sub(r'[^\w\s-]', '', s, flags=re.UNICODE)
    return s.replace(' ', '-')
anchors = {}
for f in sorted(root.rglob('*.md')):
    if 'node_modules' in norm(f): continue
    t = f.read_text(encoding='utf-8')
    a = set()
    for line in t.splitlines():
        m = re.match(r'^(#{1,6})\s+(.*)$', line)
        if m: a.add(slug(m.group(2)))
        for mm in re.finditer(r'<a\s+id="([^"]+)"', line): a.add(mm.group(1))
    anchors[norm(f)] = a
bad = []
for f in sorted(root.rglob('*.md')):
    if 'node_modules' in norm(f): continue
    t = f.read_text(encoding='utf-8')
    base = f.parent
    for m in re.finditer(r'\[([^\]]*)\]\(([^)\s]+)\)', t):
        link = m.group(2)
        if link.startswith('http'): continue
        path, _, frag = link.partition('#')
        if path == '':
            target = norm(f)
        else:
            p = base / path
            if not p.exists():
                # Root-relative convention: this package writes links from the repo root
                p = root / path
            if not p.exists():
                bad.append((norm(f), link, 'FILE MISSING')); continue
            try: target = norm(p.resolve().relative_to(root.resolve()))
            except Exception: target = norm(p)
        if frag:
            if target in anchors and frag not in anchors[target]:
                bad.append((norm(f), link, 'ANCHOR MISSING'))
            elif target not in anchors:
                bad.append((norm(f), link, 'UNKNOWN TARGET'))
print("total anchors:", sum(len(v) for v in anchors.values()))
print("broken:", len(bad))
for b in bad: print("  ", b[0], "->", b[1], "|", b[2])
