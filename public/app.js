/* Krose: static, local-state sound picker and on-demand PCM audition player. */
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const esc = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const categoryNames = {'PIANO':'钢琴','E.PIANO':'电钢琴','ORGAN':'风琴','BELL':'钟 / 打击乐','STRINGS':'弦乐 / 人声','BRASS':'管乐','SYNTH LEAD':'合成主音','SYNTH PAD':'铺底','GUITAR':'吉他','BASS':'贝斯','DRUM/SFX':'鼓 / 音效'};
  // Lower pair: Z–/ = C3–E4. Upper pair: Q–] = F4–C6 (default octave).
  // Offsets are relative to the middle C; no physical key is shared by the pairs.
  const keyboardMap = {
    KeyZ:-12,KeyS:-11,KeyX:-10,KeyD:-9,KeyC:-8,KeyV:-7,KeyG:-6,KeyB:-5,KeyH:-4,KeyN:-3,KeyJ:-2,KeyM:-1,
    Comma:0,KeyL:1,Period:2,Semicolon:3,Slash:4,
    KeyQ:5,Digit2:6,KeyW:7,Digit3:8,KeyE:9,Digit4:10,KeyR:11,KeyT:12,Digit6:13,KeyY:14,Digit7:15,KeyU:16,
    KeyI:17,Digit9:18,KeyO:19,Digit0:20,KeyP:21,Minus:22,BracketLeft:23,BracketRight:24
  };
  const keyLabels={Comma:',',Period:'.',Semicolon:';',Slash:'/',Minus:'−',BracketLeft:'[',BracketRight:']'};
  const shortcuts=Object.fromEntries(Object.entries(keyboardMap).map(([code,note])=>[note,keyLabels[code]||code.replace(/^(Key|Digit)/,'')]));
  let data, all = new Map(), waveById = new Map(), kitById = new Map(), tab = 'programs', page = 0, library = 'onboard';
  let selected = null, currentWave = null, selectionVersion = 0, octave = 4, melodicOctave = 4, kitOctave = 3, onlySaved = false;
  let saved = new Set();
  try { const value = JSON.parse(localStorage.getItem('krose-web-selected-v1') || '[]'); if (Array.isArray(value)) saved = new Set(value); } catch {}
  let ctx, master, limiter, analyser, analyserData, midiAccess;
  let pedalLatch = false, spacePedal = false, autoPedal = false, scorePedal = false, autoPedalEnabled = true, musicRelease = .12, sequence = 0, phraseTimers = [], phrasePlaying = false;
  const pressed = new Map(), voices = new Map(), pointers = new Map();
  const blockCache = new Map(), blockLoading = new Map(), sampleCache = new Map(), sampleLoading = new Map();
  const blockProgress = new Map();
  let loading = true, loadJob = null, prepared = new Map();
  const opusDecoder=new KroseOpusDecoder();
  const selects={};let recorder=null,releaseAMS=null,amsOrigin=0,lastMidiClock=0;
  let reverbSlots=[],reverbActive=0,reverbTimer=0,reverbBusyUntil=0;
  const noteName = n => ['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'][n % 12] + (Math.floor(n / 12) - 1);
  function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
  function persist() { try { localStorage.setItem('krose-web-selected-v1', JSON.stringify([...saved])); } catch { status('浏览器没有允许保存，收藏未能保存。'); } }
  function touch(cache, key, value, max) { cache.delete(key); cache.set(key, value); while (cache.size > max) cache.delete(cache.keys().next().value); return value; }
  function audioContext(resume = true) {
    if (!ctx) {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) throw Error('这个浏览器不支持 Web Audio，请使用新版 Chrome、Safari 或 Firefox。');
      ctx = new Audio({latencyHint:'interactive', sampleRate:48000});
      master = ctx.createGain(); limiter = ctx.createDynamicsCompressor(); analyser = ctx.createAnalyser();
      limiter.threshold.value = -4; limiter.knee.value = 5; limiter.ratio.value = 16; limiter.attack.value = .003; limiter.release.value = .12;
      analyser.fftSize = 256; analyserData = new Float32Array(analyser.fftSize);
      master.connect(limiter); limiter.connect(analyser); analyser.connect(ctx.destination);
      reverbSlots=[0,1].map(()=>{const convolver=ctx.createConvolver(),gain=ctx.createGain();gain.gain.value=0;convolver.normalize=true;master.connect(convolver);convolver.connect(gain);gain.connect(limiter);return {convolver,gain}});
      setRoom(Number($('reverb').value));
      master.gain.value = .9 * Number($('volume').value) / 100;
      ctx.onstatechange = () => { if (ctx.state === 'interrupted') { allOff(); status('音频已暂停，再按一次琴键继续。'); } };
    }
    if (resume && ctx.state !== 'running') ctx.resume().catch(() => status('请点击琴键来启用声音。'));
    return ctx;
  }
  function roomImpulse(size){
    const duration=.35+size/100*3.65,buffer=ctx.createBuffer(2,Math.ceil(ctx.sampleRate*duration),ctx.sampleRate);
    for(let ch=0;ch<2;ch++){
      const samples=buffer.getChannelData(ch);let seed=5137+ch*619,low=0;
      for(let i=0;i<samples.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const noise=seed/2147483648-1;low=low*.68+noise*.32;const t=i/ctx.sampleRate;const attack=Math.min(1,t/.018);samples[i]=low*Math.exp(-6.9*t/duration)*attack*.7}
      for(const [delay,level] of [[.021,.26],[.037,.17],[.061,.12],[.089,.08]]){const index=Math.round((delay*(.55+size/100)+ch*.0017)*ctx.sampleRate);if(index<samples.length)samples[index]+=level}
    }
    return buffer;
  }
  function setRoom(size){
    if(!ctx)return;
    clearTimeout(reverbTimer);
    const wait=reverbBusyUntil-performance.now();if(wait>0){reverbTimer=setTimeout(()=>setRoom(size),wait+10);return}
    const now=ctx.currentTime;
    if(!size){for(const slot of reverbSlots){slot.gain.gain.cancelScheduledValues(now);slot.gain.gain.setTargetAtTime(0,now,.045)}return}
    const next=1-reverbActive,old=reverbSlots[reverbActive],fresh=reverbSlots[next];
    fresh.gain.gain.cancelScheduledValues(now);fresh.gain.gain.setValueAtTime(0,now);fresh.convolver.buffer=roomImpulse(size);
    fresh.gain.gain.linearRampToValueAtTime(.07+size/100*.28,now+.18);
    old.gain.gain.cancelScheduledValues(now);old.gain.gain.setValueAtTime(old.gain.gain.value,now);old.gain.gain.linearRampToValueAtTime(0,now+.18);
    reverbActive=next;reverbBusyUntil=performance.now()+220;
  }
  function clearRoom(){
    if(!ctx)return;clearTimeout(reverbTimer);for(const slot of reverbSlots){slot.gain.gain.cancelScheduledValues(ctx.currentTime);slot.gain.gain.setTargetAtTime(0,ctx.currentTime,.008)}
    reverbBusyUntil=performance.now()+60;reverbTimer=setTimeout(()=>setRoom(Number($('reverb').value)),70);
  }
  async function block(index) {
    if (blockCache.has(index)) return touch(blockCache,index,blockCache.get(index),12);
    if (blockLoading.has(index)) return blockLoading.get(index);
    const task = (async () => {
      const info = data.packs[index];
      const response = await fetch(info.file);
      if (!response.ok) throw Error(`采样加载失败 (${response.status})，请检查资源是否完整。`);
      blockProgress.set(index,0);updateLoading();
      let bytes;
      if(response.body) {
        const reader=response.body.getReader(),chunks=[];let received=0;
        while(true){const {done,value}=await reader.read();if(done)break;chunks.push(value);received+=value.byteLength;blockProgress.set(index,received);updateLoading()}
        const combined=new Uint8Array(received);let offset=0;for(const chunk of chunks){combined.set(chunk,offset);offset+=chunk.byteLength}bytes=combined.buffer;
      } else {bytes=await response.arrayBuffer();blockProgress.set(index,bytes.byteLength);updateLoading()}
      if (bytes.byteLength !== info.bytes) throw Error('采样资源不完整，请重新上传 assets 目录。');
      return touch(blockCache,index,bytes,12);
    })();
    blockLoading.set(index,task);
    try { return await task; } finally { blockLoading.delete(index); }
  }
  async function sample(id) {
    if (sampleCache.has(id)) return touch(sampleCache,id,sampleCache.get(id),96);
    if (sampleLoading.has(id)) return sampleLoading.get(id);
    const context = audioContext(false);
    const task = (async () => {
      const info = data.samples[id];
      const bytes = await block(info.pack);
      const encoded = bytes.slice(info.offset,info.offset+info.length);
      const buffer = await opusDecoder.decode(context,encoded);
      return touch(sampleCache,id,buffer,96);
    })();
    sampleLoading.set(id,task);
    try { return await task; } finally { sampleLoading.delete(id); }
  }
  function phaseIncrement(exponent) {
    const index = Math.max(-32768,Math.min(exponent,24575)) + 32768;
    const base = data.phase_base[index >>> 8];
    return (base + (((base * data.phase_fraction[index & 255]) >>> 0) >>> 16)) >>> 0;
  }
  function increment(descriptor, region, note) {
    if (!region) return phaseIncrement(descriptor.pitch*2);
    const fine = Math.trunc(Math.abs(region.fine)*1311/1024) * Math.sign(region.fine);
    let state = (region.root*256 - fine - descriptor.pitch*2 + 32768 & 65535) - 32768;
    if (region.fixed) state += (note-region.root)*256;
    const exponent = (note*256-state+32768 & 65535)-32768;
    let limit = descriptor.flags & 1 ? 32768 : 2097151;
    if (!(descriptor.flags & 33)) {
      const length = descriptor.frames-1-descriptor.loop;
      if (length<=255) limit = length<=15?65536:length<=31?131072:length<=63?262144:length<=127?524288:1048576;
    }
    return Math.min(phaseIncrement(exponent),limit);
  }
  function sourcesFor(note, velocity = Number($('velocity').value)) {
    if (!currentWave) return [];
    if (currentWave.keys) {
      const key=currentWave.keys[note];if(!key)return [];
      const layer=key.layers.find(l=>velocity>=l.bottom)||key.layers[key.layers.length-1];
      return layer.samples.map(id=>({id,region:null,reverse:layer.reverse,tune:layer.coarse+layer.fine/100,gain:Math.pow(2,layer.level/50),exclusive:key.exclusive,pan:key.pan}));
    }
    if (currentWave.sample_ids) return currentWave.sample_ids.map(id => ({id, region:null}));
    return currentWave.channels.map(regions => { const region = regions.find(r=>r.top>=note) || regions[regions.length-1]; return {id:region.sample,region}; });
  }
  const bufferKey = ref => `${ref.id}/${ref.reverse?1:0}`;
  function allSources(wave) {
    if(wave.keys)return Object.values(wave.keys).flatMap(key=>key.layers.flatMap(l=>l.samples.map(id=>({id,reverse:l.reverse}))));
    if(wave.sample_ids)return wave.sample_ids.map(id=>({id}));
    return wave.channels.flatMap(regions=>regions.map(r=>({id:r.sample})));
  }
  function updateLoading() {
    if(!loadJob||loadJob.version!==selectionVersion)return;
    let bytes=0;for(const index of loadJob.blocks)bytes+=Math.min(data.packs[index].bytes,blockProgress.get(index)||(blockCache.has(index)?data.packs[index].bytes:0));
    const percent=Math.min(100,Math.floor(85*bytes/Math.max(1,loadJob.bytes)+15*loadJob.done/Math.max(1,loadJob.refs.length)));
    $('loadingProgress').value=percent;$('loadingPercent').textContent=`${percent}%`;
    $('loadingBytes').textContent=`${(bytes/1048576).toFixed(1)} / ${(loadJob.bytes/1048576).toFixed(1)} MB`;
  }
  function loadControls(ready) {
    $('phrase').disabled=!ready||!!recorder?.active;selects.piece.disabled=!ready;
    selects.waveform.disabled=!ready||selects.waveform.options.length<=1;
    document.querySelector('.instrument').setAttribute('aria-busy',String(!ready));
    $('keyboard').setAttribute('aria-disabled',String(!ready));
    recorder?.setReady(ready);
  }
  async function preloadCurrent() {
    if(!currentWave)return;
    loading=true;prepared=new Map();loadControls(false);
    $('loading').hidden=false;$('loadingTitle').textContent='加载声音';$('loadingError').textContent='';$('retryLoad').hidden=true;
    const refs=[...new Map(allSources(currentWave).map(r=>[bufferKey(r),r])).values()].sort((a,b)=>data.samples[a.id].pack-data.samples[b.id].pack||a.id-b.id);
    const blocks=new Set(refs.map(r=>data.samples[r.id].pack));
    const job={version:selectionVersion,refs,blocks,done:0,bytes:[...blocks].reduce((sum,i)=>sum+data.packs[i].bytes,0),buffers:new Map()};loadJob=job;updateLoading();
    let next=0;
    try {
      const worker=async()=>{
        while(next<refs.length&&job.version===selectionVersion){
          const ref=refs[next++];let buffer=await sample(ref.id);
          if(ref.reverse){
            const key=`reverse-${ref.id}`;
            if(sampleCache.has(key))buffer=sampleCache.get(key);
            else {const original=buffer;buffer=ctx.createBuffer(original.numberOfChannels,original.length,original.sampleRate);for(let c=0;c<original.numberOfChannels;c++)buffer.copyToChannel(original.getChannelData(c).slice().reverse(),c);touch(sampleCache,key,buffer,96)}
          }
          job.buffers.set(bufferKey(ref),buffer);job.done++;updateLoading();
        }
      };
      await Promise.all(Array.from({length:4},worker));
      if(job.version!==selectionVersion)return;
      prepared=job.buffers;loading=false;loadControls(true);$('loadingProgress').value=100;$('loadingPercent').textContent='100%';
      requestAnimationFrame(()=>{if(job.version===selectionVersion)$('loading').hidden=true});
      status('');return true;
    } catch(e) {
      if(job.version!==selectionVersion)return;
      $('loadingTitle').textContent='加载失败';$('loadingError').textContent=e.message||'请重试。';$('retryLoad').hidden=false;
      status('加载未完成',true);
      return false;
    }
  }
  function refreshKeys() {
    const down = new Set([...pressed.values()].map(p=>p.note));
    for (const v of voices.values()) if (v.sustained) down.add(v.note);
    document.querySelectorAll('[data-note]').forEach(key=>key.classList.toggle('is-down',down.has(Number(key.dataset.note))));
    const notes = [...down].sort((a,b)=>a-b);
    $('noteDisplay').textContent = notes.length ? notes.map(noteName).join(' · ') : '';
    const musicPedal=phrasePlaying&&!currentWave?.keys&&!currentWave?.sample_ids;
    $('sustain').textContent=musicPedal?'自动延音':'延音';
    $('sustain').setAttribute('aria-pressed',String(musicPedal?autoPedalEnabled:pedalLatch||spacePedal));
    $('noteDisplay').title=notes.map(noteName).join(' · ');
  }
  function stopVoice(voice, immediate = false) {
    if (voice.stopped && !immediate) return;
    const now = ctx.currentTime;
    if(!immediate&&voice.amsConfig){releaseAMS.seconds=Math.max(0,now-amsOrigin);voice.releaseProfile=releaseAMS.profile(voice.amsConfig,voice.note,voice.velocity,voice.controlKey);voice.release=voice.releaseProfile.seconds}
    const duration = immediate ? .008 : voice.release;
    let level=voice.amp*Math.max(0,Math.min(1,(now-voice.startedAt)/.003));
    if(voice.releaseAt!==undefined){
      const fraction=Math.max(0,Math.min(1,(now-voice.releaseAt)/voice.release));
      if(voice.releaseProfile){
        const values=voice.releaseProfile.values,x=fraction*(values.length-1),i=Math.floor(x);
        level=voice.releaseLevel*(values[i]+((values[i+1]??values[i])-values[i])*(x-i));
      }else level=voice.releaseLevel*(1-fraction);
    }
    voice.stopped = true; voice.sustained = false;
    // Cancel a curve from its start when stealing/stopping a releasing voice.
    // This also allows the polyphony limiter to remove an already-releasing voice.
    voice.gain.gain.cancelScheduledValues(voice.releaseAt??now);
    voice.gain.gain.setValueAtTime(level,now);
    voice.releaseAt=now;voice.releaseLevel=level;
    if(!immediate&&voice.releaseProfile){
      const curve=Float32Array.from(voice.releaseProfile.values,value=>value*level);
      voice.gain.gain.setValueCurveAtTime(curve,now,duration);
    }else voice.gain.gain.linearRampToValueAtTime(0,now+duration);
    for (const source of voice.sources) { try { source.stop(now+duration+.005); } catch {} }
    if (immediate) voices.delete(voice.id);
  }
  function noteOn(note, token, velocity = Number($('velocity').value), when = 0, controlKey = 'local', channel = null) {
    if (!currentWave || !data || loading) return;
    const sources=sourcesFor(note,velocity);if(!sources.length)return;
    if (pressed.has(token)) noteOff(token);
    const request = {note, id:++sequence, version:selectionVersion};
    pressed.set(token,request); refreshKeys();
    try {
      const context = audioContext();
      const buffers=sources.map(s=>prepared.get(bufferKey(s)));
      if(buffers.some(b=>!b))throw Error('采样尚未就绪，请重新加载这个声音。');
      const exclusive=sources[0].exclusive;
      if(exclusive)for(const v of [...voices.values()])if(v.exclusive===exclusive)stopVoice(v,true);
      while (voices.size>=32) stopVoice(voices.values().next().value,true);
      const gain = context.createGain(), now = Math.max(context.currentTime,when);
      const amp = .75 * Math.pow(Math.max(1,Math.min(127,velocity))/127,1.4)*(sources[0].gain||1);
      gain.gain.setValueAtTime(0,now); gain.gain.linearRampToValueAtTime(amp,now+.003);
      let panner=null;
      if(sources[0].pan!==undefined){panner=context.createStereoPanner();panner.pan.value=Math.max(-1,Math.min(1,(sources[0].pan-64)/63));gain.connect(panner);panner.connect(master)}else gain.connect(master);
      const oneshot=!!(currentWave.sample_ids||currentWave.keys);
      const releaseProfile=oneshot?null:data.releaseProfiles?.[selected?.release_profiles?.[currentWave.id]];
      const voice = {id:request.id, note, velocity, controlKey, amsConfig:oneshot?null:selected?.release_ams?.[currentWave.id], gain, amp, startedAt:now, sources:[], sustained:false, stopped:false, oneshot,exclusive,releaseProfile,release:releaseProfile?.seconds||(phrasePlaying?musicRelease:.12)};
      let ended = 0; const merger = sources.length===2 ? context.createChannelMerger(2) : null;
      if (merger) merger.connect(gain);
      for (let i=0;i<sources.length;i++) {
        const source = context.createBufferSource(), descriptor = data.samples[sources[i].id];
        source.buffer = buffers[i];
        source.playbackRate.value = 48000*increment(descriptor,sources[i].region,note)/8192/descriptor.rate*Math.pow(2,(sources[i].tune||0)/12);
        if (!voice.oneshot && descriptor.flags & 16 && descriptor.frames-1-descriptor.loop>=8) {
          source.loop = true; source.loopStart = descriptor.loopStart; source.loopEnd = descriptor.loopEnd;
        }
        if (merger) source.connect(merger,0,i); else source.connect(gain);
        source.onended = () => {
          source.disconnect();
          if (++ended===sources.length) { voices.delete(voice.id); gain.disconnect(); if(merger)merger.disconnect();if(panner)panner.disconnect();refreshKeys(); }
        };
        voice.sources.push(source);
      }
      voices.set(voice.id,voice); request.voice=voice;
      for (const source of voice.sources) source.start(now);
      recorder?.noteOn(token,note,velocity,channel??(currentWave.keys?9:0));
      if(currentWave.keys)status(sources[0].region?.name||currentWave.keys[note].layers[0].name);else status('');
    } catch (error) {
      if (request.version===selectionVersion) status(error.message || '声音加载失败，请稍后重试。',true);
      if (pressed.get(token)===request) pressed.delete(token);
      refreshKeys();
    }
  }
  function noteOff(token) {
    const request = pressed.get(token); if (!request) return;
    pressed.delete(token);
    recorder?.noteOff(token);
    const voice = request.voice;
    if (voice && !voice.oneshot) {
      if (pedalLatch || spacePedal || autoPedal) voice.sustained = true; else stopVoice(voice);
    }
    refreshKeys();
  }
  function updatePedal() {
    releaseAMS?.update('local',{type:'cc',controller:64,value:pedalLatch||spacePedal||autoPedal?127:0});
    recorder?.setPedal(pedalLatch||spacePedal);
    if (!pedalLatch && !spacePedal && !autoPedal) for (const voice of voices.values()) if (voice.sustained) stopVoice(voice);
    refreshKeys();
  }
  function allOff(options={}) {
    if(options.preserveRecorder!==true)recorder?.interrupt();
    for (const timer of phraseTimers) clearTimeout(timer);
    phraseTimers=[]; phrasePlaying=false; $('phrase').textContent='▶ 播放';$('phraseTime').textContent='';
    pressed.clear(); pointers.clear(); pedalLatch=false; spacePedal=false;autoPedal=false;scorePedal=false;musicRelease=.12;
    for (const voice of [...voices.values()]) stopVoice(voice,true);
    clearRoom();
    refreshKeys();
  }
  function renderKeyboard() {
    const start = octave*12, total = window.matchMedia('(max-width:760px)').matches ? 25 : 37;
    const black = new Set([1,3,6,8,10]);
    let whites = 0; const whiteCount = total===25?15:22;
    let html='';
    for (let note=start;note<start+total;note++) {
      const isBlack = black.has(note%12), label=note%12===0?noteName(note):'';
      const shortcut=shortcuts[note-(octave+1)*12] || '',drum=currentWave?.keys?.[note]?.layers[0]?.name;
      const short=drum?drum.split('-')[0].replace('Sidestick','Rim').replace('Crash','CYM').replace('Claps','CLP'):'';
      html+=`<button class="piano-key ${isBlack?'black':'white'} ${currentWave?.keys&&!drum?'unassigned':''}" data-note="${note}" aria-label="弹奏 ${noteName(note)}${drum?' '+esc(drum):''}" tabindex="-1" ${isBlack?`data-position="${whites/whiteCount*100}"`:''} title="${drum?esc(drum):noteName(note)}"><span class="drum-label">${esc(short)}</span><span>${label}</span><span class="key-shortcut">${shortcut}</span></button>`;
      if(!isBlack)whites++;
    }
    $('keyboard').innerHTML=html; $('octave').textContent=octave;
    $('keyboard').style.setProperty('--white-count',whiteCount);
    $('keyboard').querySelectorAll('[data-position]').forEach(key=>{key.style.left=key.dataset.position+'%'});
    $('octaveDown').disabled=octave<=1; $('octaveUp').disabled=octave>=6;
  }
  function changeOctave(delta) {
    const next=Math.max(1,Math.min(6,octave+delta));if(next===octave)return;
    octave=next;if(currentWave?.keys)kitOctave=octave;else melodicOctave=octave;
    // Held notes retain their original note/token until key-up; voices and pedal continue.
    renderKeyboard();refreshKeys();
  }
  function toggleSave(id) { saved.has(id)?saved.delete(id):saved.add(id);persist();renderList();refreshSave(); }
  function refreshSave() {
    const active=selected&&saved.has(selected.id);
    $('saveSound').textContent=active?'♥':'♡';$('saveSound').setAttribute('aria-pressed',String(!!active));
    $('saveSound').setAttribute('aria-label',selected?`${active?'取消收藏':'收藏'} ${selected.name}`:'收藏当前声音');
  }
  const soundLibrary = sound => sound.library || 'onboard';
  function listedSounds(){return data[tab].filter(r=>soundLibrary(r)===library&&(tab!=='programs'||r.category!=='DRUM/SFX'))}
  function setLibrary(value){
    library=value;selects.library.value=value;page=0;
    if(library==='oasys-piano'&&tab==='drumkits')tab='programs';
    document.querySelectorAll('[data-tab]').forEach(button=>{const active=button.dataset.tab===tab;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));button.disabled=library==='oasys-piano'&&button.dataset.tab==='drumkits'});
    renderCategory();$('libraryCount').textContent=library==='oasys-piano'?'OASYS Piano':'原机采样 / ROM LIBRARY';
  }
  function renderCategory() {
    const categories=tab==='waveforms'?[...new Set(data.waveforms.flatMap(r=>r.categories))]:[...new Set(listedSounds().map(r=>r.category))];
    selects.category.setOptions([{value:'',label:'全部分类'},...categories.map(c=>({value:c,label:categoryNames[c]||c}))]);
  }
  function renderList() {
    if(!data)return;
    const query=$('search').value.trim().toLowerCase(), category=selects.category.value;
    const items=listedSounds().filter(r=>(!onlySaved||saved.has(r.id))&&(!category||(r.categories?r.categories.includes(category):r.category===category))&&(!query||[r.id,r.name,r.category,r.subcategory,categoryNames[r.category],...(r.waveform_ids||[]).map(id=>waveById.get(id).name)].join(' ').toLowerCase().includes(query)));
    const pages=Math.max(1,Math.ceil(items.length/60));page=Math.min(page,pages-1);
    $('soundList').innerHTML=items.slice(page*60,page*60+60).map(r=>`<div class="sound-row ${selected?.id===r.id?'selected':''}"><button class="sound-choice" data-choose="${r.id}" aria-pressed="${selected?.id===r.id}" aria-label="选择 ${r.id} ${esc(r.name)}"><span class="row-id">${r.id}</span><span class="row-name">${esc(r.name)}</span></button><button class="row-save" data-save="${r.id}" aria-pressed="${saved.has(r.id)}" aria-label="${saved.has(r.id)?'取消收藏':'收藏'} ${r.id}">${saved.has(r.id)?'♥':'♡'}</button></div>`).join('')||'<div class="empty">没有匹配的声音。</div>';
    $('resultCount').textContent=`${items.length} ${tab==='drumkits'?'套鼓组':tab==='programs'?'个音色':tab==='waveforms'?'个波形':'个单鼓'}`;
    $('pageCount').textContent=`${page+1} / ${pages}`;$('prev').disabled=page===0;$('next').disabled=page===pages-1;
  }
  function choose(id,settings={}) {
    const sound=all.get(id);if(!sound)return Promise.resolve(false);
    if(soundLibrary(sound)!==library)setLibrary(soundLibrary(sound));
    allOff(settings);selectionVersion++;selected=sound;amsOrigin=ctx?.currentTime||0;releaseAMS?.reset();if(!selected)return Promise.resolve(false);
    $('soundName').textContent=selected.name;
    $('soundMeta').textContent=`${selected.id} / ${categoryNames[selected.category]||selected.category}`;
    let options=[];
    if(selected.kind==='programs')options=selected.drumkit_id?[kitById.get(selected.drumkit_id)]:selected.waveform_ids.map(id=>waveById.get(id));
    if(selected.kind==='waveforms')options=[selected];
    if(selected.kind==='drumkits')options=[selected];
    if(selected.kind==='drums')options=[selected];
    currentWave=options[0]||null;
    selects.waveform.setOptions(options.map(w=>({value:w.id,label:w.name})));selects.waveform.value=currentWave?.id||'';
    $('sourceLabel').textContent=currentWave?.keys?'鼓组':'波形';
    if(selected.kind==='programs') {
      $('soundDescription').textContent=currentWave?.keys?`${Object.keys(currentWave.keys).length} 个键位 · 原机鼓组`:`${selected.subcategory} · ${options.length} 种波形`;
    } else if(selected.kind==='waveforms') {
      $('soundDescription').textContent=`${selected.channels.length===2?'立体声':'单声道'} · ${selected.channels[0].length} 个分区`;
    } else if(selected.kind==='drumkits')$('soundDescription').textContent=`${Object.keys(selected.keys).length} 个键位 · 原机鼓组`;
    else $('soundDescription').textContent=`${selected.sample_ids.length===2?'立体声':'单声道'} · 单个鼓采样`;
    octave=currentWave?.keys?kitOctave:melodicOctave;
    renderKeyboard();renderPieces();
    refreshSave();renderList();recorder?.soundChanged();
    return preloadCurrent();
  }
  function showSelection() {
    const items=[...saved].map(id=>all.get(id)).filter(Boolean).sort((a,b)=>a.id.localeCompare(b.id));
    $('selectionText').value=items.map(r=>`${r.id}\t${r.name}\t${categoryNames[r.category]||r.category}`).join('\n');
    $('selectionHint').textContent=items.length?`共 ${items.length} 项。复制或下载后，可以直接作为下一批音色的选择清单。`:'先点击声音旁的 ♡，留下你喜欢的声音。';
    $('copyStatus').textContent='';$('selectionDialog').showModal();
  }
  function renderPieces() {
    const old=selects.piece.value;
    const pieces=currentWave?.keys||currentWave?.sample_ids?[{id:'drum-beat',title:'鼓组节奏',composer:''}]:data.music;
    selects.piece.setOptions(pieces.map(p=>({value:p.id,label:p.composer?p.composer+' · '+p.title:p.title})));
    if(pieces.some(p=>p.id===old))selects.piece.value=old;
  }
  async function playPhrase() {
    if(phrasePlaying){allOff();return}
    if(!currentWave||loading||recorder?.active)return;
    const context=audioContext();allOff();phrasePlaying=true;$('phrase').textContent='■ 停止';
    const version=selectionVersion;await context.resume();if(!phrasePlaying||version!==selectionVersion)return;
    let piece;
    if(selects.piece.value==='drum-beat') {
      const notes=[];for(let i=0;i<16;i++){notes.push([i*.25,.12,54,i%2?68:88]);if(i%4===0)notes.push([i*.25,.15,48,105]);if(i%4===2)notes.push([i*.25,.15,50,106])}
      piece={notes,pedal:[],duration:4};
    } else piece=data.music.find(p=>p.id===selects.piece.value);
    musicRelease=piece.release_seconds||.12;refreshKeys();
    const origin=context.currentTime+.12;
    piece.notes.forEach(([at,duration,note,velocity],i)=>{
      const token=`phrase-${i}`;
      phraseTimers.push(setTimeout(()=>noteOn(note,token,velocity,origin+at),Math.max(0,(at+.08)*1000)));
      phraseTimers.push(setTimeout(()=>noteOff(token),(at+duration+.12)*1000));
    });
    for(const [at,on] of piece.pedal)phraseTimers.push(setTimeout(()=>{scorePedal=on;autoPedal=autoPedalEnabled&&scorePedal;updatePedal()},(at+.12)*1000));
    const formatTime=seconds=>`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
    for(let s=0;s<=Math.ceil(piece.duration);s++)phraseTimers.push(setTimeout(()=>{$('phraseTime').textContent=`${formatTime(s)} / ${formatTime(Math.ceil(piece.duration))}`},s*1000));
    phraseTimers.push(setTimeout(()=>{for(const token of [...pressed.keys()])if(token.startsWith('phrase-'))noteOff(token);autoPedal=false;pedalLatch=false;phrasePlaying=false;updatePedal();$('phrase').textContent='▶ 播放';$('phraseTime').textContent='';phraseTimers=[]},(piece.duration+.3)*1000));
  }
  function pointerDown(event) {
    if(event.button!==0&&event.pointerType==='mouse')return;
    const key=event.target.closest('[data-note]');if(!key)return;
    event.preventDefault();$('keyboard').setPointerCapture(event.pointerId);
    const note=Number(key.dataset.note);pointers.set(event.pointerId,note);noteOn(note,`pointer-${event.pointerId}`);
  }
  function pointerUp(event) { if(pointers.has(event.pointerId)){noteOff(`pointer-${event.pointerId}`);pointers.delete(event.pointerId);} }
  function setWorkspace(workspace){
    if($('workspace').dataset.workspace===workspace)return;
    allOff();for(const select of Object.values(selects))select.close();
    $('workspace').dataset.workspace=workspace;$('export').hidden=workspace==='record';
    document.querySelector('.library').hidden=workspace==='record';$('performPanel').hidden=workspace==='record';$('recordPanel').hidden=workspace!=='record';
    document.querySelector('.instrument').setAttribute('aria-labelledby',workspace==='record'?'recordTab':'soundName');
    document.querySelectorAll('[data-workspace][role=tab]').forEach(button=>{const active=button.dataset.workspace===workspace;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1});
    const panel=$(workspace==='record'?'recordPanel':'performPanel');if(!matchMedia('(prefers-reduced-motion:reduce)').matches)panel.animate([{opacity:0,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}],{duration:220,easing:'ease-out'});
    recorder.soundChanged();
  }
  async function prepareRecordedSound(take){
    if(!all.has(take.soundId))throw Error('这段录音的音色不可用。');
    const ready=await choose(take.soundId,{preserveRecorder:true});if(!ready)return false;
    if(take.waveformId&&take.waveformId!==currentWave.id){
      const wave=waveById.get(take.waveformId)||kitById.get(take.waveformId);
      if(!wave||!selects.waveform.options.some(o=>o.value===take.waveformId))throw Error('这段录音的波形不可用。');
      selectionVersion++;currentWave=wave;selects.waveform.value=wave.id;renderKeyboard();renderPieces();if(!await preloadCurrent())return false;
    }
    if(Number.isFinite(take.room)){const room=Math.max(0,Math.min(100,take.room));$('reverb').value=room;$('reverbValue').textContent=room;setRoom(room)}
    return true;
  }
  function bind() {
    document.querySelectorAll('[data-workspace][role=tab]').forEach((button,index,buttons)=>{
      button.onclick=()=>setWorkspace(button.dataset.workspace);
      button.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End',' '].includes(e.key))return;e.preventDefault();e.stopPropagation();const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:e.key===' '?index:(index+(e.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;buttons[next].focus();setWorkspace(buttons[next].dataset.workspace)};
    });
    document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{
      tab=button.dataset.tab;page=0;$('search').value='';
      document.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button))});
      renderCategory();renderList();$('soundList').scrollTop=0;
    });
    $('search').oninput=()=>{page=0;renderList();$('soundList').scrollTop=0};
    selects.library.onchange=()=>{setLibrary(selects.library.value);$('search').value='';$('soundList').scrollTop=0;choose(library==='oasys-piano'?'OP002':'A000')};
    selects.category.onchange=()=>{page=0;renderList();$('soundList').scrollTop=0};
    $('savedFilter').onclick=()=>{onlySaved=!onlySaved;page=0;$('savedFilter').setAttribute('aria-pressed',String(onlySaved));renderList()};
    $('soundList').onclick=event=>{const button=event.target.closest('[data-choose],[data-save]');if(!button)return;if(button.dataset.save)toggleSave(button.dataset.save);else choose(button.dataset.choose)};
    $('prev').onclick=()=>{page--;renderList();$('soundList').scrollTop=0};$('next').onclick=()=>{page++;renderList();$('soundList').scrollTop=0};
    $('saveSound').onclick=()=>{if(selected)toggleSave(selected.id)};
    selects.waveform.onchange=()=>{allOff();selectionVersion++;currentWave=waveById.get(selects.waveform.value)||kitById.get(selects.waveform.value);renderKeyboard();renderPieces();recorder.soundChanged();preloadCurrent()};
    selects.piece.onchange=allOff;
    $('retryLoad').onclick=()=>{if(!data){location.reload();return}selectionVersion++;preloadCurrent()};
    $('velocity').oninput=()=>{$('velocityValue').textContent=$('velocity').value};
    $('volume').oninput=()=>{$('volumeValue').textContent=$('volume').value;if(master)master.gain.setTargetAtTime(.9*Number($('volume').value)/100,ctx.currentTime,.015)};
    $('reverb').oninput=()=>{$('reverbValue').textContent=$('reverb').value;clearTimeout(reverbTimer);reverbTimer=setTimeout(()=>setRoom(Number($('reverb').value)),80)};
    $('octaveDown').onclick=()=>changeOctave(-1);$('octaveUp').onclick=()=>changeOctave(1);
    $('sustain').onclick=()=>{if(phrasePlaying&&!currentWave?.keys&&!currentWave?.sample_ids){autoPedalEnabled=!autoPedalEnabled;autoPedal=autoPedalEnabled&&scorePedal}else pedalLatch=!pedalLatch;updatePedal()};$('stop').onclick=()=>{allOff();status('')};$('phrase').onclick=playPhrase;
    $('keyboard').addEventListener('pointerdown',pointerDown);
    $('keyboard').addEventListener('pointerup',pointerUp);$('keyboard').addEventListener('pointercancel',pointerUp);
    $('keyboard').addEventListener('lostpointercapture',pointerUp);
    $('keyboard').addEventListener('pointermove',event=>{
      if(!pointers.has(event.pointerId))return;
      const key=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-note]');
      const note=key?Number(key.dataset.note):null;
      if(note===pointers.get(event.pointerId))return;
      noteOff(`pointer-${event.pointerId}`);pointers.set(event.pointerId,note);
      if(note!==null)noteOn(note,`pointer-${event.pointerId}`);
    });
    window.addEventListener('keydown',event=>{
      if(event.ctrlKey||event.metaKey||event.altKey||event.repeat||event.target.matches('input,select,textarea')||event.target.closest('[role=combobox],[role=listbox]')||document.querySelector('dialog[open]'))return;
      if(loading){if(Object.hasOwn(keyboardMap,event.code)||event.code==='Space')event.preventDefault();return}
      if(event.code==='Space'){event.preventDefault();spacePedal=true;updatePedal();return}
      if(event.code==='ArrowLeft'||event.code==='ArrowDown'){event.preventDefault();changeOctave(-1);return}
      if(event.code==='ArrowRight'||event.code==='ArrowUp'){event.preventDefault();changeOctave(1);return}
      if(Object.hasOwn(keyboardMap,event.code)){event.preventDefault();noteOn((octave+1)*12+keyboardMap[event.code],`key-${event.code}`)}
    });
    window.addEventListener('keyup',event=>{if(event.code==='Space'){spacePedal=false;updatePedal()}noteOff(`key-${event.code}`)});
    window.addEventListener('blur',allOff);window.addEventListener('pagehide',()=>{allOff();opusDecoder.close()});
    window.matchMedia('(max-width:760px)').addEventListener('change',()=>{allOff();renderKeyboard()});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)allOff()});
    $('export').onclick=showSelection;
    $('downloadSelection').onclick=()=>{
      const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([$('selectionText').value+'\n'],{type:'text/plain;charset=utf-8'}));a.download='krose-selected-sounds.txt';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),3000);
    };
    $('copySelection').onclick=async()=>{try{await navigator.clipboard.writeText($('selectionText').value);$('copyStatus').textContent='已复制。'}catch{$('selectionText').select();$('copyStatus').textContent='请手动复制，或下载 TXT。'}};
    $('midi').onclick=connectMidi;
  }
  async function connectMidi() {
    if(!navigator.requestMIDIAccess){$('midiStatus').textContent='当前浏览器不支持 MIDI，可用屏幕或电脑键盘。';return}
    try {
      audioContext();midiAccess=await navigator.requestMIDIAccess({sysex:false});
      const update=()=>{
        let count=0;
        for(const input of midiAccess.inputs.values()) {
          if(input.state!=='connected')continue;count++;
          input.onmidimessage=event=>{
            const [command,note,value]=event.data, type=command&240,channel=command&15;
            if(command===248){const now=performance.now();if(lastMidiClock){const bpm=60000/((now-lastMidiClock)*24);if(bpm>=20&&bpm<=300)releaseAMS.tempo=releaseAMS.tempo*.8+bpm*.2}lastMidiClock=now;return}
            const controlKey=`midi-${input.id}-${channel}`;
            let control=null;
            if(type===176)control={type:'cc',controller:note,value};
            else if(type===224)control={type:'bend',value:note+(value<<7)};
            else if(type===208)control={type:'pressure',value:note};
            else if(type===160)control={type:'polyPressure',note,value};
            if(control){releaseAMS.update(controlKey,control);recorder?.control(control,channel)}
            const token=`midi-${input.id}-${channel}-${note}`;
            if(type===144&&value)noteOn(note,token,value,0,controlKey,channel);
            else if(type===128||type===144&&!value)noteOff(token);
            else if(type===176&&note===64){pedalLatch=value>=64;updatePedal()}
            else if(type===176&&(note===120||note===123))allOff();
          };
        }
        $('midiStatus').textContent=count?`${count} 个 MIDI 输入已连接`:'已启用 MIDI，等待连接键盘。';
        $('midi').textContent='MIDI 已启用';
      };
      midiAccess.onstatechange=event=>{if(event.port.type==='input'&&event.port.state==='disconnected'){allOff();releaseAMS.reset();lastMidiClock=0}update()};update();
    } catch { $('midiStatus').textContent='MIDI 未连接，可继续用屏幕或电脑键盘。'; }
  }
  function meter() {
    if(analyser&&ctx.state==='running') {
      analyser.getFloatTimeDomainData(analyserData);
      let sum=0;for(const value of analyserData)sum+=value*value;
      $('level').value=Math.min(1,Math.sqrt(sum/analyserData.length)*3);
    } else $('level').value=0;
    requestAnimationFrame(meter);
  }
  async function init() {
    try {
      const response=await fetch('catalog.json');if(!response.ok)throw Error('目录加载失败，请检查 catalog.json。');data=await response.json();
      for(const kind of ['programs','waveforms','drums','drumkits'])for(const r of data[kind]){r.kind=kind;all.set(r.id,r)}
      waveById=new Map(data.waveforms.map(w=>[w.id,w]));
      kitById=new Map(data.drumkits.map(k=>[k.id,k]));
      for(const id of ['category','library','waveform','piece']){selects[id]=new KroseSelect($(id));$(id).kroseSelect=selects[id]}
      selects.library.setOptions([{value:'onboard',label:'板载'},{value:'oasys-piano',label:'OASYS Piano'}]);
      releaseAMS=new KroseReleaseAMS(data.releaseAMSTables);
      recorder=new KroseMidi.MidiRecorder({
        ready:()=>!loading&&!!currentWave,clock:()=>ctx?.currentTime||0,prepareAudio:()=>audioContext().resume(),stopAudio:()=>allOff(),
        getSound:()=>selected&&currentWave?{soundId:selected.id,soundName:selected.name,waveformId:currentWave.id,drum:!!currentWave.keys,room:Number($('reverb').value)}:null,
        prepareTake:prepareRecordedSound,noteOn,noteOff,control:(event,channel)=>releaseAMS.update(`replay-${channel}`,event),resetControls:()=>releaseAMS.reset(),getControls:()=>releaseAMS.snapshot(),pedal:on=>{pedalLatch=on;updatePedal()}
      });
      saved=new Set([...saved].filter(id=>all.has(id)));persist();bind();renderCategory();renderKeyboard();
      $('libraryCount').textContent='原机采样 / ROM LIBRARY';
      choose('A000');requestAnimationFrame(meter);
    } catch(e) {status(e.message||'加载失败，请用 HTTP 服务打开这个网站。',true);$('loadingTitle').textContent='加载失败';$('loadingError').textContent=e.message;$('retryLoad').hidden=false;$('retryLoad').onclick=()=>location.reload();$('resultCount').textContent='目录尚未加载';}
  }
  init();
})();
