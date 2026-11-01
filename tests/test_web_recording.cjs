'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {MidiRecorder,MAX_RECORD_SECONDS,validTake,encodeMidi,parseMidi}=require('../public/midi-recorder.js');
// Advance the audio clock across the limit, with a key and pedal still held.
let clock=599.9,stopped=0,saved=0;
const message={textContent:''},r=Object.create(MidiRecorder.prototype);
Object.assign(r,{hooks:{clock:()=>clock,stopAudio:()=>stopped++},active:{id:'limit',start:0,soundId:'A000',events:[{time:599,type:'on',note:60,velocity:90},{time:599.5,type:'pedal',on:true}],held:new Map([['held',60]])},takes:[],save:()=>saved++,render:()=>{},el:()=>message});
assert.equal(r.checkLimit(),false);clock=600.2;r.noteOn('late',64,100);
assert.equal(MAX_RECORD_SECONDS,600);assert.equal(r.active,null);assert.equal(stopped,1);assert.equal(saved,1);
assert.equal(r.takes[0].duration,600);assert(validTake(r.takes[0]));assert.equal(r.takes[0].events.filter(e=>e.type==='on').length,1);
const round=parseMidi(encodeMidi(r.takes[0]));assert(round.events.some(e=>e.type==='off'&&e.time===600));assert(round.events.some(e=>e.type==='pedal'&&!e.on&&e.time===600));
// The live renderer must retain its DOM and process append-only events once.
let created=0,replaced=0;
const context=new Proxy({},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
const element=()=>({style:{},classList:{add(){},remove(){}},append(){},prepend(){},setAttribute(){},replaceChildren(){replaced++},getContext:()=>context});
const elements=new Map(),document={getElementById:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id)},createElement:()=>{created++;return element()},createElementNS:()=>{created++;return element()}};
const sandbox={window:{},document,performance};vm.runInNewContext(fs.readFileSync(require.resolve('../public/piano-roll.js'),'utf8'),sandbox);
const roll=new sandbox.window.KroseRoll({takeId:()=>null,notes:()=>{throw Error('Live view reparsed history')}});
const events=[];for(let i=0;i<6000;i++){events.push({time:i*.09,type:'on',note:48+i%36,velocity:90});events.push({time:i*.09+.04,type:'off',note:48+i%36})}
const initialCreated=created;roll.draw(events,540,true);const notes=roll.liveNotes;
for(let i=0;i<60;i++)roll.draw(events,540+i/30,true);
assert.equal(roll.liveNotes,notes);assert.equal(roll.liveNotes.length,6000);assert.equal(roll.liveIndex,12000);assert.equal(created,initialCreated);assert.equal(replaced,0);
events.push({time:542,type:'on',note:64,velocity:99});roll.draw(events,542.1,true);assert.equal(roll.liveNotes.length,6001);assert.equal(roll.liveIndex,12001);
console.log('PASS: 10-minute limit, held-note/pedal closure, MIDI export, 6000-note incremental live rendering with zero DOM rebuilds.');
