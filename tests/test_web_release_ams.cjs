'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {ReleaseAMS,mod}=require('../public/release-ams.js');
const read=p=>JSON.parse(fs.readFileSync(p));
const catalog=read(require.resolve('../public/catalog.json'));
const data={ams_tables:catalog.releaseAMSTables,profiles:catalog.releaseProfiles,ams_configs:Object.fromEntries(catalog.programs.map(p=>[p.id,p.release_ams]))};
const fixture=read(require.resolve('./fixtures/release-ams.json'));
const engine=new ReleaseAMS(data.ams_tables);
for(const row of fixture.coefficients||[])assert.equal(engine.coefficient(row.curve,row.steps),row.value,`curve ${row.curve} steps ${row.steps}`);
for(const row of fixture.cases){
 const config=data.ams_configs[row.program][row.waveform];engine.reset();engine.seconds=row.seconds;
 for(const [controller,value] of Object.entries(row.cc))engine.update('test',{type:'cc',controller:Number(controller),value});
 const values={};for(const id of Object.keys(row.sources))values[id]=engine.source(Number(id),config,row.note,row.velocity,engine.state('test'));
 assert.deepEqual(values,row.sources,`${row.program}/${row.waveform} note ${row.note}: AMS source`);
 const modulation=config.time_ams.reduce((sum,e)=>sum+12*mod(e.intensity,values[e.source]||0),0);
 assert.equal(engine.duration(config.base_units,modulation),row.units,`${row.program}/${row.waveform}: release duration`);
}
for(const [key,original] of Object.entries(data.profiles)){
 const config={base_units:Math.round(original.base_seconds*1500),curve:original.curve_index,time_ams:[]};const actual=engine.profile(config,60,100);
 assert.equal(actual.seconds,original.seconds,key);assert.equal(actual.values.length,original.values.length,key);
 actual.values.forEach((value,i)=>assert(Math.abs(value-original.values[i])<.000001,`${key} curve ${i}`));
}
const config=data.ams_configs.B097.MS365;engine.reset();engine.seconds=0;
const soft=engine.profile(config,36,20),hard=engine.profile(config,96,127);
assert.notEqual(soft.units,hard.units);engine.update('local',{type:'cc',controller:17,value:127});const knob=engine.profile(config,96,127);assert.notEqual(knob.units,hard.units);
engine.update('other',{type:'cc',controller:17,value:0});assert.equal(engine.profile(config,96,127).units,knob.units);
const {encodeMidi,parseMidi,recordingPrefix}=require('../public/midi-recorder.js');
const events=[{time:0,type:'on',note:60,velocity:90,channel:3},{time:.2,type:'cc',controller:17,value:100,channel:3},{time:.3,type:'bend',value:12345,channel:3},{time:.4,type:'pressure',value:42,channel:3},{time:.5,type:'polyPressure',note:60,value:70,channel:3},{time:.6,type:'cc',controller:64,value:127,channel:3},{time:1,type:'off',note:60,velocity:0,channel:3}];
const round=parseMidi(encodeMidi({id:'test',soundId:'B097',duration:1,events}));
for(const e of events.filter(e=>['cc','bend','pressure','polyPressure'].includes(e.type)&&e.controller!==64))assert(round.events.some(r=>r.type===e.type&&r.value===e.value&&r.channel===e.channel));
assert(recordingPrefix({duration:1,events},.8).some(e=>e.type==='pedal'&&!e.on&&e.channel===3));
console.log(`PASS: ${fixture.cases.length} original ARM source/duration cases, 157 release curves, live CC/channel separation, MIDI controller roundtrip and overwrite pedal closure.`);
