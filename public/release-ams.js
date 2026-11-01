/* Factory Amp EG release-time AMS. No firmware execution in the browser. */
'use strict';
(function(root){
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const s8=x=>x<128?x:x-256,s16=(p,i)=>{const v=p[i]+p[i+1]*256;return v<32768?v:v-65536};
  const mod=(i,s)=>clamp(Math.floor(i*s*331/32768),-32768,32767);
  const uni=x=>(129*x+1)>>2;
  function bipolar(x){const v=(x-64)*2;return v<0?v*32:uni(v+(v>0?1:0))}
  const ccMap={19:1,20:2,23:4,24:16,25:18,26:17,27:19,28:20,29:21,30:17,31:19,32:20,33:21,34:64,35:65,36:66,37:67,38:80,39:81,40:82,41:83,42:85,43:86,44:87,45:88};
  class ReleaseAMS{
    constructor(tables){this.t=tables;this.controls=new Map();this.cache=new Map();this.tempo=120;this.seconds=0}
    state(key='local'){if(!this.controls.has(key))this.controls.set(key,{cc:new Map(),poly:new Map(),pressure:0,bend:8192});return this.controls.get(key)}
    update(key,event){if(event.type==='cc'&&event.controller===121){this.controls.delete(key);return}const s=this.state(key);if(event.type==='cc')s.cc.set(event.controller,event.value);else if(event.type==='pressure')s.pressure=event.value;else if(event.type==='polyPressure')s.poly.set(event.note,event.value);else if(event.type==='bend')s.bend=event.value}
    snapshot(){const events=[];for(const [key,s] of this.controls){const channel=key==='local'?0:Number(key.split('-').pop())||0;for(const [controller,value] of s.cc)events.push({type:'cc',controller,value,channel});if(s.pressure)events.push({type:'pressure',value:s.pressure,channel});if(s.bend!==8192)events.push({type:'bend',value:s.bend,channel});for(const [note,value] of s.poly)events.push({type:'polyPressure',note,value,channel})}return events}
    reset(){this.controls.clear()}
    source(id,config,note,velocity,state,seen=new Set()){
      if(id===0)return 0;
      if(id===8&&config.common_lfo){const p=config.common_lfo,phase=Math.floor(((this.seconds*this.tempo/60*p.ticks_per_quarter)%p.period_ticks)*65535/p.period_ticks);let triangle=((phase+16384+32768)&65535)-32768;if(triangle<0)triangle=(~triangle)&65535;triangle-=16384;return Math.floor(triangle*16387/65536)}
      if(id===13)return Math.floor(Math.min(note-60,60)*8739/128);
      if(id===14)return uni(velocity);
      if(id===15)return (this.t.expVelocity[velocity]+1)>>3;
      if(id>=9&&id<=12)return config.tracking[id-9][note];
      if(id===16)return uni(state.poly.get(note)||0);
      if(id===17)return uni(state.pressure);
      if(id===18){const v=(state.bend-8192)*4;return (v+(v>0?1:0))>>3}
      if(id===21||id===22)return uni(Math.min(127,(state.cc.get(id===21?1:2)||0)+(state.pressure>>1)));
      if(ccMap[id]!==undefined){const n=ccMap[id];if(!state.cc.has(n))return 0;return id===24||(id>=26&&id<=29)?bipolar(state.cc.get(n)):uni(state.cc.get(n))}
      if(id===1||id===2){
        if(seen.has(id))return 0;seen.add(id);const p=config.mixers[id-1],kind=p[0]&7;
        const source=n=>this.source(n,config,note,velocity,state,new Set(seen));
        const scaled=(i,n)=>(Math.imul(Math.imul(i,source(n)),331)>>15);
        let value=0;
        if(kind===0)value=scaled(s8(p[2]),p[1])+scaled(s8(p[4]),p[3]);
        else if(kind===1)value=scaled(s8(p[2])+((scaled(s8(p[4]),p[3])*99)>>12),p[1]);
        else if(kind===2)value=scaled(s16(p,6),p[1])+((s16(p,8)*165)>>2);
        return clamp(value,-24576,24576);
      }
      // The catalogue records unresolved internal generators explicitly.
      return 0;
    }
    duration(base,modulation){
      if(modulation>0&&base<=7)base=8;
      const exponent=modulation*16,whole=Math.floor(exponent/65536);if(whole < -16)return 0;
      let scale;
      if(whole>15)scale=4294967295;
      else{const fraction=exponent-whole*65536,i=fraction>>8,r=fraction&255,a=this.t.expFraction[i],b=i===255?65536:this.t.expFraction[i+1];scale=Math.min(4294967295,Math.floor(2**(whole+16)*(65536+a+Math.floor((b-a)*r/256))/65536))}
      return Math.min(2147483647,Number(BigInt(base)*BigInt(scale)>>16n));
    }
    coefficient(curve,steps){
      if(steps<=640)return this.t.short[Math.max(0,steps-1)*11+curve];
      if(steps<6400){const row=Math.floor((steps-640)/64),r=(steps-640)%64,a=this.t.medium[row*11+curve],b=this.t.medium[(row+1)*11+curve];return a+Math.floor((b-a)*r/64)}
      const a=this.t.long[curve],b=this.t.long[curve+11];return steps>=230400?b:a+Math.trunc((b-a)*(steps-6400)/224000);
    }
    profile(config,note,velocity,key='local'){
      const state=this.state(key);let modulation=0;
      for(const {source,intensity} of config.time_ams)if(intensity)modulation+=12*mod(intensity,this.source(source,config,note,velocity,state));
      const units=this.duration(config.base_units,modulation),curve=config.curve,keyCache=`${units}:${curve}`;
      if(this.cache.has(keyCache))return this.cache.get(keyCache);
      const steps=Math.max(1,Math.ceil(units/24)),count=Math.min(8192,steps),coefficient=this.coefficient(curve,Math.floor(units/24)),asymptote=this.t.asymptote[curve];
      const values=new Float32Array(count+1);values[0]=1;let progress=0;
      for(let i=1;i<=count;i++){
        if(steps<=8192)progress=Number((BigInt(progress)+((BigInt(coefficient)*BigInt(asymptote-(progress>>>2)))>>29n))&0xffffffffn);
        else progress=clamp(4*asymptote*(-Math.expm1(Math.log1p(-coefficient/2147483648)*steps*i/count)),0,2147483648);
        values[i]=Math.max(0,Math.floor((2147483648-Math.min(progress,2147483648))*32767/2147483648)/32767);
      }
      values[count]=0;const result={seconds:steps*.016,values,units,modulation};this.cache.set(keyCache,result);if(this.cache.size>128)this.cache.delete(this.cache.keys().next().value);return result;
    }
  }
  if(typeof module==='object'&&module.exports)module.exports={ReleaseAMS,mod,uni,bipolar};else root.KroseReleaseAMS=ReleaseAMS;
})(typeof window==='undefined'?globalThis:window);
