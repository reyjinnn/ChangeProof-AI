const fs = require('node:fs');
const ts = require('typescript');
const text = fs.readFileSync('mockup.html', 'utf8');
const dictionaryStart = text.indexOf('const englishCopy=');
const dictionaryOpen = text.indexOf('{', dictionaryStart);
let depth = 0, inString = false, escaped = false, dictionaryEnd = dictionaryOpen;
for (; dictionaryEnd < text.length; dictionaryEnd++) {
  const c = text[dictionaryEnd];
  if (inString) {
    if (escaped) escaped = false;
    else if (c === '\\') escaped = true;
    else if (c === '"') inString = false;
  } else if (c === '"') inString = true;
  else if (c === '{') depth++;
  else if (c === '}' && --depth === 0) break;
}
const rawMap = text.slice(dictionaryOpen, dictionaryEnd + 1);
const pairs = [...rawMap.matchAll(/"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"/g)]
  .map(m => [JSON.parse('"' + m[1] + '"'), JSON.parse('"' + m[2] + '"')]);
const translations = new Map();
for (const [source, english] of pairs) if (!translations.has(source)) translations.set(source, english);

const scriptTags = [...text.matchAll(/<script(?:\s[^>]*)?>/g)];
const scriptEnds = [...text.matchAll(/<\/script>/g)];
const edits = [];
const stats = {scripts: 0, strings: 0, exactTranslations: 0, changed: 0, untranslated: []};
function applyPhraseTranslations(value) {
  const phrases = [...translations.entries()]
    .filter(([source, english]) => source !== english && source.trim().length >= 5 && source.includes(' '))
    .sort((a, b) => b[0].length - a[0].length);
  for (const [source, english] of phrases) value = value.split(source).join(english);
  return value;
}
function replaceHtmlText(value) {
  return value.replace(/>([^<>]+)</g, (whole, text) => {
    const translated = applyPhraseTranslations(text);
    return translated === text ? whole : `>${translated}<`;
  });
}

for (let s = 0; s < scriptTags.length; s++) {
  const start = scriptTags[s].index + scriptTags[s][0].length;
  const end = scriptEnds[s]?.index;
  if (end == null || start >= dictionaryStart) continue;
  const source = ts.createSourceFile(`mockup-script-${s}.js`, text.slice(start, end), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  stats.scripts++;
  function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      stats.strings++;
      const value = node.text;
      let english = translations.has(value) ? translations.get(value) : undefined;
      if (english === undefined && ts.isNoSubstitutionTemplateLiteral(node)) english = replaceHtmlText(value);
      if (english !== undefined && english !== value) {
        const literal = ts.isStringLiteral(node)
          ? `'${english.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`
          : '`' + english.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${') + '`';
        edits.push({start: start + node.getStart(source), end: start + node.end, text: literal});
        stats.changed++;
        if (translations.has(value)) stats.exactTranslations++;
      } else if (/\b(?:yang|dengan|untuk|adalah|tidak|belum|sudah|seluruh|semua|setiap|atau|dari|dalam|kamu|anda|saya|perubahan|repositori|pengguna|menjadi|harus|dapat)\b/i.test(value)) {
        stats.untranslated.push(value);
      }
    } else if (ts.isTemplateExpression(node)) {
      const chunkEdits = [];
      const literals = [node.head, ...node.templateSpans.map(span => span.literal)];
      for (const literal of literals) {
        const prefix = ts.isTemplateHead(literal) ? 1 : 2;
        const suffix = ts.isTemplateTail(literal) ? 1 : 2;
        const chunk = literal.text;
        const translated = replaceHtmlText(chunk);
        if (translated !== chunk) {
          const escaped = translated.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
          chunkEdits.push({start: start + literal.getStart(source) + prefix, end: start + literal.end - suffix, text: escaped});
          stats.changed++;
        } else if (/\b(?:yang|dengan|untuk|adalah|tidak|belum|sudah|seluruh|semua|setiap|atau|dari|dalam|kamu|anda|saya|perubahan|repositori|pengguna|menjadi|harus|dapat)\b/i.test(chunk)) {
          stats.untranslated.push(chunk);
        }
      }
      edits.push(...chunkEdits);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

let output = text;
for (const edit of edits.sort((a, b) => b.start - a.start)) {
  output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
}
console.log(JSON.stringify({...stats, uniqueUntranslated: [...new Set(stats.untranslated)].slice(0, 120), proposedEdits: edits.length}, null, 2));
if (process.argv.includes('--write')) {
  fs.writeFileSync('mockup.ast-candidate.html', output, 'utf8');
  console.log('Candidate: mockup.ast-candidate.html');
}
