import re, pathlib, json, sys
t = pathlib.Path('mockup.html').read_text(encoding='utf-8')
i = t.find('const englishCopy=')
# find the matching closing brace of the object literal
j = t.index('{', i)
depth = 0
in_str = False
esc = False
k = j
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
            if depth == 0:
                break
    k += 1
body = t[j:k+1]
# parse key:"value" pairs
pairs = re.findall(r'"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"', body)
print("dict pairs:", len(pairs))
keys = [p[0] for p in pairs]
print("unique keys:", len(set(keys)))
dups = [k for k in set(keys) if keys.count(k) > 1]
print("dup keys:", len(dups))
for d in dups[:10]: print("  DUP:", d[:80])
# how many keys are non-Indonesian-looking (i.e. already English)?
indo_words = set("""yang dan untuk dengan adalah sebagai serta melalui menjadi tidak ada ini itu dari ke pada atau juga telah akan dapat dalam oleh saat bagi atas bawah baru""".split())
nonindo = [k for k in keys if not any(w.lower() in indo_words for w in re.findall(r"[A-Za-z']+", k))]
print("keys with no indo word:", len(nonindo))
for x in nonindo[:25]: print("   ", x[:90])
print("--- total mockup size:", len(t))
