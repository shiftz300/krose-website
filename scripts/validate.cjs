'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../public'),catalog=JSON.parse(fs.readFileSync(path.join(root,'catalog.json')));
const files=fs.readdirSync(root,{recursive:true}).filter(p=>fs.statSync(path.join(root,p)).isFile());
assert(files.length<20000);for(const f of files)assert(fs.statSync(path.join(root,f)).size<25*1024*1024,f);
for(const p of catalog.packs){const absolute=path.resolve(root,p.file);assert(absolute.startsWith(root+path.sep));const b=fs.readFileSync(absolute);assert.equal(b.length,p.bytes);assert.equal(crypto.createHash('sha256').update(b).digest('hex'),p.sha256,p.file);}
for(const [id,s] of Object.entries(catalog.samples)){const p=catalog.packs[s.pack];assert(p&&s.offset>=0&&s.length>0&&s.offset+s.length<=p.bytes,id);}
for(const file of files.filter(p=>p.endsWith('.js'))){const r=spawnSync(process.execPath,['--check',path.join(root,file)],{stdio:'inherit'});assert.equal(r.status,0,file);}
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)){const name=match[1];if(!/^(https?:|data:)/.test(name))assert(fs.existsSync(path.resolve(root,name.split('?')[0])),name);}
assert(html.includes('https://github.com/shiftz300/krose-website'));
console.log(`Validated ${files.length} static files, ${catalog.packs.length} audio packs, ${Object.keys(catalog.samples).length} samples. Output: public/`);
