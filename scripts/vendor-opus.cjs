const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const source=path.join(root,'node_modules/ogg-opus-decoder/dist/ogg-opus-decoder.min.js');
const bytes=fs.readFileSync(source);
assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),'c5055d3410ca02728d10708e154b47219c38ceef52155f18702e34204150651f','Unexpected Opus vendor bundle; review before updating');
fs.mkdirSync(path.join(root,'public/vendor'),{recursive:true});
fs.writeFileSync(path.join(root,'public/vendor/ogg-opus-decoder-1.7.5.min.js'),bytes);
fs.copyFileSync(path.join(root,'node_modules/ogg-opus-decoder/dist/ogg-opus-decoder.min.js.map'),path.join(root,'public/vendor/ogg-opus-decoder.min.js.map'));
