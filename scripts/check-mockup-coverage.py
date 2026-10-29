import re, pathlib, json
t = pathlib.Path('mockup.html').read_text(encoding='utf-8')
i = t.find('const englishCopy=')
j = t.index('{', i)
depth = 0; in_str = False; esc = False; k = j
while k < len(t):
    c = t[k]
    if in_str:
        if esc: esc = False
        elif c == '\\': esc = True
        elif c == '"': in_str = False
    else:
        if c == '"': in_str = True
        elif c == '{': depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0: break
    k += 1
body = t[j:k+1]
pairs = dict(re.findall(r'"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"', body))
print("dict entries:", len(pairs))

# collect all string literals in the file (single & double quoted) outside the dict
rest = t[:i] + t[k+1:]
lits = set()
for m in re.finditer(r'"((?:[^"\\\n]|\\.)*)"', rest):
    lits.add(m.group(1))
for m in re.finditer(r"'((?:[^'\\\n]|\\.)*)'", rest):
    lits.add(m.group(1))
print("candidate literals:", len(lits))

indo_markers = re.compile(r'\b(dan|yang|untuk|dengan|adalah|sebagai|serta|melalui|menjadi|tidak|belum|sudah|harus|dapat|hanya|lebih|semua|setiap|karena|jika|ketika|sebelum|setelah|antara|kita|kamu|Anda|anda|saya|ini|itu|atau|juga|telah|akan|ada|oleh|untuk|saat|bagi|atas|bawah|ulang|baru|lama|tahap|bagian|menjadi|tetap|keputusan|duck)\b', re.I)
cand = [s for s in lits if len(s) > 2 and indo_markers.search(s)]
missing = sorted(s for s in cand if s not in pairs)
present = sorted(s for s in cand if s in pairs)
print("indo-looking literals:", len(cand))
print("  covered by englishCopy:", len(present))
print("  NOT covered:", len(missing))
for s in missing:
    print("   MISS:", s[:160])
