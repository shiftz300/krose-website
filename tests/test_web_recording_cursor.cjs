'use strict';
const assert=require('node:assert/strict');
const {MidiRecorder,recordingPrefix,validTake,encodeMidi,parseMidi}=require('../public/midi-recorder.js');
const original={id:'original',name:'My take',soundId:'A000',soundName:'Piano',duration:8,events:[
 {time:0,type:'on',note:60,velocity:80,channel:2},
 {time:1,type:'pedal',on:true,channel:2},
 {time:2,type:'on',note:60,velocity:70,channel:2},
 {time:3,type:'off',note:60,velocity:0,channel:2},
 {time:6,type:'off',note:60,velocity:0,channel:2},
 {time:7,type:'on',note:72,velocity:90},
 {time:8,type:'off',note:72,velocity:0},
]};
const prefix=recordingPrefix(original,4);
assert.equal(prefix.filter(e=>e.type==='on').length,2);
assert(prefix.some(e=>e.time===4&&e.type==='off'&&e.channel===2));
assert(prefix.some(e=>e.time===4&&e.type==='pedal'&&!e.on&&e.channel===2));
assert.equal(recordingPrefix(original,0).length,0);
assert.deepEqual(recordingPrefix({...original,events:[]},0),[]);
let clock=100;
const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,{textContent:''});return elements.get(id)};
function recorder(takes,cursor){
 const r=Object.create(MidiRecorder.prototype);
 Object.assign(r,{takes:structuredClone(takes),selected:takes[0]?.id||null,cursor,cursorTake:takes[0]?.id||null,active:null,starting:false,intent:0,history:new Map(),el,save(){this.saved=(this.saved||0)+1},render(){},soundChanged(){},hooks:{clock:()=>clock,ready:()=>true,prepareAudio:async()=>{},getSound:()=>({soundId:'A000',soundName:'Piano'}),stopAudio:()=>{}}});return r;
}
(async()=>{
 const r=recorder([original],8);
 await r.start();assert.equal(r.active.start,92);clock=101;r.noteOn('test',64,100);clock=102;r.noteOff('test');r.finish();
 assert.equal(r.takes.length,1);assert.equal(r.takes[0].id,'original');assert.equal(r.takes[0].name,'My take');assert.equal(r.takes[0].duration,10);assert.equal(r.cursor,10);
 assert.deepEqual(r.takes[0].events.slice(0,original.events.length),original.events);
 assert(r.takes[0].events.some(e=>e.type==='on'&&e.note===64&&e.time===9));
 assert(validTake(r.takes[0]));assert.equal(parseMidi(encodeMidi(r.takes[0])).duration,10);
 r.cursor=4;await r.start();clock+=1;r.noteOn('replace',67,100);clock+=1;r.finish();
 assert.equal(r.takes[0].duration,6);assert.equal(r.takes.length,1);assert.equal(r.cursor,6);
 assert(!r.takes[0].events.some(e=>e.note===72||e.note===64));
 assert(r.takes[0].events.some(e=>e.type==='off'&&e.note===60&&e.time===4));
 assert(r.takes[0].events.some(e=>e.type==='off'&&e.note===67&&e.time===6));
 assert(validTake(r.takes[0]));
 r.undo();assert.equal(r.takes[0].duration,10);assert(r.takes[0].events.some(e=>e.note===72));
 const empty=recorder([],0);await empty.start();assert.equal(empty.takes.length,1);assert.equal(empty.takes[0].name,'录音 01');clock+=.5;empty.finish();assert.equal(empty.takes.length,1);assert.equal(empty.takes[0].duration,.5);
 const created=empty.createTake('Named');assert.equal(created.name,'Named');assert.equal(empty.selected,created.id);assert.equal(empty.cursor,0);assert.equal(created.duration,0);
 const next=empty.createTake();assert.equal(next.name,'录音 02');
 console.log('PASS: append, cursor overwrite, paired cross-boundary notes/pedal, undo, MIDI export, empty auto-create and named takes.');
})().catch(e=>{console.error(e);process.exitCode=1});
