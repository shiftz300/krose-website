/* Original MIDI events, local takes and Standard MIDI File format-0 export. */
'use strict';
(function(root){
  const MAX_RECORD_SECONDS=600;
  const encodeText=text=>new TextEncoder().encode(text);
  function vlq(value){if(!Number.isSafeInteger(value)||value<0||value>0xfffffff)throw Error('MIDI delta outside VLQ range');const bytes=[value&127];while(value>>>=7)bytes.unshift((value&127)|128);return bytes}
  const word=value=>[value>>>8&255,value&255],long=value=>[value>>>24&255,value>>>16&255,value>>>8&255,value&255];
  function validEvent(e){
    const byte=v=>Number.isInteger(v)&&v>=0&&v<=127;
    if(e.channel!==undefined&&(!Number.isInteger(e.channel)||e.channel<0||e.channel>15))return false;
    if(e.type==='on'||e.type==='off')return byte(e.note)&&byte(e.velocity);
    if(e.type==='pedal')return typeof e.on==='boolean';
    if(e.type==='cc')return byte(e.controller)&&byte(e.value);
    if(e.type==='pressure')return byte(e.value);
    if(e.type==='polyPressure')return byte(e.note)&&byte(e.value);
    return e.type==='bend'&&Number.isInteger(e.value)&&e.value>=0&&e.value<=16383;
  }
  function validTake(take){return take&&typeof take.id==='string'&&typeof take.soundId==='string'&&Number.isFinite(take.duration)&&take.duration>=0&&Array.isArray(take.events)&&take.events.every(e=>Number.isFinite(e.time)&&e.time>=0&&e.time<=take.duration+.01&&validEvent(e))}
  function encodeMidi(take){
    if(!validTake(take))throw Error('Invalid MIDI take');
    const track=[],name=encodeText(`Krose / ${take.soundId} / ${take.soundName||''}`);
    track.push(0,255,3,...vlq(name.length),...name,0,255,81,3,7,161,32); // 120 BPM, 480 PPQ = 960 ticks/second.
    const defaultChannel=take.drum?9:0,channels=new Set([defaultChannel]);let previous=0;
    const events=take.events.map((e,i)=>({...e,index:i,tick:Math.round(e.time*960)})).sort((a,b)=>a.tick-b.tick||a.index-b.index);
    for(const event of events){const channel=Number.isInteger(event.channel)?event.channel&15:defaultChannel;channels.add(channel);track.push(...vlq(event.tick-previous));previous=event.tick;if(event.type==='pedal')track.push(176|channel,64,event.on?127:0);else if(event.type==='cc')track.push(176|channel,event.controller,event.value);else if(event.type==='pressure')track.push(208|channel,event.value);else if(event.type==='polyPressure')track.push(160|channel,event.note,event.value);else if(event.type==='bend')track.push(224|channel,event.value&127,event.value>>7);else track.push((event.type==='on'?144:128)|channel,event.note,event.type==='on'?event.velocity:0)}
    const end=Math.max(previous,Math.round(take.duration*960));track.push(...vlq(end-previous));let first=true;for(const channel of channels){if(!first)track.push(0);track.push(176|channel,64,0,0,176|channel,123,0);first=false}track.push(0,255,47,0);
    return new Uint8Array([...encodeText('MThd'),...long(6),...word(0),...word(1),...word(480),...encodeText('MTrk'),...long(track.length),...track]);
  }
  function parseMidi(input){
    const bytes=input instanceof Uint8Array?input:new Uint8Array(input),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const fail=()=>{throw Error('MIDI 文件不完整或格式无法识别。')},tag=p=>String.fromCharCode(...bytes.subarray(p,p+4));
    if(bytes.length<14||tag(0)!=='MThd')fail();const length=view.getUint32(4),format=view.getUint16(8),tracks=view.getUint16(10),division=view.getUint16(12);
    if(format>1)throw Error('请导入标准 MIDI 格式 0 或 1。');if(!tracks||!division||length<6||8+length>bytes.length)fail();
    const raw=[],tempos=[{tick:0,tempo:500000,order:-1}];let pos=8+length,lastTick=0,order=0,name='';
    for(let track=0;track<tracks;track++){
      if(pos+8>bytes.length||tag(pos)!=='MTrk')fail();const end=pos+8+view.getUint32(pos+4);pos+=8;if(end>bytes.length)fail();let tick=0,running=0;
      const read=()=>{if(pos>=end)fail();return bytes[pos++]},variable=()=>{let value=0;for(let i=0;i<4;i++){const b=read();value=value*128+(b&127);if(!(b&128))return value}fail()};
      while(pos<end){
        tick+=variable();let status=read();if(status<128){if(!running)fail();pos--;status=running}else if(status<240)running=status;
        if(status===255){const type=read(),count=variable();if(pos+count>end)fail();if(type===81&&count===3){const tempo=bytes[pos]*65536+bytes[pos+1]*256+bytes[pos+2];if(!tempo)fail();tempos.push({tick,tempo,order:order++})}if(type===3&&!name)name=new TextDecoder().decode(bytes.subarray(pos,pos+count));pos+=count;if(type===47){pos=end;break}}
        else if(status===240||status===247){const count=variable();if(pos+count>end)fail();pos+=count;running=0}
        else{if(status>=240)fail();const type=status&240,a=read(),b=type===192||type===208?0:read();if(a>127||b>127)fail();if(type===144||type===128)raw.push({tick,order:order++,type:type===144&&b?'on':'off',note:a,velocity:type===144&&b?b:0,channel:status&15});if(type===176&&![64,120,123].includes(a))raw.push({tick,order:order++,type:'cc',controller:a,value:b,channel:status&15});if(type===208||type===160||type===224)raw.push({tick,order:order++,type:type===208?'pressure':type===160?'polyPressure':'bend',note:a,value:type===224?a+(b<<7):type===208?a:b,channel:status&15});if(type===176&&(a===64||a===120||a===123))raw.push({tick,order:order++,type:a===64?'pedal':'alloff',on:b>=64,channel:status&15})}
      }
      lastTick=Math.max(lastTick,tick);
    }
    let tickSeconds;
    if(division&32768){const signed=(division>>8)-256,fps=signed===-29?29.97:-signed,resolution=division&255;if(![24,25,29.97,30].includes(fps)||!resolution)fail();tickSeconds=t=>t/(fps*resolution)}
    else{tempos.sort((a,b)=>a.tick-b.tick||a.order-b.order);let seconds=0,last=0,speed=500000;const timeline=[];for(const tempo of tempos){seconds+=(tempo.tick-last)*speed/(division*1e6);timeline.push({tick:tempo.tick,seconds,tempo:tempo.tempo});last=tempo.tick;speed=tempo.tempo}tickSeconds=t=>{let lo=0,hi=timeline.length;while(lo+1<hi){const mid=lo+hi>>1;if(timeline[mid].tick<=t)lo=mid;else hi=mid}const state=timeline[lo];return state.seconds+(t-state.tick)*state.tempo/(division*1e6)}}
    raw.sort((a,b)=>a.tick-b.tick||a.order-b.order);let duration=Math.max(.1,tickSeconds(lastTick));const events=[],held=new Map();
    for(const rawEvent of raw){const {tick,order,...e}=rawEvent;e.time=tickSeconds(tick);const key=`${e.channel}:${e.note}`;
      if(e.type==='on'){if(!held.has(key))held.set(key,[]);held.get(key).push(e);events.push(e)}
      else if(e.type==='off'){if(held.get(key)?.length){held.get(key).shift();events.push(e)}}
      else if(e.type!=='alloff')events.push(e);
      else{for(const [key,notes] of held)if(key.startsWith(`${e.channel}:`)){for(const n of notes)events.push({time:e.time,type:'off',note:n.note,velocity:0,channel:n.channel});held.set(key,[])}}
    }
    for(const notes of held.values())for(const n of notes)events.push({time:duration,type:'off',note:n.note,velocity:0,channel:n.channel});
    if(!events.some(e=>e.type==='on'))throw Error('MIDI 文件没有可导入的音符。');
    return {name,events:events.sort((a,b)=>a.time-b.time),duration};
  }
  function extractNotes(events,duration){
    const held=new Map(),notes=[];
    events.forEach((e,index)=>{const key=`${e.channel||0}:${e.note}`;if(e.type==='on'){if(!held.has(key))held.set(key,[]);held.get(key).push({e,index})}else if(e.type==='off'){const on=held.get(key)?.shift();if(on)notes.push({onIndex:on.index,offIndex:index,start:on.e.time,end:Math.max(on.e.time+.01,e.time),note:on.e.note,velocity:on.e.velocity})}});
    for(const pending of held.values())for(const on of pending)notes.push({onIndex:on.index,offIndex:-1,start:on.e.time,end:Math.max(on.e.time+.01,duration),note:on.e.note,velocity:on.e.velocity});return notes;
  }
  function editNote(take,onIndex,change){
    const note=extractNotes(take.events,take.duration).find(n=>n.onIndex===onIndex);if(!note)throw Error('Note not found');const result={...take,events:take.events.map(e=>({...e}))};
    const start=Math.max(0,change.start??note.start),end=start+Math.max(.03,change.duration??note.end-note.start),pitch=Math.max(0,Math.min(127,Math.round(change.note??note.note)));
    Object.assign(result.events[note.onIndex],{time:start,note:pitch});if(note.offIndex>=0)Object.assign(result.events[note.offIndex],{time:end,note:pitch});else result.events.push({time:end,type:'off',note:pitch,velocity:0,channel:take.events[note.onIndex].channel||0});
    result.duration=Math.max(take.duration,end);result.events.sort((a,b)=>a.time-b.time);return result;
  }
  function recordingPrefix(take,at){
    const events=take.events.filter(e=>e.time<at||(at>=take.duration&&e.time===at)).map(e=>({...e})),held=new Map(),pedals=new Set();
    for(const e of events){const key=`${e.channel||0}:${e.note}`;if(e.type==='on'){if(!held.has(key))held.set(key,[]);held.get(key).push(e)}else if(e.type==='off')held.get(key)?.shift();else if(e.type==='cc'&&e.controller===121)pedals.delete(e.channel||0);else if(e.type==='pedal'||e.type==='cc'&&e.controller===64){if(e.type==='pedal'?e.on:e.value>=64)pedals.add(e.channel||0);else pedals.delete(e.channel||0)}}
    for(const notes of held.values())for(const e of notes)events.push({time:at,type:'off',note:e.note,velocity:0,channel:e.channel||0});
    for(const channel of pedals)events.push({time:at,type:'pedal',on:false,channel});
    return events;
  }
  const pad=n=>String(n).padStart(2,'0'),time=s=>`${pad(Math.floor(s/60))}:${pad(Math.floor(s%60))}`;
  class MidiRecorder {
    constructor(hooks){
      this.hooks=hooks;this.takes=[];this.active=null;this.selected=null;this.playing=false;this.preparing=false;this.intent=0;this.timers=[];this.pedal=false;this.starting=false;this.lastDraw=0;
      try{const saved=JSON.parse(localStorage.getItem('krose-web-midi-takes-v1')||'[]');if(Array.isArray(saved))this.takes=saved.filter(validTake)}catch{}
      this.selected=this.takes[0]?.id||null;
      this.el=id=>document.getElementById(id);
      this.el('recordStart').onclick=()=>this.start();this.el('recordStop').onclick=()=>{if(this.active)this.finish();else this.hooks.stopAudio()};
      this.el('recordReplay').onclick=()=>{if(this.playing||this.preparing)this.hooks.stopAudio();else this.replay()};
      this.el('recordDownload').onclick=()=>this.download();
      this.history=new Map();this.cursor=0;this.cursorTake=null;
      this.roll=new root.KroseRoll({notes:extractNotes,takeId:()=>this.selected,stop:()=>this.hooks.stopAudio(),commit:(index,change)=>this.commit(index,change),undo:()=>this.undo(),preview:(note,velocity)=>this.previewNote(note,velocity),seek:seconds=>this.setCursor(seconds)});
      this.el('recordImport').onclick=()=>{this.hooks.stopAudio();this.el('midiFile').value='';this.el('midiFile').click()};
      this.el('midiFile').onchange=()=>{const file=this.el('midiFile').files[0];if(file)this.importFile(file)};
      this.el('rollUndo').onclick=()=>this.undo();
      this.el('takeList').onclick=e=>{const action=e.target.closest('[data-take-action]');if(action){this.openTakeDialog(action.dataset.takeId,action.dataset.takeAction);return}const button=e.target.closest('[data-take]');if(button){this.hooks.stopAudio();this.selected=button.dataset.take;this.render()}};
      this.el('takeAdd').onclick=()=>this.openTakeDialog(null,'create');
      this.el('takeDialogClose').onclick=this.el('takeDialogCancel').onclick=()=>this.el('takeDialog').close();
      this.el('takeName').oninput=()=>this.el('takeName').setCustomValidity('');
      this.el('takeDialogForm').onsubmit=e=>{e.preventDefault();this.confirmTakeDialog()};
      this.el('takeDialog').onclose=()=>{this.pendingTake=null;this.el('takeList').querySelector('[aria-pressed="true"]')?.focus({preventScroll:true})};
      this.render();requestAnimationFrame(t=>this.tick(t));
    }
    takeName(take){return take.name||take.importName||`录音 ${String(this.takes.length-this.takes.indexOf(take)).padStart(2,'0')}`}
    openTakeDialog(id,action){
      const take=this.takes.find(t=>t.id===id);if(!take&&action!=='create')return;this.hooks.stopAudio();this.pendingTake={id,action};
      const deleting=action==='delete',input=this.el('takeName');
      this.el('takeDialogTitle').textContent=deleting?'删除录音':action==='create'?'新建录音':'重命名录音';
      this.el('takeDialogHint').textContent=deleting?`确定删除「${this.takeName(take)}」？此操作无法撤销。`:'';
      this.el('takeNameLabel').hidden=deleting;input.disabled=deleting;input.value=take?this.takeName(take):this.nextName();input.setCustomValidity('');
      this.el('takeDialogConfirm').textContent=deleting?'删除':action==='create'?'新建':'保存';this.el('takeDialogConfirm').classList.toggle('danger',deleting);
      this.el('takeDialog').showModal();if(deleting)this.el('takeDialogCancel').focus();else{input.focus();input.select()}
    }
    confirmTakeDialog(){
      const pending=this.pendingTake;if(!pending)return;
      if(pending.action==='create'){const input=this.el('takeName'),name=input.value.trim();if(!name){input.setCustomValidity('请输入名称。');input.reportValidity();return}if(this.createTake(name)){this.render();this.el('takeDialog').close()}return}
      const index=this.takes.findIndex(t=>t.id===pending.id);if(index<0){this.el('takeDialog').close();return}
      if(pending.action==='rename'){const input=this.el('takeName'),name=input.value.trim();if(!name){input.setCustomValidity('请输入名称。');input.reportValidity();return}this.takes[index].name=name}
      else if(pending.action==='delete'){this.takes.splice(index,1);this.history.delete(pending.id);if(this.selected===pending.id)this.selected=this.takes[Math.min(index,this.takes.length-1)]?.id||null}
      else return;
      this.save();this.render();this.el('takeDialog').close();
    }
    nextName(){let n=1;const names=new Set(this.takes.map(t=>this.takeName(t)));while(names.has(`录音 ${String(n).padStart(2,'0')}`))n++;return `录音 ${String(n).padStart(2,'0')}`}
    createTake(name=this.nextName()){
      const sound=this.hooks.getSound();if(!sound)return null;
      const take={...sound,id:crypto.randomUUID(),name,createdAt:new Date().toISOString(),duration:0,events:[]};
      this.takes.unshift(take);this.selected=take.id;this.cursorTake=take.id;this.cursor=0;this.save();return take;
    }
    setCursor(seconds){if(this.active||this.starting)return;this.hooks.stopAudio();const take=this.takes.find(t=>t.id===this.selected);this.cursorTake=take?.id||null;this.cursor=Math.max(0,Math.min(take?.duration||0,seconds));this.roll.position(this.cursor)}
    soundChanged(){const sound=this.hooks.getSound();this.el('recordSound').textContent=sound?sound.soundId:'—';this.el('recordSoundName').textContent=sound?sound.soundName:'—'}
    async previewNote(note,velocity=90){
      const intent=this.previewIntent=(this.previewIntent||0)+1;
      if(this.previewToken){this.hooks.noteOff(this.previewToken);this.previewToken=null}
      if(note===null||this.active||!this.hooks.ready())return;
      try{await this.hooks.prepareAudio();if(intent!==this.previewIntent)return;this.previewToken=`edit-${intent}`;this.hooks.noteOn(note,this.previewToken,velocity)}catch{}
    }
    save(){try{localStorage.setItem('krose-web-midi-takes-v1',JSON.stringify(this.takes));this.el('recordMessage').textContent=''}catch{this.el('recordMessage').textContent='浏览器存储已满，本次录音仍可下载。'}}
    async importFile(file){
      this.hooks.stopAudio();
      try{if(file.size>16*1024*1024)throw Error('MIDI 文件超过 16 MB。');const parsed=parseMidi(await file.arrayBuffer()),sound=this.hooks.getSound();if(!sound)throw Error('请先选择音色。');
        const take={...sound,id:crypto.randomUUID(),createdAt:new Date().toISOString(),duration:parsed.duration,events:parsed.events,importName:file.name.replace(/\.(mid|midi)$/i,'')};this.takes.unshift(take);this.selected=take.id;this.save();this.render();
      }catch(e){this.el('recordMessage').textContent=e.message||'导入失败。'}
    }
    commit(index,change){
      if(this.active)return;this.hooks.stopAudio();const take=this.takes.find(t=>t.id===this.selected);if(!take)return;
      const result=editNote(take,index,change);if(!this.history.has(take.id))this.history.set(take.id,[]);const stack=this.history.get(take.id);stack.push({events:take.events.map(e=>({...e})),duration:take.duration});if(stack.length>30)stack.shift();this.takes[this.takes.indexOf(take)]=result;this.save();this.render();
    }
    undo(){if(this.active)return;const take=this.takes.find(t=>t.id===this.selected),snapshot=this.history.get(this.selected)?.pop();if(!take||!snapshot)return;this.hooks.stopAudio();take.events=snapshot.events;take.duration=snapshot.duration;this.save();this.render()}
    async start(){
      if(this.active||this.starting||!this.hooks.ready())return;
      this.hooks.stopAudio();const intent=++this.intent;this.starting=true;this.render();
      try{await this.hooks.prepareAudio();if(intent!==this.intent)return;
        const take=this.takes.find(t=>t.id===this.selected)||this.createTake();if(!take)return;
        const offset=Math.max(0,Math.min(take.duration,this.cursor));
        if(offset>=MAX_RECORD_SECONDS){this.el('recordMessage').textContent='已达到 10 分钟，请将游标移到更早的位置。';return}
        this.active={...take,...this.hooks.getSound(),start:this.hooks.clock()-offset,events:recordingPrefix(take,offset),held:new Map(),snapshot:{events:take.events.map(e=>({...e})),duration:take.duration}};
        if(this.hooks.getControls){const controls=this.hooks.getControls(),channels=new Set([...this.active.events,...controls].map(e=>e.channel||0));for(const channel of channels)this.active.events.push({time:offset,type:'cc',controller:121,value:0,channel});for(const event of controls)this.active.events.push({...event,time:offset})}
        this.pedal=false;this.limitTimer=setTimeout(()=>this.checkLimit(),(MAX_RECORD_SECONDS-offset)*1000);this.el('recordMessage').textContent='';this.render();this.soundChanged()}
      catch{this.el('recordMessage').textContent='暂时无法启用音频，请重试。'}
      finally{this.starting=false;this.render()}
    }
    checkLimit(){if(this.active&&this.hooks.clock()-this.active.start>=MAX_RECORD_SECONDS){this.finish();this.el('recordMessage').textContent='已达到 10 分钟，录音已保存。';return true}return false}
    noteOn(token,note,velocity,channel=0){if(this.checkLimit()||!this.active||/^(phrase|replay)-/.test(token))return;const t=Math.max(0,this.hooks.clock()-this.active.start);if(this.active.held.has(token))this.noteOff(token);this.active.events.push({time:t,type:'on',note,velocity,channel});this.active.held.set(token,{note,channel})}
    noteOff(token){if(this.checkLimit()||!this.active||!this.active.held.has(token))return;this.active.events.push({time:Math.max(0,this.hooks.clock()-this.active.start),type:'off',...(typeof this.active.held.get(token)==='number'?{note:this.active.held.get(token)}:this.active.held.get(token)),velocity:0});this.active.held.delete(token)}
    control(event,channel=0){if(this.checkLimit()||!this.active)return;this.active.events.push({...event,channel,time:Math.max(0,this.hooks.clock()-this.active.start)})}
    setPedal(on){if(this.checkLimit())return;if(this.active&&on!==this.pedal){this.active.events.push({time:Math.max(0,this.hooks.clock()-this.active.start),type:'pedal',on});this.pedal=on}}
    finish(silence=true){
      if(!this.active)return;
      clearTimeout(this.limitTimer);this.limitTimer=null;
      const capture=this.active,duration=Math.min(MAX_RECORD_SECONDS,Math.max(.01,this.hooks.clock()-capture.start));
      for(const held of capture.held.values())capture.events.push({time:duration,type:'off',...(typeof held==='number'?{note:held}:held),velocity:0});
      for(const channel of new Set(capture.events.map(e=>e.channel||0)))capture.events.push({time:duration,type:'pedal',on:false,channel});
      capture.events.push({time:duration,type:'pedal',on:false});this.active=null;this.pedal=false;
      const {start,held,snapshot,...data}=capture;const take={...data,duration};
      const index=this.takes.findIndex(t=>t.id===capture.id);
      if(index>=0){if(!this.history.has(take.id))this.history.set(take.id,[]);const stack=this.history.get(take.id);stack.push(snapshot);if(stack.length>30)stack.shift();this.takes[index]=take}
      else this.takes.unshift(take);
      this.selected=take.id;this.cursorTake=take.id;this.cursor=duration;this.save();
      this.render();if(silence)this.hooks.stopAudio();
    }
    interrupt(){this.previewNote(null);this.intent++;this.starting=false;this.finish(false);for(const t of this.timers)clearTimeout(t);this.timers=[];this.playing=false;this.preparing=false;this.el('recordCursor').hidden=true;this.render()}
    async replay(){
      const take=this.takes.find(t=>t.id===this.selected);if(!take||this.active)return;
      this.hooks.stopAudio();const intent=++this.intent;this.preparing=true;this.render();
      try{
        const ready=await this.hooks.prepareTake(take);if(intent!==this.intent||!ready)return;
        await this.hooks.prepareAudio();if(intent!==this.intent)return;
        this.hooks.resetControls?.();this.preparing=false;this.playing=true;this.replayOrigin=this.hooks.clock()+.1;this.replayDuration=take.duration;this.render();
        const held=new Map(),pedals=new Map();
        take.events.forEach((event,index)=>{
          this.timers.push(setTimeout(()=>{
            if(intent!==this.intent)return;
            const key=`${event.channel||0}:${event.note}`;
            if(event.type==='on'){const token=`replay-${index}`;if(!held.has(key))held.set(key,[]);held.get(key).push(token);this.hooks.noteOn(event.note,token,event.velocity,this.replayOrigin+event.time,`replay-${event.channel||0}`,event.channel||0)}
            else if(event.type==='off'){const token=held.get(key)?.shift();if(token)this.hooks.noteOff(token)}else{this.hooks.control?.(event.type==='pedal'?{type:'cc',controller:64,value:event.on?127:0}:event,event.channel||0);if(event.type==='cc'&&event.controller===121){pedals.delete(event.channel||0);this.hooks.pedal([...pedals.values()].some(Boolean))}else if(event.type==='pedal'||event.type==='cc'&&event.controller===64){pedals.set(event.channel||0,event.type==='pedal'?event.on:event.value>=64);this.hooks.pedal([...pedals.values()].some(Boolean))}}
          },Math.max(0,(event.time+(event.type==='on'?.06:.1))*1000)));
        });
        this.timers.push(setTimeout(()=>{if(intent!==this.intent)return;for(const tokens of held.values())for(const token of tokens)this.hooks.noteOff(token);this.hooks.pedal(false);this.playing=false;this.el('recordCursor').hidden=true;this.timers=[];this.render()},(take.duration+.22)*1000));
      }catch(e){if(intent===this.intent)this.el('recordMessage').textContent=e.message||'回放失败，请重试。'}
      finally{if(intent===this.intent){this.preparing=false;this.render()}}
    }
    download(){const take=this.takes.find(t=>t.id===this.selected);if(!take||this.active)return;const blob=new Blob([encodeMidi(take)],{type:'audio/midi'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);const name=this.takeName(take).replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/g,'').replace(/\.midi?$/i,'');a.download=`${name||'录音'}.mid`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),3000)}
    setReady(ready){this.ready=ready;this.render()}
    render(){
      const take=this.takes.find(t=>t.id===this.selected),active=!!this.active;
      this.el('recordStart').disabled=active||this.starting||this.preparing||!this.hooks.ready();
      this.el('recordStop').disabled=!active&&!this.playing&&!this.preparing;
      const playing=this.playing||this.preparing;
      this.el('recordReplay').disabled=active||this.starting||!take;this.el('recordReplay').setAttribute('aria-label',playing?'停止回放':'回放录音');this.el('recordReplay').title=playing?'停止回放':'回放';
      this.el('recordReplay').innerHTML=playing?'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="1"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4 L21 12 L7 20 Z"/></svg>';
      this.el('recordDownload').disabled=active||!take;
      this.el('recordPanel').classList.toggle('is-recording',active);
      this.el('recordState').textContent=active?'录制中':this.preparing?'准备回放':this.playing?'回放中':take?'已保存':'未录制';
      this.el('takeAdd').disabled=active||this.starting;
      if(this.cursorTake!==this.selected){this.cursorTake=this.selected;this.cursor=take?.duration||0}
      this.cursor=Math.min(this.cursor,take?.duration||0);
      this.el('takeList').replaceChildren();
      this.takes.forEach(t=>{
        const row=document.createElement('div');row.className='take-row';row.classList.toggle('selected',t.id===this.selected);
        const b=document.createElement('button');b.type='button';b.dataset.take=t.id;b.className='take-item';b.setAttribute('aria-pressed',String(t.id===this.selected));
        const label=document.createElement('span');label.textContent=this.takeName(t);const detail=document.createElement('span');detail.textContent=`${time(t.duration)} · ${t.soundName}`;b.append(label,detail);row.append(b);
        for(const [action,title,path] of [['rename','重命名','M15 5l4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L5 15z'],['delete','删除','M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7']]){
          const button=document.createElement('button');button.type='button';button.className='take-action';button.dataset.takeAction=action;button.dataset.takeId=t.id;button.title=title;button.setAttribute('aria-label',`${title} ${this.takeName(t)}`);button.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;row.append(button);
        }
        this.el('takeList').append(row);
      });
      this.el('rollUndo').disabled=active||!this.history.get(this.selected)?.length;
      if(!active){this.el('recordTime').textContent=time(take?.duration||0);this.draw(take?.events||[],Math.max(1,take?.duration||0));this.roll.position(this.cursor)}
      this.soundChanged();
    }
    draw(events,duration){
      this.roll.draw(events,duration,!!this.active);
    }
    tick(now){
      if(this.active&&!this.checkLimit()){const elapsed=Math.max(0,this.hooks.clock()-this.active.start),label=`${time(elapsed)} / 10:00`;if(this.el('recordTime').textContent!==label)this.el('recordTime').textContent=label;if(now-this.lastDraw>=1000/30){this.draw(this.active.events,Math.max(.01,elapsed));this.roll.position(elapsed);this.lastDraw=now}}
      if(this.playing){const elapsed=Math.max(0,this.hooks.clock()-this.replayOrigin);this.el('recordTime').textContent=`${time(Math.min(elapsed,this.replayDuration))} / ${time(this.replayDuration)}`;this.roll.playhead(elapsed)}
      requestAnimationFrame(t=>this.tick(t));
    }
  }
  const api={MAX_RECORD_SECONDS,MidiRecorder,encodeMidi,parseMidi,extractNotes,editNote,recordingPrefix,validTake,vlq};if(typeof module==='object'&&module.exports)module.exports=api;else root.KroseMidi=api;
})(typeof window==='undefined'?globalThis:window);
