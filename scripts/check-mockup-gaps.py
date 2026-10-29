import re, pathlib
t = pathlib.Path('mockup.html').read_text(encoding='utf-8')

def extract_object(src, start_kw):
    i = src.find(start_kw)
    if i < 0: return None, None
    j = src.index('{', i)
    depth=0; in_str=False; esc=False; k=j
    while k < len(src):
        c = src[k]
        if in_str:
            if esc: esc=False
            elif c=='\\': esc=True
            elif c=='"': in_str=False
        else:
            if c=='"': in_str=True
            elif c=='{': depth+=1
            elif c=='}':
                depth-=1
                if depth==0: break
        k+=1
    return src[j:k+1], k

body1, end1 = extract_object(t, 'const englishCopy=')
body2, _ = extract_object(t, 'Object.assign(englishCopy,')
pairs = re.findall(r'["\']((?:[^"\'\\]|\\.)*)["\']\s*:\s*["\']((?:[^"\'\\]|\\.)*)["\']', body1)
if body2: pairs += re.findall(r'["\']((?:[^"\'\\]|\\.)*)["\']\s*:\s*["\']((?:[^"\'\\]|\\.)*)["\']', body2)
pairs = [(a,b) for a,b in pairs if a and b]
dict_keys = set(a for a,b in pairs)
print("total dict entries:", len(pairs), "unique:", len(dict_keys))

# Also collect regex special-case keys inside englishText
rest = t[end1+1:]
# split source into HTML body + script region for literal scanning
lits = set()
for m in re.finditer(r'"((?:[^"\\\n]|\\.)*)"', t): lits.add(m.group(1))
for m in re.finditer(r"'((?:[^'\\\n]|\\.)*)'", t): lits.add(m.group(1))

INDO = re.compile(r"\b(dan|yang|untuk|dengan|adalah|sebagai|serta|melalui|menjadi|tidak|belum|sudah|harus|dapat|hanya|lebih|semua|setiap|karena|jika|ketika|sebelum|setelah|antara|kita|kamu|Anda|anda|saya|ini|itu|atau|juga|telah|akan|oleh|saat|bagi|atas|bawah|ulang|baru|lama|tahap|bagian|tetap|resmi|peserta|keputusan|penggunaan|ketentuan)\b", re.I)

def norm(s): return re.sub(r'\s+',' ',s).strip()
d_norm = {norm(k): v for k,v in pairs}

missing = []
for s in sorted(lits):
    if len(s) < 4: continue
    if not INDO.search(s): continue
    if norm(s) in d_norm: continue
    # maybe covered as a substring of a dict key or vice versa
    missing.append(s)

print("indo literals not directly in dict:", len(missing))
# classify: those that contain HTML markup
htmlish = [s for s in missing if '<' in s]
plain = [s for s in missing if '<' not in s]
print("  with HTML markup:", len(htmlish))
print("  plain text:", len(plain))
for s in plain: print("   PLAIN:", s[:150])
