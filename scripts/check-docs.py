import re, pathlib, sys
root = pathlib.Path('.')
BS = chr(92)
def norm(p): return str(p).replace(BS, '/')
def slug(h):
    # GitHub slugger: lowercase, strip anything that is not a word char / space / hyphen,
    # then map EACH space to a hyphen (no collapsing — "a → b" becomes "a--b").
    s = h.strip().lower()
    s = re.sub(r'[^\w\s-]', '', s, flags=re.UNICODE)
    return s.replace(' ', '-')

files = [f for f in sorted(root.rglob('*.md')) if 'node_modules' not in norm(f)]

anchors = {}
for f in files:
    t = f.read_text(encoding='utf-8')
    a = set()
    for line in t.splitlines():
        m = re.match(r'^(#{1,6})\s+(.*)$', line)
        if m: a.add(slug(m.group(2)))
        for mm in re.finditer(r'<a\s+id="([^"]+)"', line): a.add(mm.group(1))
    anchors[norm(f)] = a

bad_file, bad_anchor, ok = [], [], 0
for f in files:
    t = f.read_text(encoding='utf-8')
    base = f.parent
    for m in re.finditer(r'\[([^\]]*)\]\(([^)\s]+)\)', t):
        link = m.group(2)
        if link.startswith('http') or link.startswith('mailto'): continue
        path, _, frag = link.partition('#')
        target = None
        if path == '':
            target = norm(f)
        else:
            cands = []
            p1 = base / path
            p2 = root / path
            p3 = root / '.prepare' / pathlib.Path(path).name
            for p in (p1, p2, p3):
                if p.exists():
                    try: cands.append(norm(p.resolve().relative_to(root.resolve())))
                    except Exception: cands.append(norm(p))
            if cands:
                target = cands[0]
            else:
                bad_file.append((norm(f), link)); continue
        if frag:
            if target in anchors and frag not in anchors[target]:
                bad_anchor.append((norm(f), link, target))
            elif target not in anchors:
                bad_file.append((norm(f), link))
            else:
                ok += 1
        else:
            ok += 1

print("FILES", len(files), "OK", ok, "BROKEN_FILE", len(bad_file), "BROKEN_ANCHOR", len(bad_anchor))
print("--- BROKEN FILE ---")
for b in bad_file: print(" ", b[0], "->", b[1])
print("--- BROKEN ANCHOR ---")
for b in bad_anchor: print(" ", b[0], "->", b[1], "  (target", b[2] + ")")

# headings inventory: Indonesian-looking headings
print("--- HEADINGS WITH NON-ASCII / INDONESIAN MARKERS ---")
indo = set("""dan yang untuk dengan adalah sebagai serta melalui menjadi tidak ada ini itu dari ke pada atau juga telah dapat dalam oleh bagi atas keputusan panduan prioritas cakupan risiko kuota layanan acara ketentuan kontribusi persiapan perencanaan pembaruan penyelarasan revisi tinjauan laporan dokumen verifikasi perubahan peserta""".split())
for f in files:
    t = f.read_text(encoding='utf-8')
    for i, line in enumerate(t.splitlines(), 1):
        m = re.match(r'^(#{1,6})\s+(.*)$', line)
        if not m: continue
        h = m.group(2)
        toks = [w.lower() for w in re.findall(r"[A-Za-z']+", h)]
        if any(w in indo for w in toks):
            print(f"  {norm(f)}:{i}: {h}")
