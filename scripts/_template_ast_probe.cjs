const ts = require('typescript');
const s = ts.createSourceFile('x.js', 'const x=`abc ${foo} def`; const y=`<p>hello</p>`;', ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function v(n) {
  if ([ts.SyntaxKind.TemplateHead, ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail, ts.SyntaxKind.NoSubstitutionTemplateLiteral].includes(n.kind)) console.log(ts.SyntaxKind[n.kind], JSON.stringify(n.getText(s)), JSON.stringify(n.text), JSON.stringify(n.rawText));
  ts.forEachChild(n, v);
}
v(s);
