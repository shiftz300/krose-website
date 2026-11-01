'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {encodeMidi,parseMidi,extractNotes,editNote,validTake,vlq}=require('../public/midi-recorder.js');
const base={id:'codec-test',soundId:'A000',soundName:'Piano',duration:2,events:[
  {time:0,type:'on',note:60,velocity:84,channel:0},
  {time:.125,type:'on',note:60,velocity:100,channel:1},
  {time:.25,type:'pedal',on:true,channel:0},
  {time:.5,type:'off',note:60,velocity:0,channel:0},
  {time:.75,type:'off',note:60,velocity:0,channel:1},
  {time:1,type:'pedal',on:false,channel:0}
]};
const parsed=parseMidi(encodeMidi(base));
assert.deepEqual(parsed.events.filter(e=>e.type!=='pedal'),base.events.filter(e=>e.type!=='pedal'));
assert.equal(extractNotes(parsed.events,parsed.duration).length,2);
assert.equal(parsed.duration,2);assert(validTake(base));
const edit=editNote(base,0,{start:1.7,duration:.8,note:67});
assert.equal(edit.duration,2.5);assert.equal(extractNotes(edit.events,edit.duration).find(n=>n.note===67).end,2.5);
assert.equal(base.events[0].note,60);assert.equal(edit.events.find(e=>e.note===67).channel,0);
assert.throws(()=>parseMidi(encodeMidi(base).slice(0,-2)));
assert.throws(()=>vlq(0x10000000));assert.deepEqual(vlq(0x2000),[192,0]);
const results=[];
for(const file of ['debussy_clair_de_lune_mutopia.mid','chopin_nocturne_op9_no2_mutopia.mid','satie_gymnopedie_no1_mutopia.mid']){
  const input=path.resolve(__dirname,'fixtures',file);
  const original=parseMidi(fs.readFileSync(input)),round=parseMidi(encodeMidi({...base,...original}));
  const a=extractNotes(original.events,original.duration),b=extractNotes(round.events,round.duration);assert.equal(a.length,b.length);
  for(let i=0;i<a.length;i++){assert.equal(a[i].note,b[i].note);assert.equal(a[i].velocity,b[i].velocity);assert(Math.abs(a[i].start-b[i].start)<=1/960);assert(Math.abs(a[i].end-b[i].end)<=1/960)}
  results.push({file,notes:a.length,duration:original.duration});
}
fs.mkdirSync(path.resolve(__dirname,'../.tmp/web-midi'),{recursive:true});
fs.writeFileSync(path.resolve(__dirname,'../.tmp/web-midi/import-test.mid'),encodeMidi(base));
console.log(JSON.stringify({codec:'passed',channelPairing:'passed',editing:'passed',realFileRoundtrips:results},null,2));

// Editing one very short click must not move another note-off ahead of its note-on.
const clicks={...base,events:[{time:0,type:'on',note:60,velocity:90},{time:0,type:'off',note:60,velocity:0},{time:.3,type:'on',note:64,velocity:90},{time:.3,type:'off',note:64,velocity:0}]};
const moved=editNote(clicks,0,{start:.1,note:63});
assert.equal(extractNotes(moved.events,moved.duration).find(n=>n.note===64).end,.31);
