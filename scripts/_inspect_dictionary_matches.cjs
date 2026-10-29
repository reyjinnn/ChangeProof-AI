const fs=require('node:fs');
const ts=require('typescript');
const text=fs.readFileSync('mockup.html','utf8');
const i=text.indexOf('const englishCopy=');
const mapStart=text.indexOf('{',i);
let d=0,q=false,esc=false,k=mapStart;
for(;k<text.length;k++){const c=text[k];if(q){if(esc)esc=false;else if(c==='\\')esc=true;else if(c==='"')q=false;}else{if(c==='"')q=true;else if(c==='{')d++;else if(c==='}'&&--d===0)break;}}
const raw=text.slice(mapStart,k+1);
const pairs=[...raw.matchAll(/"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map(m=>[JSON.parse('"'+m[1]+'"'),JSON.parse('"'+m[2]+'"')]);
const dict=new Map(); for(const [a,b] of pairs)if(!dict.has(a))dict.set(a,b);
const starts=[...text.matchAll(/<script(?:\s[^>]*)?>/g)].map(m=>m.index+m[0].length);
const ends=[...text.matchAll(/<\/script>/g)].map(m=>m.index);
const counts={scripts:starts.length, exactString:0, exactTemplateChunk:0, strings:0, chunks:0, missing:[]};
for(let z=0;z<starts.length;z++){
 const a=starts[z], b=ends[z]; if(!b||a>=i)continue;
 const js=text.slice(a,b); const scanner=ts.createScanner(ts.ScriptTarget.Latest,false,ts.LanguageVariant.Standard,js);
 let token;while((token=scanner.scan())!==ts.SyntaxKind.EndOfFileToken){
  if(token===ts.SyntaxKind.StringLiteral){counts.strings++;const v=scanner.getTokenValue();if(dict.has(v))counts.exactString++;else if(/[\u0080-￿]/.test(v)){} }
  else if(token===ts.SyntaxKind.NoSubstitutionTemplateLiteral){counts.chunks++;const v=scanner.getTokenValue();if(dict.has(v))counts.exactTemplateChunk++;}
  else if([ts.SyntaxKind.TemplateHead,ts.SyntaxKind.TemplateMiddle,ts.SyntaxKind.TemplateTail].includes(token)){counts.chunks++;const v=scanner.getTokenValue();if(dict.has(v))counts.exactTemplateChunk++;}
 }
}
console.log(counts);
