'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const data=JSON.parse(fs.readFileSync(require.resolve('../public/catalog.json')));
const elements=new Map(),element=()=>({textContent:'',value:'',classList:{toggle(){}},setAttribute(){}}),get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id)};
const buttons=['programs','drumkits'].map(tab=>({...element(),dataset:{tab},disabled:false}));
const context={KroseOpusDecoder:class{},window:{},document:{getElementById:get,querySelectorAll:()=>buttons},localStorage:{getItem:()=>null},catalog:data};
const source=fs.readFileSync(require.resolve('../public/app.js'),'utf8');
assert(source.includes('  init();'));
vm.runInNewContext(source.replace('  init();',`  data=catalog;
  selects.library={value:'onboard'};selects.category={setOptions(items){this.options=items}};
  window.testLibrary={list:()=>listedSounds().map(p=>p.id),switch:setLibrary,setTab:value=>tab=value,getTab:()=>tab};`),context);
const ui=context.window.testLibrary;
assert.equal(ui.list().length,673);assert(!ui.list().some(id=>id.startsWith('OP')));
ui.setTab('drumkits');assert.equal(ui.list().length,42);
ui.switch('oasys-piano');assert.equal(ui.getTab(),'programs');assert.equal(ui.list().length,32);assert(ui.list().includes('OP002'));assert(buttons[1].disabled);
assert.equal(get('libraryCount').textContent,'OASYS Piano');
ui.switch('onboard');assert.equal(ui.list().length,673);assert(!buttons[1].disabled);
const ids=new Set();for(const kind of ['programs','waveforms','drumkits','drums'])for(const entry of data[kind]){assert(!ids.has(entry.id),entry.id);ids.add(entry.id)}
const waves=new Map(data.waveforms.map(w=>[w.id,w]));
for(const program of data.programs.filter(p=>p.library==='oasys-piano')){
 assert(program.waveform_ids.length>0);
 for(const wid of program.waveform_ids){
  const wave=waves.get(wid);assert(wave,wid);assert(wave.channels.length>=1&&wave.channels.length<=2,wid);
  assert(data.releaseProfiles[program.release_profiles[wid]],`${program.id}: release`);assert(program.release_ams[wid],`${program.id}: AMS`);
  for(const channel of wave.channels){assert(channel.length>0);let top=-1;for(const region of channel){assert(region.top>=top);top=region.top;assert(data.samples[region.sample],`${program.id}/${region.sample}`)}}
 }
}
assert.equal(Object.keys(data.samples).filter(s=>Number(s)>=10000).length,272);
console.log('PASS: library switching, 673 onboard sounds / 42 kits / 32 OASYS sounds, unique IDs, complete waveform/sample/release/AMS references.');
